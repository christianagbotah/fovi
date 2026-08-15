// ============================================================
// PATCH/DELETE /api/trading/accounts/[id]
// Phase 1 CR1:
//   P0-10: DELETE catch returns 500, PATCH catch returns 500
//   P0-11: Return safeAccountDTO for PATCH response
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';
import { getUserId } from '@/lib/get-user-id';
import { z } from 'zod/v4';
import { safeAccountDTO, logSecurityEvent } from '@/lib/trading-policy';

const patchSchema = z.object({
  label: z.string().max(100).optional(),
  isActive: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const raw = await req.json();
    const parsed = patchSchema.safeParse(raw);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.issues },
        { status: 400 },
      );
    }

    if (!db || !hasModel('tradingAccount')) {
      return NextResponse.json(
        { error: 'Database unavailable.' },
        { status: 503 },
      );
    }

    const userId = await getUserId(req);
    const account = await db.tradingAccount.findFirst({ where: { id, userId } });
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    const updated = await db.tradingAccount.update({
      where: { id },
      data: { ...parsed.data, updatedAt: new Date() },
    });

    // P0-11: Return safeAccountDTO
    return NextResponse.json({ success: true, account: safeAccountDTO(updated as unknown as Record<string, unknown>) });
  } catch (error) {
    logSecurityEvent({
      eventType: 'ACCOUNT_PATCH_ERROR',
      route: '/api/trading/accounts/[id]',
      reason: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json({ error: 'Failed to update account' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!db || !hasModel('tradingAccount')) {
    return NextResponse.json(
      { error: 'Database unavailable.' },
      { status: 503 },
    );
  }
  try {
    const { id } = await params;
    const userId = await getUserId(req);
    await db.tradingAccount.deleteMany({ where: { id, userId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    // P0-10: Catch returns 500, NOT success
    logSecurityEvent({
      eventType: 'ACCOUNT_DELETE_ERROR',
      route: '/api/trading/accounts/[id]',
      reason: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json({ error: 'Failed to delete account.' }, { status: 500 });
  }
}
