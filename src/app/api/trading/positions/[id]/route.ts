import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';
import { getUserId } from '@/lib/get-user-id';
import { createBrokerFromAccount } from '@/lib/broker/factory';
import { getGlobalAdminLevy } from '@/lib/system-config';

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

    const userId = await getUserId(req);

    // Verify position belongs to user's account
    const position = await db.position.findFirst({
      where: { id, status: 'open' },
      include: { account: true },
    });
    if (!position) {
      return NextResponse.json({ error: 'Position not found' }, { status: 404 });
    }
    if (position.account.userId !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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
    const userId = await getUserId(req);

    const position = await db.position.findFirst({
      where: { id, status: 'open' },
      include: { account: true },
    });
    if (!position) {
      return NextResponse.json({ error: 'Position not found' }, { status: 404 });
    }
    if (position.account.userId !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Close via broker
    const broker = createBrokerFromAccount(position.account);
    const result = await broker.closePosition(position.symbol);

    // Calculate realized PnL
    const closedPnl = position.side === 'long'
      ? (position.currentPrice - position.avgEntryPrice) * position.qty
      : (position.avgEntryPrice - position.currentPrice) * position.qty;

    // Admin levy deduction on profitable closes
    let userPnl = closedPnl;
    let levyAmount = 0;
    let levyPercent = 0;

    if (closedPnl > 0) {
      try {
        levyPercent = await getGlobalAdminLevy();
        levyAmount = closedPnl * (levyPercent / 100);
        userPnl = closedPnl - levyAmount;
      } catch (levyErr) {
        console.warn('[positions DELETE] admin levy calculation failed, skipping:', levyErr);
        levyPercent = 0;
        levyAmount = 0;
        userPnl = closedPnl;
      }
    }

    await db.position.update({
      where: { id },
      data: {
        status: 'closed',
        closedAt: new Date(),
        realizedPnl: userPnl,
      },
    });

    // Update account: sync time + admin levy collected
    const accountUpdateData: Record<string, unknown> = { lastSyncedAt: new Date() };
    if (levyAmount > 0) {
      accountUpdateData.totalAdminLevyCollected = { increment: levyAmount };
    }
    await db.tradingAccount.update({
      where: { id: position.accountId },
      data: accountUpdateData,
    });

    // Update BotConfig admin levy collected if it exists
    if (levyAmount > 0 && hasModel('botConfig')) {
      try {
        await db.botConfig.updateMany({
          where: { accountId: position.accountId },
          data: { adminLevyCollected: { increment: levyAmount } },
        });
      } catch (botErr) {
        console.warn('[positions DELETE] botConfig levy update failed (non-critical):', botErr);
      }
    }

    return NextResponse.json({
      success: true,
      orderId: result.orderId,
      realizedPnl: userPnl,
      adminLevy: levyAmount,
      adminLevyPercent: levyPercent,
      rawPnl: closedPnl,
      status: result.status,
    });
  } catch (error) {
    console.warn('[positions DELETE] error:', error);
    return NextResponse.json({ error: 'Failed to close position' }, { status: 500 });
  }
}
