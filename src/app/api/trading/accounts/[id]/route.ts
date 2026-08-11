import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';
import { getUserId } from '@/lib/get-user-id';
import { z } from 'zod/v4';

const patchSchema = z.object({
  balance: z.number().min(0).optional(),
  action: z.enum(['deposit', 'withdraw']).optional(),
  amount: z.number().positive().max(1_000_000).optional(),
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

    const { balance, action, amount } = parsed.data;

    if (!db || !hasModel('tradingAccount')) {
      return NextResponse.json({ success: true, balance: balance ?? 0 });
    }

    const userId = await getUserId(req);

    const account = await db.tradingAccount.findFirst({ where: { id, userId } });
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    let newBalance = typeof balance === 'number' ? balance : account.balance;

    // Only demo accounts can use direct deposit/withdrawal
    // Real accounts must go through the broker
    if (action && amount) {
      if (account.accountType !== 'demo' && account.broker !== 'demo') {
        return NextResponse.json(
          { error: 'Deposits and withdrawals for real accounts must be made through your broker.' },
          { status: 400 },
        );
      }

      if (action === 'deposit') {
        newBalance = account.balance + amount;
      } else if (action === 'withdraw') {
        if (amount > account.balance) {
          return NextResponse.json({ error: 'Insufficient balance' }, { status: 400 });
        }
        newBalance = account.balance - amount;
      }
    }

    const updated = await db.tradingAccount.update({
      where: { id },
      data: { balance: newBalance, updatedAt: new Date() },
    });

    return NextResponse.json({ success: true, balance: updated.balance, previousBalance: account.balance });
  } catch (error) {
    console.warn('[accounts/[id] PATCH] error:', error);
    return NextResponse.json({ error: 'Failed to update account' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!db || !hasModel('tradingAccount')) {
    return NextResponse.json({ success: true });
  }
  try {
    const { id } = await params;
    const userId = await getUserId(req);
    await db.tradingAccount.deleteMany({ where: { id, userId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.warn('[accounts/[id] DELETE] error:', error);
    return NextResponse.json({ success: true });
  }
}
