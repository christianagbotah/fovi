import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/trading/auto-trade — fetch bot config for the default account
export async function GET() {
  try {
    const defaultAccount = await db.tradingAccount.findFirst({
      where: { isDefault: true },
    });

    if (!defaultAccount) {
      // Return empty config if no account exists
      return NextResponse.json({
        id: null,
        enabled: false,
        allocationAmount: 0,
        riskTolerance: 'medium',
        maxPositions: 5,
        maxPositionSize: 0,
        stopLossPercent: 2.0,
        takeProfitPercent: 4.0,
        strategy: 'balanced',
        status: 'stopped',
        totalTrades: 0,
        winTrades: 0,
        totalPnl: 0,
        winRate: 0,
        lastTradeAt: null,
        lastError: null,
        accountBalance: 0,
      });
    }

    let config = await db.botConfig.findFirst({
      where: { accountId: defaultAccount.id },
    });

    // Auto-create config if it doesn't exist
    if (!config) {
      config = await db.botConfig.create({
        data: { userId: defaultAccount.userId, accountId: defaultAccount.id },
      });
    }

    const winRate = config.totalTrades > 0
      ? Math.round((config.winTrades / config.totalTrades) * 100)
      : 0;

    return NextResponse.json({
      ...config,
      winRate,
      accountBalance: defaultAccount.balance,
    });
  } catch (error) {
    console.error('GET /api/trading/auto-trade error:', error);
    return NextResponse.json({
      id: null, enabled: false, allocationAmount: 0, riskTolerance: 'medium',
      maxPositions: 5, maxPositionSize: 0, stopLossPercent: 2.0, takeProfitPercent: 4.0,
      strategy: 'balanced', status: 'stopped', totalTrades: 0, winTrades: 0,
      totalPnl: 0, winRate: 0, lastTradeAt: null, lastError: null, accountBalance: 0,
    });
  }
}

// PUT /api/trading/auto-trade — update bot config
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { enabled, allocationAmount, riskTolerance, maxPositions, maxPositionSize,
      stopLossPercent, takeProfitPercent, strategy, status } = body;

    const defaultAccount = await db.tradingAccount.findFirst({
      where: { isDefault: true },
    });

    if (!defaultAccount) {
      return NextResponse.json({ error: 'No default account found' }, { status: 404 });
    }

    // Determine new status
    let newStatus = status || 'stopped';
    if (enabled && !status) newStatus = 'running';
    if (enabled === false) newStatus = 'stopped';

    const config = await db.botConfig.upsert({
      where: { id: body.id || 'nonexistent' },
      create: {
        userId: defaultAccount.userId,
        accountId: defaultAccount.id,
        enabled: enabled ?? false,
        allocationAmount: allocationAmount ?? 0,
        riskTolerance: riskTolerance ?? 'medium',
        maxPositions: maxPositions ?? 5,
        maxPositionSize: maxPositionSize ?? 0,
        stopLossPercent: stopLossPercent ?? 2.0,
        takeProfitPercent: takeProfitPercent ?? 4.0,
        strategy: strategy ?? 'balanced',
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

    // Also update UserSettings autoTradeEnabled
    try {
      await db.userSettings.upsert({
        where: { userId: defaultAccount.userId },
        create: {
          userId: defaultAccount.userId,
          autoTradeEnabled: enabled ?? false,
          riskTolerance: riskTolerance ?? 'medium',
        },
        update: {
          ...(enabled !== undefined && { autoTradeEnabled: enabled }),
          ...(riskTolerance !== undefined && { riskTolerance }),
        },
      });
    } catch { /* non-critical */ }

    const winRate = config.totalTrades > 0
      ? Math.round((config.winTrades / config.totalTrades) * 100)
      : 0;

    return NextResponse.json({ ...config, winRate });
  } catch (error) {
    console.error('PUT /api/trading/auto-trade error:', error);
    return NextResponse.json({ error: 'Failed to update config' }, { status: 500 });
  }
}
