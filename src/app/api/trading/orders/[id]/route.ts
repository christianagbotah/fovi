import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';
import { getUserId } from '@/lib/get-user-id';
import { createBrokerFromAccount } from '@/lib/broker/factory';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!db || !hasModel('order')) {
    return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });
  }

  try {
    const { id } = await params;
    const userId = await getUserId(req);

    // Find the order by ID, include account to verify ownership and create broker
    const order = await db.order.findFirst({
      where: { id },
      include: { account: true },
    });

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    if (order.account.userId !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Only allow cancelling pending or partially_filled orders
    if (!['pending', 'partially_filled'].includes(order.status)) {
      return NextResponse.json(
        { error: `Cannot cancel order with status: ${order.status}` },
        { status: 400 }
      );
    }

    // Create broker and cancel the order
    const broker = await createBrokerFromAccount(order.account);
    await broker.cancelOrder(order.symbol, order.brokerOrderId || order.id);

    // Update order status in DB
    await db.order.update({
      where: { id },
      data: { status: 'cancelled' },
    });

    return NextResponse.json({ success: true, orderId: id, status: 'cancelled' });
  } catch (error) {
    console.warn('[orders DELETE] error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to cancel order' },
      { status: 500 }
    );
  }
}
