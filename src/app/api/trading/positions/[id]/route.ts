// ============================================================
// PATCH/DELETE /api/trading/positions/[id]
// Phase 1 CR2: Strict auth, hard-block live position modifications.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';
import { getUserId, AuthRequiredError, authRequiredResponse } from '@/lib/get-user-id';
import { createBrokerFromAccount, BrokerFactoryError } from '@/lib/broker/factory';
import { getGlobalAdminLevy } from '@/lib/system-config';
import { saveDemoPositionSLTP } from '@/lib/demo-sltp-store';
import { enforceLiveTradingPolicy, isExplicitlyDemo, CONTAINMENT_CODES, logSecurityEvent } from '@/lib/trading-policy';
import { v4 as uuidv4 } from 'uuid';

// PATCH — update TP/SL or other position fields
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!db || !hasModel('position')) {
    return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });
  }
  try {
    const userId = await getUserId(req);
    const { id } = await params;
    const body = await req.json();

    // CR4.1: Tenant-scoped query — userId in predicate via account relation
    const position = await db.position.findFirst({
      where: { id, status: 'open', account: { userId } },
      include: { account: true },
    });
    if (!position) {
      return NextResponse.json({ error: 'Position not found' }, { status: 404 });
    }

    // Reject live position-protection modification
    if (!isExplicitlyDemo(position.account)) {
      const correlationId = uuidv4();
      logSecurityEvent({
        eventType: 'POSITION_PROTECTION_BLOCKED',
        correlationId,
        route: '/api/trading/positions/[id]',
        userId,
        identifier: id,
        reason: 'Live position-protection modification is deferred pending audit. Use broker directly.',
      });
      return NextResponse.json(
        {
          error: 'Live position-protection modification is temporarily disabled pending platform audit.',
          code: CONTAINMENT_CODES.LIVE_BLOCKED,
          correlationId,
          remediationPhase: 'containment',
        },
        { status: 403 },
      );
    }

    const updateData: Record<string, unknown> = {};
    if (body.stopLoss !== undefined) updateData.stopLoss = body.stopLoss;
    if (body.takeProfit !== undefined) updateData.takeProfit = body.takeProfit;
    if (body.trailingStop !== undefined) updateData.trailingStop = body.trailingStop;
    if (body.trailingStopPct !== undefined) updateData.trailingStopPct = body.trailingStopPct;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const updated = await db.position.update({ where: { id }, data: updateData });

    if (body.stopLoss !== undefined || body.takeProfit !== undefined) {
      saveDemoPositionSLTP(
        position.symbol,
        body.stopLoss ?? updated.stopLoss,
        body.takeProfit ?? updated.takeProfit,
      );
    }

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      return authRequiredResponse();
    }
    logSecurityEvent({
      eventType: 'POSITION_PATCH_ERROR',
      route: '/api/trading/positions/[id]',
      reason: error instanceof Error ? error.message : 'Unknown error',
    });
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
    const userId = await getUserId(req);
    const { id } = await params;

    // CR4.1: Tenant-scoped query — userId in predicate via account relation
    const position = await db.position.findFirst({
      where: { id, status: 'open', account: { userId } },
      include: { account: true },
    });
    if (!position) {
      return NextResponse.json({ error: 'Position not found' }, { status: 404 });
    }

    // ── CONTAINMENT: Enforce live-trading policy BEFORE closePosition ──
    const policy = enforceLiveTradingPolicy(position.account, `position close (${position.symbol})`);
    if (policy.blocked) return policy.response;

    const broker = await createBrokerFromAccount(position.account);
    const result = await broker.closePosition(position.symbol);

    const closedPnl = position.side === 'long'
      ? (position.currentPrice - position.avgEntryPrice) * position.qty
      : (position.avgEntryPrice - position.currentPrice) * position.qty;

    let userPnl = closedPnl;
    let levyAmount = 0;
    let levyPercent = 0;

    if (closedPnl > 0) {
      try {
        levyPercent = await getGlobalAdminLevy();
        levyAmount = closedPnl * (levyPercent / 100);
        userPnl = closedPnl - levyAmount;
      } catch {
        levyPercent = 0;
        levyAmount = 0;
        userPnl = closedPnl;
      }
    }

    await db.position.update({
      where: { id },
      data: { status: 'closed', closedAt: new Date(), realizedPnl: userPnl },
    });

    const accountUpdateData: Record<string, unknown> = { lastSyncedAt: new Date() };
    if (levyAmount > 0) {
      accountUpdateData.totalAdminLevyCollected = { increment: levyAmount };
    }
    await db.tradingAccount.update({ where: { id: position.accountId }, data: accountUpdateData });

    return NextResponse.json({
      success: true, orderId: result.orderId,
      realizedPnl: userPnl, adminLevy: levyAmount, adminLevyPercent: levyPercent,
      rawPnl: closedPnl, status: result.status,
    });
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      return authRequiredResponse();
    }
    logSecurityEvent({
      eventType: 'POSITION_DELETE_ERROR',
      route: '/api/trading/positions/[id]',
      reason: error instanceof Error ? error.message : 'Unknown error',
    });

    if (error instanceof BrokerFactoryError) {
      return NextResponse.json(
        { error: error.message, code: error.code, remediationPhase: 'containment' },
        { status: error.code === 'BROKER_CONNECTION_FAILED' ? 503 : 400 },
      );
    }
    return NextResponse.json({ error: 'Failed to close position' }, { status: 500 });
  }
}
