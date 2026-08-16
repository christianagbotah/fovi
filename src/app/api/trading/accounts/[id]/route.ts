import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';
import { getUserId } from '@/lib/get-user-id';
import { z } from 'zod/v4';

const patchSchema = z.object({
  label: z.string().max(100).optional(),
  isActive: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

/**
 * PATCH /api/trading/accounts/:id
 * Update account label or active status.
 * Deposits/withdrawals are NOT supported — users fund via their broker directly.
 */
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
      return NextResponse.json({ success: true }, { headers: { 'x-demo': 'true' } });
    }

    const userId = await getUserId(req);
    const account = await db.tradingAccount.findFirst({ where: { id, userId } });
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    const { count } = await db.tradingAccount.updateMany({
      where: { id, userId },
      data: { ...parsed.data, updatedAt: new Date() },
    });
    if (count === 0) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.warn('[accounts/[id] PATCH] error:', error);
    return NextResponse.json({ error: 'Failed to update account' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!db || !hasModel('tradingAccount')) {
    return NextResponse.json({ success: true }, { headers: { 'x-demo': 'true' } });
  }
  try {
    const { id } = await params;
    const userId = await getUserId(req);
    await db.tradingAccount.deleteMany({ where: { id, userId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.warn('[accounts/[id] DELETE] error:', error);
    return NextResponse.json({ success: true }, { headers: { 'x-demo': 'true' } });
  }
}
