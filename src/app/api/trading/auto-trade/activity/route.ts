// ============================================================
// GET /api/trading/auto-trade/activity
// Phase 1 CR1: P0-14 — Remove DEMO_USER_ID fallback.
// Require X-User-Id. Return empty array, NOT fabricated demo activity.
// ============================================================

import { NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';
import { logSecurityEvent } from '@/lib/trading-policy';

export async function GET(req: Request) {
  // ── P0-14: Require authenticated user via X-User-Id ──
  const userId = req.headers.get('x-user-id');
  if (!userId) {
    return NextResponse.json(
      { error: 'Authentication required.', code: 'AUTH_REQUIRED', remediationPhase: 'containment' },
      { status: 401 },
    );
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
      // No account — return empty array, NOT fabricated demo activity
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

    // P0-14: Return real activity even if empty, NOT fabricated demo activity
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
