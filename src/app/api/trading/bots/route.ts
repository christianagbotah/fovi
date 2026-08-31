import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';
import { getUserIdSync, AuthRequiredError, authRequiredResponse } from '@/lib/get-user-id';
import { checkSubscriptionLimit, getLimitMessage } from '@/lib/subscription-guard';
import { isExplicitlyDemo, logSecurityEvent } from '@/lib/trading-policy';
import {
  AUTOMATED_BOT_VERIFIED_TIMEFRAME,
  validateAutomatedBotConfiguration,
} from '@/lib/trading-intelligence/bot-policy';

export async function GET(req: NextRequest) {
  if (!db || !hasModel('bot')) {
    try {
      getUserIdSync(req);
    } catch {
      return authRequiredResponse();
    }
    return NextResponse.json(
      { error: 'Bot data is temporarily unavailable.', code: 'SERVICE_UNAVAILABLE', remediationPhase: 'containment' },
      { status: 503 },
    );
  }
  try {
    const userId = getUserIdSync(req);
    const bots = await db.bot.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
    return NextResponse.json(bots);
  } catch (error) {
    if (error instanceof AuthRequiredError) return authRequiredResponse();
    logSecurityEvent({
      eventType: 'BOTS_GET_ERROR', route: '/api/trading/bots',
      reason: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json({ error: 'Failed to fetch bots' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let userId: string;
  try {
    userId = getUserIdSync(req);
  } catch {
    return authRequiredResponse();
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>;

  if (!db || !hasModel('bot')) {
    return NextResponse.json(
      { error: 'Bot creation is temporarily unavailable.', code: 'SERVICE_UNAVAILABLE', remediationPhase: 'containment' },
      { status: 503 },
    );
  }

  try {
    const botCheck = await checkSubscriptionLimit(userId, 'maxBots');
    if (!botCheck.allowed) {
      return NextResponse.json(
        { error: getLimitMessage('maxBots'), current: botCheck.current, limit: botCheck.limit },
        { status: 403 },
      );
    }

    let account = await db.tradingAccount.findFirst({ where: { userId, isDefault: true } });
    if (!account) account = await db.tradingAccount.findFirst({ where: { userId } });
    if (!account) {
      return NextResponse.json(
        { error: 'No trading account found. Create a demo account first.' },
        { status: 404 },
      );
    }

    if (!isExplicitlyDemo(account)) {
      return NextResponse.json(
        {
          error: 'Phase 1 containment: bot creation requires an explicitly demo account.',
          code: 'PHASE1_LIVE_TRADING_DISABLED', remediationPhase: 'containment',
        },
        { status: 403 },
      );
    }

    const strategy = typeof body.strategy === 'string' ? body.strategy : 'signal_based';
    const timeframe = typeof body.timeframe === 'string' ? body.timeframe : AUTOMATED_BOT_VERIFIED_TIMEFRAME;
    const defaultAllocation = Math.min(10_000, account.balance);
    const allocationAmount = body.allocationAmount === undefined ? defaultAllocation : Number(body.allocationAmount);
    const riskPerTrade = body.riskPerTrade === undefined ? 2 : Number(body.riskPerTrade);
    const maxPositions = body.maxPositions === undefined ? 3 : Number(body.maxPositions);

    const policy = validateAutomatedBotConfiguration({
      strategy,
      timeframe,
      allocationAmount,
      riskPerTrade,
      maxPositions,
      accountBalance: account.balance,
    });
    if (!policy.valid) {
      return NextResponse.json(
        {
          error: policy.reason,
          code: policy.code,
          remediationPhase: 'phase-2c',
          dataPolicy: 'verified-only',
        },
        { status: 400 },
      );
    }

    const requestedEnabled = body.enabled === true;
    const created = await db.bot.create({
      data: {
        userId,
        accountId: account.id,
        name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'New Bot',
        strategy,
        symbols: typeof body.symbols === 'string' && body.symbols.trim() ? body.symbols : 'BTC',
        timeframe: AUTOMATED_BOT_VERIFIED_TIMEFRAME,
        allocationAmount,
        enabled: requestedEnabled,
        status: requestedEnabled ? 'running' : 'stopped',
        config: body.config && typeof body.config === 'object' ? JSON.stringify(body.config) : '{}',
        positionSizing: 'canonical_risk_v1',
        riskPerTrade,
        maxPositions,
        stopLossPercent: body.stopLossPercent === undefined ? 2 : Number(body.stopLossPercent),
        takeProfitPercent: body.takeProfitPercent === undefined ? 4 : Number(body.takeProfitPercent),
        trailingStopPct: body.trailingStopPct === undefined ? 0 : Number(body.trailingStopPct),
        tradingSessions: typeof body.tradingSessions === 'string' ? body.tradingSessions : 'all',
        customSessionStart: typeof body.customSessionStart === 'string' ? body.customSessionStart : null,
        customSessionEnd: typeof body.customSessionEnd === 'string' ? body.customSessionEnd : null,
      },
    });
    return NextResponse.json(created);
  } catch (error) {
    logSecurityEvent({
      eventType: 'BOTS_POST_ERROR', route: '/api/trading/bots', userId,
      reason: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: `Failed to create bot: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 },
    );
  }
}
