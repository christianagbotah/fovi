// ============================================================
// DELETE /api/trading/orders/[id] — Cancel an order
// Phase 1 CR2: Strict auth, hard-block live cancel.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';
import { getUserId, AuthRequiredError, authRequiredResponse } from '@/lib/get-user-id';
import { createBrokerFromAccount } from '@/lib/broker/factory';
import { enforceLiveTradingPolicy, logSecurityEvent } from '@/lib/trading-policy';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!db || !hasModel('order')) {
    return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });
  }

  try {
    const userId = await getUserId(req);
    const { id } = await params;

    const order = await db.order.findFirst({
      where: { id, account: { userId } },
      include: { account: true },
    });

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    if (!['pending', 'partially_filled'].includes(order.status)) {
      return NextResponse.json(
        { error: `Cannot cancel order with status: ${order.status}` },
        { status: 400 },
      );
    }

    // ── CONTAINMENT: Enforce live-trading policy before cancel ──
    const policy = enforceLiveTradingPolicy(order.account, `order cancel (${order.symbol} ${order.id})`);
    if (policy.blocked) return policy.response;

    const broker = await createBrokerFromAccount(order.account);
    await broker.cancelOrder(order.symbol, order.brokerOrderId || order.id);

    await db.order.update({ where: { id }, data: { status: 'cancelled' } });

    return NextResponse.json({ success: true, orderId: id, status: 'cancelled' });
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      return authRequiredResponse();
    }
    logSecurityEvent({
      eventType: 'ORDER_CANCEL_ERROR',
      route: '/api/trading/orders/[id]',
      reason: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to cancel order' },
      { status: 500 },
    );
  }
}
