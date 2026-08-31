// ============================================================
// GET /api/trading/engine/positions
// Phase 2E: authoritative restart hydration for automated paper positions.
// ------------------------------------------------------------
// Internal-service only. Returns persisted open Phase 2D paper positions for
// currently eligible/running bots. No broker construction and no demo-memory
// fallback are permitted. Failure means the engine must not process a cycle.
// ============================================================

import { NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';
import { evaluateEngineAccountEligibility } from '@/lib/engine-eligibility';
import { enforceInternalAuth, logSecurityEvent } from '@/lib/trading-policy';
import { validateAutomatedBotConfiguration } from '@/lib/trading-intelligence/bot-policy';

export async function GET(req: Request) {
  const authError = enforceInternalAuth(req);
  if (authError) return authError;

  if (!db || !hasModel('position')) {
    return NextResponse.json(
      {
        error: 'Paper position persistence is unavailable.',
        code: 'SERVICE_UNAVAILABLE',
        remediationPhase: 'phase-2e-position-close-restart-reconciliation',
      },
      { status: 503 },
    );
  }

  try {
    const positions = await db.position.findMany({
      where: {
        status: 'open',
        id: { startsWith: 'ppos_' },
        botId: { not: null },
      },
      include: {
        account: true,
        bot: true,
      },
      orderBy: { openedAt: 'asc' },
    });

    const safe = positions.flatMap((position) => {
      const account = position.account;
      const bot = position.bot;
      if (!account || !bot || !position.botId) return [];
      if (bot.id !== position.botId || bot.accountId !== position.accountId || bot.userId !== account.userId) return [];
      if (bot.enabled !== true || bot.status !== 'running') return [];

      const eligibility = evaluateEngineAccountEligibility({
        broker: account.broker,
        accountType: account.accountType,
        isDemo: account.isDemo,
        isActive: account.isActive,
        apiKey: account.apiKey,
        apiSecret: account.apiSecret,
        passphrase: account.passphrase,
      });
      if (!eligibility.eligible) return [];

      const botPolicy = validateAutomatedBotConfiguration({
        strategy: bot.strategy,
        timeframe: bot.timeframe,
        allocationAmount: bot.allocationAmount,
        riskPerTrade: bot.riskPerTrade,
        maxPositions: bot.maxPositions,
        accountBalance: account.balance,
      });
      if (!botPolicy.valid) return [];

      return [{
        id: position.id,
        botId: position.botId,
        accountId: position.accountId,
        symbol: position.symbol,
        side: position.side,
        qty: position.qty,
        avgEntryPrice: position.avgEntryPrice,
        currentPrice: position.currentPrice,
        stopLoss: position.stopLoss,
        takeProfit: position.takeProfit,
        openedAt: position.openedAt,
        unrealizedPnl: position.unrealizedPnl,
        executionEnvironment: 'paper',
      }];
    });

    return NextResponse.json(safe, {
      headers: {
        'x-execution-environment': 'paper',
        'x-storage': 'db',
      },
    });
  } catch (error) {
    logSecurityEvent({
      eventType: 'PAPER_POSITION_HYDRATION_ERROR',
      route: '/api/trading/engine/positions',
      reason: error instanceof Error ? error.message : 'Unknown hydration error',
    });
    return NextResponse.json(
      {
        error: 'Failed to load authoritative paper positions.',
        code: 'PAPER_POSITION_HYDRATION_FAILED',
        remediationPhase: 'phase-2e-position-close-restart-reconciliation',
      },
      { status: 500 },
    );
  }
}
