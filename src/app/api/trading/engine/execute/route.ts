// ============================================================
// POST /api/trading/engine/execute
// Phase 2D: internal, idempotent PAPER execution adapter.
// ------------------------------------------------------------
// This route never constructs a live broker and never accepts a user session
// as execution authority. It requires internal-service authentication, an
// explicitly demo-only account, a canonical Phase 2C strategy/risk envelope,
// verified non-synthetic market-data provenance, and a separate paper-only
// feature flag. Fills are deterministic at the verified reference snapshot.
// ============================================================

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, hasModel } from '@/lib/db';
import { evaluateEngineAccountEligibility } from '@/lib/engine-eligibility';
import { enforceInternalAuth, logSecurityEvent } from '@/lib/trading-policy';
import { validateAutomatedBotConfiguration } from '@/lib/trading-intelligence/bot-policy';
import {
  EXECUTION_CONTRACT_VERSION,
  buildPaperPositionId,
  nearlyEqual,
  validatePaperExecutionIntent,
  type PaperExecutionIntent,
} from '@/lib/trading-intelligence/execution-contract';
import {
  RISK_ENGINE_VERSION,
  evaluateAutomatedTradeRisk,
} from '@/lib/trading-intelligence/risk-engine';
import { STRATEGY_ENGINE_VERSION } from '@/lib/trading-intelligence/strategy-engine';

const IntentSchema = z.object({
  contractVersion: z.literal(EXECUTION_CONTRACT_VERSION),
  executionIntentId: z.string().min(8).max(80),
  userId: z.string().min(1).max(191),
  botId: z.string().min(1).max(191),
  accountId: z.string().min(1).max(191),
  symbol: z.string().min(1).max(30).regex(/^[A-Za-z0-9/_.-]+$/),
  assetType: z.string().min(1).max(30).optional().default('unknown'),
  side: z.enum(['buy', 'sell']),
  quantity: z.number().positive().max(1_000_000_000),
  referencePrice: z.number().positive(),
  stopLoss: z.number().positive(),
  takeProfit: z.number().positive(),
  confidence: z.number().min(0).max(100),
  strategy: z.string().min(1).max(50),
  timeframe: z.string().min(1).max(20),
  strategyVersion: z.string().min(1).max(100),
  riskEngineVersion: z.string().min(1).max(100),
  positionNotional: z.number().positive(),
  riskAmount: z.number().positive(),
  riskPercentOfAllocation: z.number().positive(),
  riskReward: z.number().positive(),
  reason: z.string().min(1).max(4000),
  marketData: z.object({
    environment: z.enum(['live', 'demo', 'unknown']),
    isSynthetic: z.boolean(),
    source: z.string().min(1).max(200),
    observedAt: z.string().min(1).max(100),
  }),
});

