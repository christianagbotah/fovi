import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel, ensureDemoUser } from '@/lib/db';
import { getUserId } from '@/lib/get-user-id';

export async function GET(req: NextRequest) {
  try {
    // Require database for reading stored signals
    if (!db || !hasModel('tradingAccount') || !hasModel('tradingSignal')) {
      return NextResponse.json([], { headers: { 'x-demo': 'true' } });
    }

    const { searchParams } = new URL(req.url);
    const accountId = searchParams.get('accountId');

    // Ensure demo user exists for FK constraints
    await ensureDemoUser();
    const userId = await getUserId(req);

    const account = await db.tradingAccount.findFirst({
      where: { userId, ...(accountId ? { id: accountId } : { isDefault: true }) },
    });
    if (!account) return NextResponse.json([], { headers: { 'x-demo': 'true' } });

    const signals = await db.tradingSignal.findMany({
      where: { accountId: account.id, status: 'active' },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });

    // Normalize direction field for frontend
    const normalized = signals.map((s: any) => ({
      ...s,
      direction: s.direction === 'long' ? 'bullish' : s.direction === 'short' ? 'bearish' : s.direction,
    }));

    return NextResponse.json(normalized);
  } catch (error) {
    console.warn('[signals GET] Error:', error);
    return NextResponse.json([], { headers: { 'x-demo': 'true' } });
  }
}
