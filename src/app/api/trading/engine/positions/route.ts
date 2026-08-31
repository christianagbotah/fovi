// ============================================================
// GET /api/trading/engine/positions
// Phase 2F: authoritative restart hydration for automated paper positions.
// ------------------------------------------------------------
// Internal-service only. Returns persisted open paper positions for currently
// eligible/running bots. Every returned position must be backed by exactly one
// valid deterministic filled opening Order. No broker construction and no
// demo-memory fallback are permitted. Failure means the engine must not
// process a cycle.
// ============================================================

import { NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';
import { evaluateEngineAccountEligibility } from '@/lib/engine-eligibility';
import { enforceInternalAuth, logSecurityEvent } from '@/lib/trading-policy';
import { validateAutomatedBotConfiguration } from '@/lib/trading-intelligence/bot-policy';
import {
  PAPER_LIFECYCLE_ATTESTATION_VERSION,
  validatePaperOpeningOrderForPosition,
} from '@/lib/trading-intelligence/paper-lifecycle';

function hydrationError(status: number, code: string, error: string) {
  return NextResponse.json(
    { error, code, remediationPhase: 'phase-2f-paper-lifecycle-recovery' },
    { status },
  );
}

export async function GET(req: Request) {
  const authError = enforceInternalAuth(req);
  if (authError) return authError;

  if (!db || !hasModel('position') || !hasModel('order')) {
    return hydrationError(503, 'SERVICE_UNAVAILABLE', 'Paper lifecycle persistence is unavailable.');
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

    const activeCandidates = positions.filter((position) => {
      const account = position.account;
      const bot = position.bot;
      if (!account || !bot || !position.botId) return false;
      if (bot.id !== position.botId || bot.accountId !== position.accountId || bot.userId !== account.userId) return false;
      if (bot.enabled !== true || bot.status !== 'running') return false;

      const eligibility = evaluateEngineAccountEligibility({
        broker: account.broker,
        accountType: account.accountType,
        isDemo: account.isDemo,
        isActive: account.isActive,
        apiKey: account.apiKey,
        apiSecret: account.apiSecret,
        passphrase: account.passphrase,
      });
      if (!eligibility.eligible) return false;

      const botPolicy = validateAutomatedBotConfiguration({
        strategy: bot.strategy,
        timeframe: bot.timeframe,
        allocationAmount: bot.allocationAmount,
        riskPerTrade: bot.riskPerTrade,
        maxPositions: bot.maxPositions,
        accountBalance: account.balance,
      });
      return botPolicy.valid;
    });

    if (activeCandidates.length === 0) {
      return NextResponse.json([], {
        headers: {
          'x-execution-environment': 'paper',
          'x-storage': 'db',
          'x-lifecycle-attestation': PAPER_LIFECYCLE_ATTESTATION_VERSION,
        },
      });
    }

    const openingOrders = await db.order.findMany({
      where: {
        id: { startsWith: 'pxi_' },
        status: 'filled',
        aiGenerated: true,
        botId: { not: null },
        OR: activeCandidates.map((position) => ({
          accountId: position.accountId,
          botId: position.botId,
          symbol: position.symbol,
        })),
      },
      orderBy: { createdAt: 'asc' },
    });

    const safe = activeCandidates.map((position) => {
      const matches = openingOrders.flatMap((order) => {
        const attestation = validatePaperOpeningOrderForPosition(order, position);
        return attestation.valid ? [{ order, attestation }] : [];
      });

      if (matches.length !== 1) {
        throw new Error(
          `Paper lifecycle attestation failed for ${position.id}: expected exactly one opening order, found ${matches.length}.`,
        );
      }

      const { order, attestation } = matches[0];
      return {
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
        lifecycleAttestation: PAPER_LIFECYCLE_ATTESTATION_VERSION,
        lifecycle: attestation.lifecycle,
        openingOrderId: order.id,
      };
    });

    return NextResponse.json(safe, {
      headers: {
        'x-execution-environment': 'paper',
        'x-storage': 'db',
        'x-lifecycle-attestation': PAPER_LIFECYCLE_ATTESTATION_VERSION,
      },
    });
  } catch (error) {
    logSecurityEvent({
      eventType: 'PAPER_POSITION_HYDRATION_ERROR',
      route: '/api/trading/engine/positions',
      reason: error instanceof Error ? error.message : 'Unknown hydration error',
    });
    return hydrationError(
      409,
      'PAPER_POSITION_LIFECYCLE_INCONSISTENT',
      'Authoritative paper positions could not be reconciled to deterministic opening-order truth.',
    );
  }
}
