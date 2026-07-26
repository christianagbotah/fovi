import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const { accountId } = await req.json();
    const userId = 'usr_demo_1';

    // Unset all defaults
    await db.tradingAccount.updateMany({
      where: { userId },
      data: { isDefault: false },
    });

    // Set new default
    const account = await db.tradingAccount.update({
      where: { id: accountId, userId },
      data: { isDefault: true },
    });

    return NextResponse.json(account);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to switch account';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}