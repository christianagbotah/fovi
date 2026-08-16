import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';
import { getUserId, AuthRequiredError, authRequiredResponse } from '@/lib/get-user-id';
import { logSecurityEvent } from '@/lib/trading-policy';

export async function GET(req: NextRequest) {
  try {
    if (!db || !hasModel('tradingAccount') || !hasModel('tradingSignal')) {
      return NextResponse.json(
        { error: 'Signal data is temporarily unavailable.', code: 'SERVICE_UNAVAILABLE', remediationPhase: 'containment' },
        { status: 503 },
      );
    }

    const { searchParams } = new URL(req.url);
    const accountId = searchParams.get('accountId');

    const userId = await getUserId(req);

    const account = await db.tradingAccount.findFirst({
      where: { userId, ...(accountId ? { id: accountId } : { isDefault: true }) },
    });
    if (!account) return NextResponse.json([]);

    const signals = await db.tradingSignal.findMany({
      where: { accountId: account.id, status: 'active' },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });

    const normalized = signals.map((s: Record<string, unknown>) => ({
      ...s,
      direction: s.direction === 'long' ? 'bullish' : s.direction === 'short' ? 'bearish' : s.direction,
    }));

    return NextResponse.json(normalized);
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      return authRequiredResponse();
    }
    logSecurityEvent({
      eventType: 'SIGNALS_GET_ERROR',
      route: '/api/trading/signals',
      reason: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json({ error: 'Failed to fetch signals' }, { status: 500 });
  }
}
