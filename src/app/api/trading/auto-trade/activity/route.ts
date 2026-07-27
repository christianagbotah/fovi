import { NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';

// GET /api/trading/auto-trade/activity — recent bot activity (orders where aiGenerated=true)
const DEMO_ACTIVITY = [
  { id: 'demo_1', symbol: 'AAPL', side: 'buy', type: 'market', qty: 25, filledPrice: 198.45, filledQty: 25, status: 'filled', signalDirection: 'bullish', signalConfidence: 82, signalType: 'macd_crossover', createdAt: new Date(Date.now() - 1000 * 60 * 5).toISOString() },
  { id: 'demo_2', symbol: 'BTC', side: 'sell', type: 'limit', qty: 0.1, filledPrice: 68450, filledQty: 0.1, status: 'filled', signalDirection: 'bearish', signalConfidence: 75, signalType: 'rsi_divergence', createdAt: new Date(Date.now() - 1000 * 60 * 12).toISOString() },
  { id: 'demo_3', symbol: 'NVDA', side: 'buy', type: 'market', qty: 15, filledPrice: 138.92, filledQty: 15, status: 'filled', signalDirection: 'bullish', signalConfidence: 88, signalType: 'breakout', createdAt: new Date(Date.now() - 1000 * 60 * 28).toISOString() },
  { id: 'demo_4', symbol: 'ETH', side: 'buy', type: 'limit', qty: 1.5, filledPrice: 3895.20, filledQty: 0, status: 'pending', signalDirection: 'bullish', signalConfidence: 71, signalType: 'bollinger_squeeze', createdAt: new Date(Date.now() - 1000 * 60 * 45).toISOString() },
  { id: 'demo_5', symbol: 'TSLA', side: 'sell', type: 'stop', qty: 20, filledPrice: null, filledQty: 0, status: 'cancelled', signalDirection: 'bearish', signalConfidence: 64, signalType: 'trend_reversal', createdAt: new Date(Date.now() - 1000 * 60 * 60).toISOString() },
];

export async function GET() {
  if (!db || !hasModel('tradingAccount')) {
    return NextResponse.json(DEMO_ACTIVITY);
  }
  try {
    const defaultAccount = await db.tradingAccount.findFirst({
      where: { isDefault: true },
    });

    if (!defaultAccount) {
      return NextResponse.json([]);
    }

    const recentOrders = await db.order.findMany({
      where: { accountId: defaultAccount.id, aiGenerated: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        signal: { select: { direction: true, confidence: true, signalType: true } },
      },
    });

    const activity = recentOrders.map(order => ({
      id: order.id,
      symbol: order.symbol,
      side: order.side,
      type: order.type,
      qty: order.qty,
      filledPrice: order.filledPrice,
      filledQty: order.filledQty,
      status: order.status,
      signalDirection: order.signal?.direction,
      signalConfidence: order.signal?.confidence,
      signalType: order.signal?.signalType,
      createdAt: order.createdAt,
    }));

    // If no real AI orders yet, return simulated activity for demo
    if (activity.length === 0) {
      return NextResponse.json(DEMO_ACTIVITY);
    }

    return NextResponse.json(activity);
  } catch (error) {
    if (error instanceof Error && error.message.includes('validating datasource')) {
      // Prisma validation error (e.g., wrong DB URL) — return demo activity like the !db path
      return NextResponse.json(DEMO_ACTIVITY);
    }
    console.error('GET /api/trading/auto-trade/activity error:', error);
    return NextResponse.json([]);
  }
}
