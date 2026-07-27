import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    if (!db || !hasModel('tradingAccount')) return NextResponse.json([]);

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
    const msg = error instanceof Error ? error.message : '';
    if (msg.includes('validating datasource') || msg.includes('postgresql://')) {
      return NextResponse.json([]);
    }
    return NextResponse.json({ error: msg || 'Failed' }, { status: 500 });
  }
}
