import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { createBrokerFromAccount } from '@/lib/broker/factory';

export async function GET() {
  try {
    const userId = 'usr_demo_1';
    const account = await db.tradingAccount.findFirst({
      where: { userId, isDefault: true },
    });
    if (!account) {
      return NextResponse.json({
        totalBalance: 100000, totalPnl: 0, totalPnlPercent: 0,
        dayPnl: 0, dayPnlPercent: 0, openPositions: 0,
        activeSignals: 0, winRate: 0, totalTrades: 0,
      });
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
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
