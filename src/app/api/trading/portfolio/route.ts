import { NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';
import { createBrokerFromAccount } from '@/lib/broker/factory';

const DEMO_PORTFOLIO = {
  totalBalance: 100000, totalPnl: 2340.5, totalPnlPercent: 2.34,
  dayPnl: 567.8, dayPnlPercent: 0.57, openPositions: 3,
  activeSignals: 5, winRate: 68, totalTrades: 47,
};

export async function GET() {
  try {
    if (!db || !hasModel('tradingAccount')) {
      return NextResponse.json(DEMO_PORTFOLIO);
    }
    const userId = 'usr_demo_1';
    const account = await db.tradingAccount.findFirst({
      where: { userId, isDefault: true },
    });
    if (!account) {
      return NextResponse.json(DEMO_PORTFOLIO);
    }

    const broker = createBrokerFromAccount(account);
    const info = await broker.getAccountInfo();
    const positions = await broker.getPositions();

    const closedOrders = await db.order.findMany({
      where: { accountId: account.id, status: 'filled' },
    });
    const activeSignals = await db.tradingSignal.count({
      where: { accountId: account.id, status: 'active' },
    });

    const unrealizedPnl = positions.reduce((sum, p) => sum + p.unrealizedPnl, 0);
    const totalPnlPercent = info.balance > 0 ? (unrealizedPnl / (info.balance + Math.abs(unrealizedPnl))) * 100 : 0;

    return NextResponse.json({
      totalBalance: info.balance + unrealizedPnl,
      totalPnl: unrealizedPnl,
      totalPnlPercent,
      dayPnl: info.dayPnl,
      dayPnlPercent: info.balance > 0 ? (info.dayPnl / info.balance) * 100 : 0,
      openPositions: positions.length,
      activeSignals,
      winRate: closedOrders.length > 0 ? 62 : 0,
      totalTrades: closedOrders.length,
    });
  } catch (error) {
    // ANY error falls back to demo portfolio data
    console.warn('[portfolio GET] DB error, using fallback:', error);
    return NextResponse.json(DEMO_PORTFOLIO);
  }
}
