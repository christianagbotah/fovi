import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';
import { getUserIdSync, authRequiredResponse } from '@/lib/get-user-id';
import { logSecurityEvent } from '@/lib/trading-policy';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let userId: string;
  try { userId = getUserIdSync(req); } catch { return authRequiredResponse(); }

  if (!db || !hasModel('bot') || !hasModel('aiDecisionJournal')) {
    return NextResponse.json(
      {
        error: 'AI decision history is temporarily unavailable.',
        code: 'DECISION_JOURNAL_UNAVAILABLE',
        remediationPhase: 'phase-2k-ai-decision-journal',
      },
      { status: 503 },
    );
  }

  const { id: botId } = await params;
  const limitRaw = Number(req.nextUrl.searchParams.get('limit') || 50);
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(100, Math.trunc(limitRaw)))
    : 50;

  try {
    const bot = await db.bot.findFirst({
      where: { id: botId, userId },
      select: { id: true },
    });
    if (!bot) {
      return NextResponse.json({ error: 'Bot not found' }, { status: 404 });
    }

    const decisions = await db.aiDecisionJournal.findMany({
      where: { botId, userId },
      select: {
        id: true,
        cycleId: true,
        stage: true,
        outcome: true,
        code: true,
        reason: true,
        symbol: true,
        side: true,
        confidence: true,
        strategy: true,
        timeframe: true,
        strategyVersion: true,
        riskEngineVersion: true,
        supervisorVersion: true,
        marketRegime: true,
        regimeEngineVersion: true,
        positionNotional: true,
        riskAmount: true,
        riskPercentOfAllocation: true,
        riskReward: true,
        marketDataEnvironment: true,
        marketDataSynthetic: true,
        marketDataSource: true,
        marketObservedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return NextResponse.json({
      botId,
      decisions,
    });
  } catch (error) {
    logSecurityEvent({
      eventType: 'AI_DECISION_JOURNAL_READ_FAILED',
      route: '/api/trading/bots/[id]/decisions',
      userId,
      reason: error instanceof Error ? error.message : 'Unknown decision journal read error',
    });
    return NextResponse.json(
      { error: 'Failed to fetch AI decision history.', code: 'DECISION_JOURNAL_READ_FAILED' },
      { status: 500 },
    );
  }
}
