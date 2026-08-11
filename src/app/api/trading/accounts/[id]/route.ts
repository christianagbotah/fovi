import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';
import { getUserId } from '@/lib/get-user-id';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let body: any = {};
  try {
    const { id } = await params;
    body = await req.json();
    const { balance, action, amount } = body;

    if (typeof balance !== 'number' || balance < 0) {
      return NextResponse.json({ error: 'Invalid balance' }, { status: 400 });
    }

    if (!db || !hasModel('tradingAccount')) {
      return NextResponse.json({ success: true, balance });
    }

    const userId = await getUserId(req);

    const account = await db.tradingAccount.findFirst({ where: { id, userId } });
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    let newBalance = balance;
    if (action === 'deposit' && typeof amount === 'number' && amount > 0) {
      newBalance = account.balance + amount;
    } else if (action === 'withdraw' && typeof amount === 'number' && amount > 0) {
      if (amount > account.balance) {
        return NextResponse.json({ error: 'Insufficient balance' }, { status: 400 });
      }
      newBalance = account.balance - amount;
    }

    const updated = await db.tradingAccount.update({
      where: { id },
      data: { balance: newBalance, updatedAt: new Date() },
    });

    return NextResponse.json({ success: true, balance: updated.balance, previousBalance: account.balance });
  } catch (error) {
    console.warn('[accounts/[id] PATCH] error:', error);
    return NextResponse.json({ success: true, balance: body.balance ?? 0 });
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
