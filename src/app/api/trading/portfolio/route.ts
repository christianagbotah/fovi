// ============================================================
// GET /api/trading/portfolio — Portfolio summary
// Phase 1 CR1: Remove fake $100k balance. No demo fallback.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';
import { getUserIdSync } from '@/lib/get-user-id';
import { createBrokerFromAccount, BrokerFactoryError } from '@/lib/broker/factory';
import { logSecurityEvent, CONTAINMENT_CODES } from '@/lib/trading-policy';
import { v4 as uuidv4 } from 'uuid';

export async function GET(req: NextRequest) {
  // No DB → return 503, NOT a fake balance
  if (!db || !hasModel('tradingAccount')) {
    const correlationId = uuidv4();
    logSecurityEvent({
      eventType: 'PORTFOLIO_DB_UNAVAILABLE',
      correlationId,
      route: '/api/trading/portfolio',
      reason: 'Database unavailable for portfolio query',
    });
    return NextResponse.json(
      {
        error: 'Portfolio data is temporarily unavailable.',
        code: CONTAINMENT_CODES.BROKER_CONNECTION_FAILED,
        correlationId,
        remediationPhase: 'containment',
      },
      { status: 503 },
    );
  }

  try {
    const { searchParams } = new URL(req.url);
    const accountId = searchParams.get('accountId');
    const userId = getUserIdSync(req);

    const account = await db.tradingAccount.findFirst({
      where: { userId, ...(accountId ? { id: accountId } : { isDefault: true }) },
    });

    // No account found but DB is working — return empty portfolio
    if (!account) {
      return NextResponse.json(
        {
          totalBalance: 0, totalPnl: 0, totalPnlPercent: 0,
          dayPnl: 0, dayPnlPercent: 0, openPositions: 0,
          activeSignals: 0, winRate: 0, totalTrades: 0,
        },
        { headers: { 'x-demo': 'false', 'x-storage': 'db' } },
      );
    }

    const broker = await createBrokerFromAccount(account);
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

    return NextResponse.json(
      {
        totalBalance,
        totalPnl: totalBalance - account.balance,
        totalPnlPercent,
        dayPnl,
        dayPnlPercent,
        openPositions: positions.length,
        activeSignals,
        winRate,
        totalTrades,
      },
      { headers: { 'x-demo': 'false', 'x-storage': 'db' } },
    );
  } catch (error) {
    // Catch block returns 500, NOT a fake balance
    const correlationId = uuidv4();
    logSecurityEvent({
      eventType: 'PORTFOLIO_ERROR',
      correlationId,
      route: '/api/trading/portfolio',
      reason: error instanceof Error ? error.message : 'Unknown error',
    });

    if (error instanceof BrokerFactoryError) {
      return NextResponse.json(
        { error: error.message, code: error.code, correlationId, remediationPhase: 'containment' },
        { status: error.code === CONTAINMENT_CODES.BROKER_CONNECTION_FAILED ? 503 : 400 },
      );
    }

    return NextResponse.json(
      {
        error: 'Failed to fetch portfolio data.',
        code: 'PORTFOLIO_ERROR',
        correlationId,
        remediationPhase: 'containment',
      },
      { status: 500 },
    );
  }
}
