import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, hasModel } from '@/lib/db';
import { enforceInternalAuth, logSecurityEvent } from '@/lib/trading-policy';
import {
  AI_DECISION_JOURNAL_CONTRACT_VERSION,
  validateAiDecisionJournalEntry,
  type AiDecisionJournalEntry,
} from '@/lib/trading-intelligence/decision-journal';

const MarketDataSchema = z.object({
  environment: z.enum(['live', 'demo', 'unknown']),
  isSynthetic: z.boolean(),
  source: z.string().min(1).max(200),
  observedAt: z.string().min(1).max(100),
}).strict();

const DecisionSchema = z.object({
  contractVersion: z.literal(AI_DECISION_JOURNAL_CONTRACT_VERSION),
  journalId: z.string().min(16).max(80),
  userId: z.string().min(1).max(191),
  botId: z.string().min(1).max(191),
  accountId: z.string().min(1).max(191),
  cycleId: z.string().min(1).max(160),
  stage: z.enum(['autonomy', 'strategy', 'market_data', 'risk', 'execution']),
  outcome: z.enum(['hold', 'suspend', 'reject', 'approve']),
  code: z.string().min(1).max(160),
  reason: z.string().min(1).max(4000),
  symbol: z.string().max(50).nullable().optional(),
  side: z.enum(['buy', 'sell']).nullable().optional(),
  confidence: z.number().min(0).max(100).nullable().optional(),
  strategy: z.string().max(100).nullable().optional(),
  timeframe: z.string().max(30).nullable().optional(),
  strategyVersion: z.string().max(120).nullable().optional(),
  riskEngineVersion: z.string().max(120).nullable().optional(),
  supervisorVersion: z.string().max(120).nullable().optional(),
  positionNotional: z.number().nonnegative().nullable().optional(),
  riskAmount: z.number().nonnegative().nullable().optional(),
  riskPercentOfAllocation: z.number().nonnegative().nullable().optional(),
  riskReward: z.number().nonnegative().nullable().optional(),
  marketData: MarketDataSchema.nullable().optional(),
}).strict();

function errorResponse(status: number, code: string, error: string) {
  return NextResponse.json(
    { error, code, remediationPhase: 'phase-2k-ai-decision-journal' },
    { status },
  );
}

export async function POST(req: Request) {
  const authError = enforceInternalAuth(req);
  if (authError) return authError;

  const raw = await req.json().catch(() => null);
  const parsed = DecisionSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return errorResponse(
      400,
      'INVALID_AI_DECISION_JOURNAL_ENTRY',
      `Invalid AI decision journal entry: ${first?.path.join('.') || 'field'} — ${first?.message}`,
    );
  }

  const entry = parsed.data as AiDecisionJournalEntry;
  const validation = validateAiDecisionJournalEntry(entry);
  if (!validation.valid) {
    logSecurityEvent({
      eventType: 'AI_DECISION_JOURNAL_REJECTED',
      route: '/api/trading/engine/decisions',
      userId: entry.userId,
      reason: `${validation.code}: ${validation.reason}`,
    });
    return errorResponse(400, validation.code, validation.reason);
  }

  if (!db || !hasModel('bot') || !hasModel('aiDecisionJournal')) {
    return errorResponse(
      503,
      'DECISION_JOURNAL_UNAVAILABLE',
      'AI decision journal persistence is unavailable.',
    );
  }

  try {
    const bot = await db.bot.findFirst({
      where: {
        id: entry.botId,
        userId: entry.userId,
        accountId: entry.accountId,
      },
      select: { id: true },
    });
    if (!bot) {
      return errorResponse(404, 'BOT_NOT_FOUND', 'Bot was not found.');
    }

    const existing = await db.aiDecisionJournal.findUnique({
      where: { id: entry.journalId },
    });
    if (existing) {
      return NextResponse.json({
        success: true,
        idempotent: true,
        journalId: existing.id,
        createdAt: existing.createdAt,
      });
    }

    const marketObservedAt = entry.marketData
      ? new Date(entry.marketData.observedAt)
      : null;

    const created = await db.aiDecisionJournal.create({
      data: {
        id: entry.journalId,
        contractVersion: entry.contractVersion,
        userId: entry.userId,
        botId: entry.botId,
        accountId: entry.accountId,
        cycleId: entry.cycleId,
        stage: entry.stage,
        outcome: entry.outcome,
        code: entry.code,
        reason: entry.reason,
        symbol: entry.symbol ?? null,
        side: entry.side ?? null,
        confidence: entry.confidence ?? null,
        strategy: entry.strategy ?? null,
        timeframe: entry.timeframe ?? null,
        strategyVersion: entry.strategyVersion ?? null,
        riskEngineVersion: entry.riskEngineVersion ?? null,
        supervisorVersion: entry.supervisorVersion ?? null,
        positionNotional: entry.positionNotional ?? null,
        riskAmount: entry.riskAmount ?? null,
        riskPercentOfAllocation: entry.riskPercentOfAllocation ?? null,
        riskReward: entry.riskReward ?? null,
        marketDataEnvironment: entry.marketData?.environment ?? null,
        marketDataSynthetic: entry.marketData?.isSynthetic ?? null,
        marketDataSource: entry.marketData?.source ?? null,
        marketObservedAt,
      },
    });

    return NextResponse.json({
      success: true,
      idempotent: false,
      journalId: created.id,
      createdAt: created.createdAt,
    });
  } catch (error) {
    logSecurityEvent({
      eventType: 'AI_DECISION_JOURNAL_WRITE_FAILED',
      route: '/api/trading/engine/decisions',
      userId: entry.userId,
      reason: error instanceof Error ? error.message : 'Unknown decision journal error',
    });
    return errorResponse(500, 'DECISION_JOURNAL_WRITE_FAILED', 'Failed to persist AI decision.');
  }
}
