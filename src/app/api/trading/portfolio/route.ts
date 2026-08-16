// ============================================================
// GET /api/trading/portfolio — Portfolio summary
// Phase 1 CR2: Strict auth, demo provenance for demo accounts.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';
import { getUserIdSync, AuthRequiredError, authRequiredResponse } from '@/lib/get-user-id';
import { createBrokerFromAccount, BrokerFactoryError } from '@/lib/broker/factory';
import { logSecurityEvent, CONTAINMENT_CODES, isExplicitlyDemo, enforceLiveTradingPolicy, DEMO_PROVENANCE_HEADER } from '@/lib/trading-policy';
import { v4 as uuidv4 } from 'uuid';

export async function GET(req: NextRequest) {
  let userId: string;
  try {
    userId = getUserIdSync(req);
  } catch {
    return authRequiredResponse();
  }

  if (!db || !hasModel('tradingAccount')) {
    const correlationId = uuidv4();
    logSecurityEvent({
      eventType: 'PORTFOLIO_DB_UNAVAILABLE',
      correlationId,
      route: '/api/trading/portfolio',
      userId,
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

    const account = await db.tradingAccount.findFirst({
      where: { userId, ...(accountId ? { id: accountId } : { isDefault: true }) },
    });

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

    const isDemo = isExplicitlyDemo(account);

    // Phase 1 containment: enforce live trading policy before broker construction
    const policyCheck = enforceLiveTradingPolicy(account, 'getPortfolio');
    if (policyCheck.blocked) return policyCheck.response;

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

    const responseHeaders: Record<string, string> = { 'x-storage': 'db' };
    if (isDemo) {
      Object.assign(responseHeaders, DEMO_PROVENANCE_HEADER);
    }

    return NextResponse.json(
      {
        totalBalance, totalPnl: totalBalance - account.balance,
        totalPnlPercent, dayPnl, dayPnlPercent,
        openPositions: positions.length, activeSignals,
        winRate, totalTrades,
      },
      { headers: responseHeaders },
    );
  } catch (error) {
    const correlationId = uuidv4();
    logSecurityEvent({
      eventType: 'PORTFOLIO_ERROR', correlationId,
      route: '/api/trading/portfolio', userId,
      reason: error instanceof Error ? error.message : 'Unknown error',
    });

    if (error instanceof BrokerFactoryError) {
      return NextResponse.json(
        { error: error.message, code: error.code, correlationId, remediationPhase: 'containment' },
        { status: error.code === CONTAINMENT_CODES.BROKER_CONNECTION_FAILED ? 503 : 400 },
      );
    }

    return NextResponse.json(
      { error: 'Failed to fetch portfolio data.', code: 'PORTFOLIO_ERROR', correlationId, remediationPhase: 'containment' },
      { status: 500 },
    );
  }
}
