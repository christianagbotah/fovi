import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel, ensureDemoUser, DEMO_USER_ID } from '@/lib/db';
import { authFirst } from '@/lib/auth-first';
import { checkSubscriptionLimit, getLimitMessage } from '@/lib/subscription-guard';

const DEMO_BOTS = [
  {
    id: 'bot_demo_1',
    userId: 'usr_demo_1',
    accountId: 'acc_demo_1',
    name: 'Momentum Hunter',
    strategy: 'momentum',
    symbols: 'NVDA,AAPL,TSLA',
    timeframe: '1h',
    allocationAmount: 25000,
    enabled: true,
    status: 'running',
    config: '{}',
    positionSizing: 'fixed_fractional',
    riskPerTrade: 2.0,
    maxPositions: 3,
    stopLossPercent: 2.0,
    takeProfitPercent: 4.0,
    trailingStopPct: 1.5,
    tradingSessions: 'all',
    customSessionStart: null,
    customSessionEnd: null,
    totalTrades: 142,
    winTrades: 86,
    lossTrades: 56,
    totalPnl: 3245.75,
    bestTrade: 845.20,
    worstTrade: -312.40,
    currentStreak: 4,
    lastTradeAt: new Date(Date.now() - 3600000).toISOString(),
    lastError: null,
    createdAt: new Date(Date.now() - 86400000 * 14).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'bot_demo_2',
    userId: 'usr_demo_1',
    accountId: 'acc_demo_1',
    name: 'Grid Master BTC',
    strategy: 'grid',
    symbols: 'BTC,ETH',
    timeframe: '15m',
    allocationAmount: 15000,
    enabled: true,
    status: 'running',
    config: '{"gridLevels":8,"gridSpacing":1.5}',
    positionSizing: 'fixed',
    riskPerTrade: 1.5,
    maxPositions: 8,
    stopLossPercent: 3.0,
    takeProfitPercent: 2.0,
    trailingStopPct: 0,
    tradingSessions: 'all',
    customSessionStart: null,
    customSessionEnd: null,
    totalTrades: 528,
    winTrades: 312,
    lossTrades: 216,
    totalPnl: 1875.40,
    bestTrade: 220.10,
    worstTrade: -180.50,
    currentStreak: 2,
    lastTradeAt: new Date(Date.now() - 1800000).toISOString(),
    lastError: null,
    createdAt: new Date(Date.now() - 86400000 * 30).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'bot_demo_3',
    userId: 'usr_demo_1',
    accountId: 'acc_demo_1',
    name: 'DCA Steady ETH',
    strategy: 'dca',
    symbols: 'ETH',
    timeframe: '1d',
    allocationAmount: 10000,
    enabled: false,
    status: 'stopped',
    config: '{"dcaTotalBuys":10,"dcaInterval":1440}',
    positionSizing: 'fixed',
    riskPerTrade: 1.0,
    maxPositions: 1,
    stopLossPercent: 5.0,
    takeProfitPercent: 10.0,
    trailingStopPct: 0,
    tradingSessions: 'all',
    customSessionStart: null,
    customSessionEnd: null,
    totalTrades: 47,
    winTrades: 28,
    lossTrades: 19,
    totalPnl: 642.30,
    bestTrade: 245.80,
    worstTrade: -120.10,
    currentStreak: 0,
    lastTradeAt: new Date(Date.now() - 86400000 * 2).toISOString(),
    lastError: null,
    createdAt: new Date(Date.now() - 86400000 * 60).toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

export async function GET(req: NextRequest) {
  const userId = authFirst(req);
  if (!db || !hasModel('bot')) {
    return NextResponse.json(DEMO_BOTS, { headers: { 'x-demo': 'true' } });
  }
  try {
    const bots = await db.bot.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(bots);
  } catch (error) {
    // ANY database error falls back to demo
    console.warn('[bots GET] DB error, using fallback:', error);
    return NextResponse.json(DEMO_BOTS, { headers: { 'x-demo': 'true' } });
  }
}

export async function POST(req: NextRequest) {
  const userId = authFirst(req);
  const body = await req.json().catch(() => ({}));
  if (!db || !hasModel('bot')) {
    const created = {
      id: `bot_demo_${Date.now()}`,
      userId: 'usr_demo_1',
      accountId: body.accountId || 'acc_demo_1',
      name: body.name || 'New Bot',
      strategy: body.strategy || 'signal_based',
      symbols: body.symbols || 'BTC',
      timeframe: body.timeframe || '1h',
      allocationAmount: body.allocationAmount ?? 10000,
      enabled: body.enabled ?? false,
      status: 'stopped',
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
      totalTrades: 0,
      winTrades: 0,
      lossTrades: 0,
      totalPnl: 0,
      bestTrade: 0,
      worstTrade: 0,
      currentStreak: 0,
      lastTradeAt: null,
      lastError: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return NextResponse.json(created, { headers: { 'x-demo': 'true' } });
  }
  try {
    await ensureDemoUser();
    if (!userId) {
      // Fallback to demo response if DB or user unavailable
      const fallback1 = {
        id: `bot_demo_${Date.now()}`,
        userId: DEMO_USER_ID,
        accountId: 'acc_demo_1',
        name: body.name || 'New Bot',
        strategy: body.strategy || 'signal_based',
        symbols: body.symbols || 'BTC',
        timeframe: body.timeframe || '1h',
        allocationAmount: body.allocationAmount ?? 10000,
        enabled: body.enabled ?? false,
        status: 'stopped',
        config: body.config ? JSON.stringify(body.config) : '{}',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      return NextResponse.json(fallback1, { headers: { 'x-demo': 'true' } });
    }

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
      // Fallback to demo response if no account exists
      const fallback2 = {
        id: `bot_demo_${Date.now()}`,
        userId,
        accountId: 'acc_demo_1',
        name: body.name || 'New Bot',
        strategy: body.strategy || 'signal_based',
        symbols: body.symbols || 'BTC',
        timeframe: body.timeframe || '1h',
        allocationAmount: body.allocationAmount ?? 10000,
        enabled: body.enabled ?? false,
        status: 'stopped',
        config: body.config ? JSON.stringify(body.config) : '{}',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      return NextResponse.json(fallback2, { headers: { 'x-demo': 'true' } });
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
        enabled: body.enabled ?? false,
        status: 'stopped',
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
    // ANY database error falls back to demo
    console.warn('[bots POST] DB error, using fallback:', error);
    const fallback3 = {
      id: `bot_demo_${Date.now()}`,
      userId: 'usr_demo_1',
      accountId: body.accountId || 'acc_demo_1',
      name: body.name || 'New Bot',
      strategy: body.strategy || 'signal_based',
      symbols: body.symbols || 'BTC',
      createdAt: new Date().toISOString(),
    };
    return NextResponse.json(fallback3, { headers: { 'x-demo': 'true' } });
  }
}