function envBool(name: string): boolean {
  const raw = process.env[name];
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

export function isPaperAutomatedExecutionEnabled(): boolean {
  return envBool('PAPER_AUTOMATED_EXECUTION_ENABLED');
}

function executionError(status: number, code: string, error: string) {
  return NextResponse.json(
    { error, code, remediationPhase: 'phase-2d-execution-reconciliation' },
    { status },
  );
}

function sameRiskDecision(intent: PaperExecutionIntent, decision: {
  quantity: number;
  positionNotional: number;
  riskAmount: number;
  riskPercentOfAllocation: number;
  riskReward: number;
}): boolean {
  return nearlyEqual(intent.quantity, decision.quantity)
    && nearlyEqual(intent.positionNotional, decision.positionNotional)
    && nearlyEqual(intent.riskAmount, decision.riskAmount)
    && nearlyEqual(intent.riskPercentOfAllocation, decision.riskPercentOfAllocation)
    && nearlyEqual(intent.riskReward, decision.riskReward);
}

export async function POST(req: Request) {
  const authError = enforceInternalAuth(req);
  if (authError) return authError;

  if (!isPaperAutomatedExecutionEnabled()) {
    return executionError(
      403,
      'PHASE2D_PAPER_EXECUTION_DISABLED',
      'Automated paper execution is disabled. No order was created.',
    );
  }

  const raw = await req.json().catch(() => null);
  const parsed = IntentSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return executionError(
      400,
      'INVALID_EXECUTION_INTENT',
      `Invalid execution intent: ${first?.path.join('.') || 'field'} — ${first?.message}`,
    );
  }

  const intent = parsed.data as PaperExecutionIntent;
  const integrity = validatePaperExecutionIntent(intent);
  if (!integrity.valid) {
    logSecurityEvent({
      eventType: 'PAPER_EXECUTION_INTENT_REJECTED',
      route: '/api/trading/engine/execute',
      userId: intent.userId,
      reason: `${integrity.code}: ${integrity.reason}`,
    });
    return executionError(400, integrity.code, integrity.reason);
  }

  if (intent.strategyVersion !== STRATEGY_ENGINE_VERSION || intent.riskEngineVersion !== RISK_ENGINE_VERSION) {
    return executionError(
      409,
      'DECISION_VERSION_MISMATCH',
      'Execution intent was not produced by the currently authorized strategy/risk engine versions.',
    );
  }

  if (!db || !hasModel('bot') || !hasModel('order') || !hasModel('position')) {
    return executionError(503, 'SERVICE_UNAVAILABLE', 'Execution persistence is unavailable. No order was created.');
  }

  try {
    const bot = await db.bot.findFirst({
      where: {
        id: intent.botId,
        userId: intent.userId,
        accountId: intent.accountId,
        enabled: true,
        status: 'running',
      },
      include: { account: true },
    });

    if (!bot || !bot.account) {
      return executionError(403, 'BOT_EXECUTION_INELIGIBLE', 'Bot/account execution configuration is not eligible.');
    }

    const eligibility = evaluateEngineAccountEligibility({
      broker: bot.account.broker,
      accountType: bot.account.accountType,
      isDemo: bot.account.isDemo,
      isActive: bot.account.isActive,
      apiKey: bot.account.apiKey,
      apiSecret: bot.account.apiSecret,
      passphrase: bot.account.passphrase,
    });
    if (!eligibility.eligible) {
      logSecurityEvent({
        eventType: 'PAPER_EXECUTION_ACCOUNT_REJECTED',
        route: '/api/trading/engine/execute',
        userId: intent.userId,
        reason: eligibility.reason || 'Demo-only execution eligibility failed',
      });
      return executionError(403, 'BOT_EXECUTION_INELIGIBLE', 'Account failed demo-only execution eligibility.');
    }

    const botPolicy = validateAutomatedBotConfiguration({
      strategy: bot.strategy,
      timeframe: bot.timeframe,
      allocationAmount: bot.allocationAmount,
      riskPerTrade: bot.riskPerTrade,
      maxPositions: bot.maxPositions,
      accountBalance: bot.account.balance,
    });
    if (!botPolicy.valid) {
      return executionError(409, botPolicy.code, botPolicy.reason);
    }

    if (
      bot.strategy.trim().toLowerCase() !== intent.strategy.trim().toLowerCase()
      || bot.timeframe.trim().toLowerCase() !== intent.timeframe.trim().toLowerCase()
    ) {
      return executionError(
        409,
        'BOT_DECISION_CONFIG_CHANGED',
        'Bot strategy/timeframe changed after the execution decision was created.',
      );
    }

    // Durable idempotency: the deterministic execution-intent ID IS the Order ID.
    // A retry can only return the already-persisted result; it cannot place a
    // second paper fill for the same canonical decision.
    const existingOrder = await db.order.findUnique({ where: { id: intent.executionIntentId } });
    if (existingOrder) {
      const existingPosition = await db.position.findFirst({
        where: {
          botId: intent.botId,
          accountId: intent.accountId,
          symbol: intent.symbol,
          status: 'open',
        },
      });
      return NextResponse.json({
        executionEnvironment: 'paper',
        idempotent: true,
        order: existingOrder,
        position: existingPosition,
      });
    }

    const currentOpenPositions = await db.position.count({
      where: { botId: intent.botId, accountId: intent.accountId, status: 'open' },
    });

    const riskDecision = evaluateAutomatedTradeRisk(
      {
        symbol: intent.symbol,
        side: intent.side,
        entryPrice: intent.referencePrice,
        stopLoss: intent.stopLoss,
        takeProfit: intent.takeProfit,
        confidence: intent.confidence,
        strategy: intent.strategy,
        timeframe: intent.timeframe,
      },
      {
        accountBalance: bot.account.balance,
        allocationAmount: bot.allocationAmount,
        riskPerTradePct: bot.riskPerTrade,
        maxPositions: bot.maxPositions,
        currentOpenPositions,
      },
    );

    if (!riskDecision.approved) {
      return executionError(409, `RISK_REJECTED_${riskDecision.code}`, riskDecision.reason);
    }
    if (!sameRiskDecision(intent, riskDecision)) {
      return executionError(
        409,
        'RISK_DECISION_MISMATCH',
        'Execution quantity/risk metrics no longer match canonical server-side risk evaluation.',
      );
    }

    const existingSymbolPosition = await db.position.findFirst({
      where: {
        botId: intent.botId,
        accountId: intent.accountId,
        symbol: intent.symbol,
        status: 'open',
      },
    });
    if (existingSymbolPosition) {
      return executionError(409, 'POSITION_ALREADY_OPEN', 'An open position already exists for this bot and symbol.');
    }

    const positionId = buildPaperPositionId(intent);
    const auditEnvelope = JSON.stringify({
      executionContractVersion: intent.contractVersion,
      executionEnvironment: 'paper',
      strategy: intent.strategy,
      timeframe: intent.timeframe,
      strategyVersion: intent.strategyVersion,
      riskEngineVersion: intent.riskEngineVersion,
      confidence: intent.confidence,
      referencePrice: intent.referencePrice,
      stopLoss: intent.stopLoss,
      takeProfit: intent.takeProfit,
      marketData: intent.marketData,
      risk: {
        positionNotional: intent.positionNotional,
        riskAmount: intent.riskAmount,
        riskPercentOfAllocation: intent.riskPercentOfAllocation,
        riskReward: intent.riskReward,
      },
      decisionReason: intent.reason,
    });

    const persisted = await db.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          id: intent.executionIntentId,
          accountId: intent.accountId,
          botId: intent.botId,
          brokerOrderId: `PAPER_${intent.executionIntentId.slice(4, 28)}`,
          symbol: intent.symbol,
          assetType: intent.assetType || 'unknown',
          side: intent.side,
          type: 'market',
          qty: intent.quantity,
          stopPrice: intent.stopLoss,
          filledQty: intent.quantity,
          filledPrice: intent.referencePrice,
          status: 'filled',
          aiGenerated: true,
          reason: auditEnvelope,
        },
      });

      const position = await tx.position.create({
        data: {
          id: positionId,
          accountId: intent.accountId,
          botId: intent.botId,
          symbol: intent.symbol,
          assetType: intent.assetType || 'unknown',
          side: intent.side === 'buy' ? 'long' : 'short',
          qty: intent.quantity,
          avgEntryPrice: intent.referencePrice,
          currentPrice: intent.referencePrice,
          unrealizedPnl: 0,
          realizedPnl: 0,
          stopLoss: intent.stopLoss,
          takeProfit: intent.takeProfit,
          status: 'open',
          openedAt: new Date(),
        },
      });

      return { order, position };
    });

    logSecurityEvent({
      eventType: 'PAPER_EXECUTION_FILLED',
      route: '/api/trading/engine/execute',
      userId: intent.userId,
      reason: `Paper fill ${intent.executionIntentId} ${intent.side} ${intent.quantity} ${intent.symbol} @ ${intent.referencePrice}`,
    });

    return NextResponse.json({
      executionEnvironment: 'paper',
      idempotent: false,
      order: persisted.order,
      position: persisted.position,
    });
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code === 'P2002') {
      const existingOrder = await db.order.findUnique({ where: { id: intent.executionIntentId } }).catch(() => null);
      if (existingOrder) {
        const existingPosition = await db.position.findFirst({
          where: {
            botId: intent.botId,
            accountId: intent.accountId,
            symbol: intent.symbol,
            status: 'open',
          },
        }).catch(() => null);
        if (existingPosition) {
          return NextResponse.json({
            executionEnvironment: 'paper',
            idempotent: true,
            order: existingOrder,
            position: existingPosition,
          });
        }
      }
      return executionError(409, 'EXECUTION_CONFLICT', 'Concurrent paper execution conflicted with existing state.');
    }

    logSecurityEvent({
      eventType: 'PAPER_EXECUTION_ERROR',
      route: '/api/trading/engine/execute',
      userId: intent.userId,
      reason: error instanceof Error ? error.message : 'Unknown execution error',
    });
    return executionError(500, 'PAPER_EXECUTION_FAILED', 'Paper execution failed atomically. No partial fill was accepted.');
  }
}
