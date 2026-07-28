import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';
import { createBrokerFromAccount } from '@/lib/broker/factory';

// PATCH — update TP/SL or other position fields
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!db || !hasModel('position')) {
    return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });
  }
  try {
    const { id } = await params;
    const body = await req.json();

    // Verify position belongs to user's account
    const position = await db.position.findFirst({
      where: { id, status: 'open' },
      include: { account: true },
    });
    if (!position) {
      return NextResponse.json({ error: 'Position not found' }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {};
    if (body.stopLoss !== undefined) updateData.stopLoss = body.stopLoss;
    if (body.takeProfit !== undefined) updateData.takeProfit = body.takeProfit;
    if (body.trailingStop !== undefined) updateData.trailingStop = body.trailingStop;
    if (body.trailingStopPct !== undefined) updateData.trailingStopPct = body.trailingStopPct;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const updated = await db.position.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.warn('[positions PATCH] error:', error);
    return NextResponse.json({ error: 'Failed to update position' }, { status: 500 });
  }
}

// DELETE — close a position
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!db || !hasModel('position')) {
    return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });
  }
  try {
    const { id } = await params;

    const position = await db.position.findFirst({
      where: { id, status: 'open' },
      include: { account: true },
    });
    if (!position) {
      return NextResponse.json({ error: 'Position not found' }, { status: 404 });
    }

    // Close via broker
    const broker = createBrokerFromAccount(position.account);
    const result = await broker.closePosition(position.symbol);

    // Calculate realized PnL
    const closedPnl = position.side === 'long'
      ? (position.currentPrice - position.avgEntryPrice) * position.qty
      : (position.avgEntryPrice - position.currentPrice) * position.qty;

    await db.position.update({
      where: { id },
      data: {
        status: 'closed',
        closedAt: new Date(),
        realizedPnl: closedPnl,
      },
    });

    // Update account sync time
    await db.tradingAccount.update({
      where: { id: position.accountId },
      data: { lastSyncedAt: new Date() },
    });

    return NextResponse.json({
      success: true,
      orderId: result.orderId,
      realizedPnl: closedPnl,
      status: result.status,
    });
  } catch (error) {
    console.warn('[positions DELETE] error:', error);
    return NextResponse.json({ error: 'Failed to close position' }, { status: 500 });
  }
}
