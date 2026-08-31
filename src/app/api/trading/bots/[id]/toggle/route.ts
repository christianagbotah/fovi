import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';
import { getUserIdSync, AuthRequiredError, authRequiredResponse } from '@/lib/get-user-id';
import { isExplicitlyDemo, CONTAINMENT_CODES, logSecurityEvent } from '@/lib/trading-policy';
import { validateAutomatedBotConfiguration } from '@/lib/trading-intelligence/bot-policy';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let userId: string;
  try { userId = getUserIdSync(req); } catch { return authRequiredResponse(); }
  const { id } = await params;

  if (!db || !hasModel('bot')) {
    return NextResponse.json(
      { error: 'Bot toggle is temporarily unavailable.', code: 'SERVICE_UNAVAILABLE', remediationPhase: 'containment' },
      { status: 503 },
    );
  }

  try {
    const bot = await db.bot.findFirst({
      where: { id, userId },
      include: { account: true },
    });
    if (!bot) return NextResponse.json({ error: 'Bot not found' }, { status: 404 });

    const newEnabled = !bot.enabled;
    if (newEnabled) {
      if (!bot.account) {
        return NextResponse.json(
          {
            error: 'Phase 1 containment: cannot enable bot without an account.',
            code: CONTAINMENT_CODES.PHASE1_LIVE_TRADING_DISABLED,
            remediationPhase: 'containment',
          },
          { status: 403 },
        );
      }
      if (!isExplicitlyDemo(bot.account)) {
        return NextResponse.json(
          {
            error: 'Phase 1 containment: live trading is not permitted.',
            code: CONTAINMENT_CODES.PHASE1_LIVE_TRADING_DISABLED,
            remediationPhase: 'containment',
          },
          { status: 403 },
        );
      }

      const policy = validateAutomatedBotConfiguration({
        strategy: bot.strategy,
        timeframe: bot.timeframe,
        allocationAmount: bot.allocationAmount,
        riskPerTrade: bot.riskPerTrade,
        maxPositions: bot.maxPositions,
        accountBalance: bot.account.balance,
      });
      if (!policy.valid) {
        return NextResponse.json(
          {
            error: policy.reason,
            code: policy.code,
            remediationPhase: 'phase-2c',
            dataPolicy: 'verified-only',
          },
          { status: 409 },
        );
      }
    }

    const newStatus = newEnabled ? 'running' : 'stopped';
    const { count } = await db.bot.updateMany({
      where: { id, userId },
      data: {
        enabled: newEnabled,
        status: newStatus,
        ...(newEnabled ? { positionSizing: 'canonical_risk_v1' } : {}),
      },
    });
    if (count === 0) return NextResponse.json({ error: 'Bot not found' }, { status: 404 });

    return NextResponse.json({ success: true, enabled: newEnabled, status: newStatus });
  } catch (error) {
    if (error instanceof AuthRequiredError) return authRequiredResponse();
    logSecurityEvent({
      eventType: 'BOTS_TOGGLE_ERROR', route: '/api/trading/bots/[id]/toggle', userId,
      reason: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json({ error: 'Failed to toggle bot' }, { status: 500 });
  }
}
