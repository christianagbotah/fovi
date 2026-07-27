import { NextResponse } from 'next/server';
import { db, hasModel, ensureDemoUser } from '@/lib/db';

const DEFAULT_CONFIG = {
  id: null, enabled: false, allocationAmount: 0, riskTolerance: 'medium',
  maxPositions: 5, maxPositionSize: 0, stopLossPercent: 2.0, takeProfitPercent: 4.0,
  strategy: 'balanced', status: 'stopped', totalTrades: 0, winTrades: 0,
  totalPnl: 0, winRate: 0, lastTradeAt: null, lastError: null, accountBalance: 100000,
};

// GET /api/trading/auto-trade
export async function GET() {
  try {
    if (!db || !hasModel('tradingAccount')) {
      return NextResponse.json(DEFAULT_CONFIG);
    }
    await ensureDemoUser();
    const defaultAccount = await db.tradingAccount.findFirst({
      where: { isDefault: true },
    });
    if (!defaultAccount) return NextResponse.json(DEFAULT_CONFIG);

    let config = await db.botConfig.findFirst({
      where: { accountId: defaultAccount.id },
    });
    if (!config) {
      config = await db.botConfig.create({
        data: { userId: defaultAccount.userId, accountId: defaultAccount.id },
      });
    }
    const winRate = config.totalTrades > 0
      ? Math.round((config.winTrades / config.totalTrades) * 100)
      : 0;
    return NextResponse.json({ ...config, winRate, accountBalance: defaultAccount.balance });
  } catch (error) {
    // ANY error falls back to default config
    console.warn('[auto-trade GET] DB error, using fallback:', error);
    return NextResponse.json(DEFAULT_CONFIG);
  }
}

// PUT /api/trading/auto-trade
export async function PUT(request: Request) {
  let body: any;
  let enabled: any, allocationAmount: any, riskTolerance: any, maxPositions: any,
    maxPositionSize: any, stopLossPercent: any, takeProfitPercent: any,
    strategy: any, status: any;
  try {
    body = await request.json();
    ({ enabled, allocationAmount, riskTolerance, maxPositions, maxPositionSize,
      stopLossPercent, takeProfitPercent, strategy, status } = body);
  } catch (error) {
    console.error('PUT /api/trading/auto-trade JSON parse error:', error);
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Build the demo-mode fallback response (used when !db or DB unavailable)
  const buildDemoResponse = () => {
    let newStatus = status || 'stopped';
    if (enabled && !status) newStatus = 'running';
    if (enabled === false) newStatus = 'stopped';
    return NextResponse.json({
      ...DEFAULT_CONFIG,
      enabled: enabled ?? false,
      allocationAmount: allocationAmount ?? 0,
      riskTolerance: riskTolerance ?? 'medium',
      maxPositions: maxPositions ?? 5,
      stopLossPercent: stopLossPercent ?? 2.0,
      takeProfitPercent: takeProfitPercent ?? 4.0,
      strategy: strategy ?? 'balanced',
      status: newStatus,
    });
  };

  if (!db || !hasModel('tradingAccount')) {
    // Return updated config without persisting (demo mode)
    return buildDemoResponse();
  }

  try {
    await ensureDemoUser();
    const defaultAccount = await db.tradingAccount.findFirst({
      where: { isDefault: true },
    });
    if (!defaultAccount) {
      return NextResponse.json({ error: 'No default account found' }, { status: 404 });
    }

    let newStatus = status || 'stopped';
    if (enabled && !status) newStatus = 'running';
    if (enabled === false) newStatus = 'stopped';

    const config = await db.botConfig.upsert({
      where: { id: body.id || 'nonexistent' },
      create: {
        userId: defaultAccount.userId, accountId: defaultAccount.id,
        enabled: enabled ?? false, allocationAmount: allocationAmount ?? 0,
        riskTolerance: riskTolerance ?? 'medium', maxPositions: maxPositions ?? 5,
        maxPositionSize: maxPositionSize ?? 0, stopLossPercent: stopLossPercent ?? 2.0,
        takeProfitPercent: takeProfitPercent ?? 4.0, strategy: strategy ?? 'balanced',
        status: newStatus,
      },
      update: {
        ...(enabled !== undefined && { enabled }),
        ...(allocationAmount !== undefined && { allocationAmount }),
        ...(riskTolerance !== undefined && { riskTolerance }),
        ...(maxPositions !== undefined && { maxPositions }),
        ...(maxPositionSize !== undefined && { maxPositionSize }),
        ...(stopLossPercent !== undefined && { stopLossPercent }),
        ...(takeProfitPercent !== undefined && { takeProfitPercent }),
        ...(strategy !== undefined && { strategy }),
        status: newStatus,
      },
    });

    try {
      await db.userSettings.upsert({
        where: { userId: defaultAccount.userId },
        create: { userId: defaultAccount.userId, autoTradeEnabled: enabled ?? false, riskTolerance: riskTolerance ?? 'medium' },
        update: {
          ...(enabled !== undefined && { autoTradeEnabled: enabled }),
          ...(riskTolerance !== undefined && { riskTolerance }),
        },
      });
    } catch { /* non-critical */ }

    const winRate = config.totalTrades > 0
      ? Math.round((config.winTrades / config.totalTrades) * 100) : 0;
    return NextResponse.json({ ...config, winRate });
  } catch (error) {
    // ANY database error falls back to demo config
    console.warn('[auto-trade PUT] DB error, using fallback:', error);
    return buildDemoResponse();
  }
}
