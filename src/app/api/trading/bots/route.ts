import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';
import { getUserId, getUserIdSync, AuthRequiredError, authRequiredResponse } from '@/lib/get-user-id';
import { checkSubscriptionLimit, getLimitMessage } from '@/lib/subscription-guard';
import { isExplicitlyDemo, DEMO_PROVENANCE_HEADER, logSecurityEvent } from '@/lib/trading-policy';

// Static demo bots for read-only fallback when DB is unavailable.
// These are NEVER persisted and carry demo provenance.
const DEMO_BOTS = [
  {
    id: 'bot_demo_1',
    name: 'Momentum Hunter',
    strategy: 'momentum',
    symbols: 'NVDA,AAPL,TSLA',
    timeframe: '1h',
    allocationAmount: 25000,
    enabled: true,
    status: 'running',
    totalTrades: 142,
    winTrades: 86,
    lossTrades: 56,
    totalPnl: 3245.75,
    createdAt: new Date(Date.now() - 86400000 * 14).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'bot_demo_2',
    name: 'Grid Master BTC',
    strategy: 'grid',
    symbols: 'BTC,ETH',
    timeframe: '15m',
    allocationAmount: 15000,
    enabled: true,
    status: 'running',
    totalTrades: 528,
    winTrades: 312,
    lossTrades: 216,
    totalPnl: 1875.40,
    createdAt: new Date(Date.now() - 86400000 * 30).toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

export async function GET(req: NextRequest) {
  if (!db || !hasModel('bot')) {
    // CR4.1: Auth before fallback — require auth even when DB is unavailable
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
    const bots = await db.bot.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(bots);
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      return authRequiredResponse();
    }
    logSecurityEvent({
      eventType: 'BOTS_GET_ERROR',
      route: '/api/trading/bots',
      reason: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json({ error: 'Failed to fetch bots' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));

  if (!db || !hasModel('bot')) {
    return NextResponse.json(
      { error: 'Bot creation is temporarily unavailable.', code: 'SERVICE_UNAVAILABLE', remediationPhase: 'containment' },
      { status: 503 },
    );
  }

  let userId: string;
  try {
    userId = await getUserId(req);
  } catch {
    return authRequiredResponse();
  }

  try {
    // --- Subscription limit check ---
    const botCheck = await checkSubscriptionLimit(userId, 'maxBots');
    if (!botCheck.allowed) {
      return NextResponse.json(
        { error: getLimitMessage('maxBots'), current: botCheck.current, limit: botCheck.limit },
        { status: 403 },
      );
    }

    // Find or default account
    let account = await db.tradingAccount.findFirst({
      where: { userId, isDefault: true },
    });
    if (!account) {
      account = await db.tradingAccount.findFirst({ where: { userId } });
    }
    if (!account) {
      return NextResponse.json(
        { error: 'No trading account found. Create a demo account first.' },
        { status: 404 },
      );
    }

    // CR4.1: Reject non-demo, unknown, null, or conflicting accounts for bot creation
    if (!isExplicitlyDemo(account)) {
      return NextResponse.json(
        {
          error: 'Phase 1 containment: bot creation requires an explicitly demo account.',
          code: 'PHASE1_LIVE_TRADING_DISABLED',
          remediationPhase: 'containment',
        },
        { status: 403 },
      );
    }

    const created = await db.bot.create({
      data: {
        userId,
        accountId: account.id,
        name: body.name || 'New Bot',
        strategy: body.strategy || 'signal_based',
        symbols: body.symbols || 'BTC',
        timeframe: body.timeframe || '1h',
        allocationAmount: body.allocationAmount ?? 10000,
        enabled: isExplicitlyDemo(account) ? (body.enabled ?? false) : false,
        status: isExplicitlyDemo(account) ? (body.status ?? 'stopped') : 'stopped',
        config: body.config ? JSON.stringify(body.config) : '{}',
        positionSizing: body.positionSizing || 'fixed_fractional',
        riskPerTrade: body.riskPerTrade ?? 2.0,
        maxPositions: body.maxPositions ?? 3,
        stopLossPercent: body.stopLossPercent ?? 2.0,
        takeProfitPercent: body.takeProfitPercent ?? 4.0,
        trailingStopPct: body.trailingStopPct ?? 0,
        tradingSessions: body.tradingSessions || 'all',
        customSessionStart: body.customSessionStart ?? null,
        customSessionEnd: body.customSessionEnd ?? null,
      },
    });
    return NextResponse.json(created);
  } catch (error) {
    logSecurityEvent({
      eventType: 'BOTS_POST_ERROR',
      route: '/api/trading/bots',
      userId,
      reason: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: `Failed to create bot: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 },
    );
  }
}
