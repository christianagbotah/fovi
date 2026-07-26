import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const accountId = searchParams.get('accountId');
    const userId = 'usr_demo_1';

    const account = await db.tradingAccount.findFirst({
      where: { userId, ...(accountId ? { id: accountId } : { isDefault: true }) },
    });
    if (!account) return NextResponse.json([]);

    const signals = await db.tradingSignal.findMany({
      where: { accountId: account.id, status: 'active' },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    return NextResponse.json(signals);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to fetch signals';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
