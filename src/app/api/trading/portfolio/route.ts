import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';
import { getUserIdSync } from '@/lib/get-user-id';
import { createBrokerFromAccount } from '@/lib/broker/factory';

export async function GET(req: NextRequest) {
  try {
    if (!db || !hasModel('tradingAccount')) {
      return NextResponse.json({
        totalBalance: 100000, totalPnl: 0, totalPnlPercent: 0,
        dayPnl: 0, dayPnlPercent: 0, openPositions: 0,
        activeSignals: 0, winRate: 0, totalTrades: 0,
      });
    }
    const { searchParams } = new URL(req.url);
    const accountId = searchParams.get('accountId');
    const userId = getUserIdSync(req);
    const account = await db.tradingAccount.findFirst({
      where: { userId, ...(accountId ? { id: accountId } : { isDefault: true }) },
    });
    if (!account) {
      return NextResponse.json({
        totalBalance: 0, totalPnl: 0, totalPnlPercent: 0,
        dayPnl: 0, dayPnlPercent: 0, openPositions: 0,
        activeSignals: 0, winRate: 0, totalTrades: 0,
      });
    }

    const broker = createBrokerFromAccount(account);
    const info = await broker.getAccountInfo();
    const positions = await broker.getPositions();

    const unrealizedPnl = positions.reduce((sum, p) => sum + (p.unrealizedPnl || 0), 0);
    const totalBalance = info.balance + unrealizedPnl;
    const totalPnlPercent = account.balance > 0 ? ((totalBalance - account.balance) / account.balance) * 100 : 0;

    const closedPositions = hasModel('position')
      ? await db.position.findMany({ where: { accountId: account.id, status: 'closed' } })
      : [];
    const winCount = closedPositions.filter(p => (p.realizedPnl || 0) > 0).length;
    const winRate = closedPositions.length > 0 ? Math.round((winCount / closedPositions.length) * 100) : 0;

    const totalTrades = closedPositions.length;

    let activeSignals = 0;
    if (hasModel('tradingSignal')) {
      activeSignals = await db.tradingSignal.count({
        where: { accountId: account.id, status: 'active' },
      });
    }

    const dayPnl = info.dayPnl || 0;
    const dayPnlPercent = info.balance > 0 ? (dayPnl / info.balance) * 100 : 0;

    return NextResponse.json({
      totalBalance,
      totalPnl: totalBalance - account.balance,
      totalPnlPercent,
      dayPnl,
      dayPnlPercent,
      openPositions: positions.length,
      activeSignals,
      winRate,
      totalTrades,
    });
  } catch (error) {
    console.warn('[portfolio GET] error:', error);
    return NextResponse.json({
      totalBalance: 100000, totalPnl: 0, totalPnlPercent: 0,
      dayPnl: 0, dayPnlPercent: 0, openPositions: 0,
      activeSignals: 0, winRate: 0, totalTrades: 0,
    });
  }
}
