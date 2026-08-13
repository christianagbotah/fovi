import { NextResponse } from 'next/server';
import { db, hasModel, ensureDemoUser, DEMO_USER_ID } from '@/lib/db';

// ============================================================
// GET /api/trading/engine/bots
// ============================================================
// Returns all active (running + enabled) bots with their account info.
// Called by the auto-trade-engine mini-service (port 3012) internally.
// No auth required — engine is a trusted internal service.
// ============================================================

export async function GET() {
  if (!db || !hasModel('bot')) {
    // Return demo bots that the engine can process
    return NextResponse.json([
      {
        id: 'bot_demo_1',
        userId: 'usr_demo_1',
        accountId: 'acc_demo_1',
        name: 'Momentum Hunter',
        strategy: 'balanced',
        symbols: 'BTC,ETH,SOL,NVDA,AAPL,TSLA,GOOGL,MSFT,META,AMD',
        timeframe: '1h',
        allocationAmount: 25000,
        enabled: true,
        status: 'running',
        riskPerTrade: 2.0,
        maxPositions: 5,
        stopLossPercent: 2.0,
        takeProfitPercent: 4.0,
        totalTrades: 0,
        winTrades: 0,
        totalPnl: 0,
        account: {
          id: 'acc_demo_1',
          broker: 'demo',
          accountType: 'demo',
          balance: 100000,
          isActive: true,
        },
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
        riskPerTrade: 1.5,
        maxPositions: 8,
        stopLossPercent: 3.0,
        takeProfitPercent: 2.0,
        totalTrades: 0,
        winTrades: 0,
        totalPnl: 0,
        account: {
          id: 'acc_demo_1',
          broker: 'demo',
          accountType: 'demo',
          balance: 100000,
          isActive: true,
        },
      },
    ]);
  }

  try {
    await ensureDemoUser();

    // Fetch all running+enabled bots with their account info
    const bots = await db.bot.findMany({
      where: {
        enabled: true,
        status: 'running',
      },
      include: {
        account: {
          select: {
            id: true,
            broker: true,
            accountType: true,
            balance: true,
            isActive: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Filter to only bots with active accounts
    const active = bots.filter((b) => b.account?.isActive !== false);

    return NextResponse.json(active);
  } catch (error) {
    console.warn('[engine/bots GET] DB error:', error);
    return NextResponse.json([]);
  }
}
