// ============================================================
// GET /api/trading/auto-trade/activity
// Phase 1 CR1: P0-14 — Require X-User-Id.
// CR4.3B: Use centralized getUserId, not raw header.
// ============================================================

import { NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';
import { getUserIdSync, AuthRequiredError, authRequiredResponse } from '@/lib/get-user-id';
import { logSecurityEvent } from '@/lib/trading-policy';

export async function GET(req: Request) {
  // CR4.3B: Use centralized auth helper, not raw header
  let userId: string;
  try {
    userId = getUserIdSync(req);
  } catch {
    return authRequiredResponse();
  }

  if (!db || !hasModel('tradingAccount')) {
    return NextResponse.json(
      { error: 'Activity data is temporarily unavailable.', code: 'SERVICE_UNAVAILABLE', remediationPhase: 'containment' },
      { status: 503 },
    );
  }

  try {
    const defaultAccount = await db.tradingAccount.findFirst({
      where: { userId, isDefault: true },
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

    return NextResponse.json(activity);
  } catch (error) {
    logSecurityEvent({
      eventType: 'AUTOTRADE_ACTIVITY_ERROR',
      route: '/api/trading/auto-trade/activity',
      userId,
      reason: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'Failed to fetch auto-trade activity.' },
      { status: 500 },
    );
  }
}
