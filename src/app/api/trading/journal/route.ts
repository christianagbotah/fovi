import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';
import { getUserId, getUserIdSync, AuthRequiredError, authRequiredResponse } from '@/lib/get-user-id';
import { DEMO_PROVENANCE_HEADER, logSecurityEvent } from '@/lib/trading-policy';

// Static demo journal entries for read-only fallback.
// These are NEVER persisted.
const DEMO_ENTRIES = [
  {
    id: 'journal_demo_1',
    symbol: 'NVDA',
    side: 'long',
    entryPrice: 875.20,
    exitPrice: 920.50,
    qty: 10,
    pnl: 453.0,
    pnlPercent: 5.18,
    rating: 4,
    tags: 'momentum,breakout,tech',
    createdAt: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    id: 'journal_demo_2',
    symbol: 'BTC',
    side: 'long',
    entryPrice: 64200,
    exitPrice: 67100,
    qty: 0.5,
    pnl: 1450,
    pnlPercent: 4.51,
    rating: 5,
    tags: 'crypto,grid,dca',
    createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
  },
];

const DB_MODEL = 'tradeJournal';

export async function GET(req: NextRequest) {
  // CR4.1: Auth before fallback — require auth even when DB is unavailable
  if (!db || !hasModel(DB_MODEL)) {
    try {
      getUserIdSync(req);
    } catch {
      return authRequiredResponse();
    }
    return NextResponse.json(
      { error: 'Journal data is temporarily unavailable.', code: 'SERVICE_UNAVAILABLE', remediationPhase: 'containment' },
      { status: 503 },
    );
  }
  try {
    const userId = getUserIdSync(req);
    const entries = await db.tradeJournal.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return NextResponse.json(entries);
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      return authRequiredResponse();
    }
    logSecurityEvent({
      eventType: 'JOURNAL_GET_ERROR',
      route: '/api/trading/journal',
      reason: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json({ error: 'Failed to fetch journal entries' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));

  if (!db || !hasModel(DB_MODEL)) {
    return NextResponse.json(
      { error: 'Journal creation is temporarily unavailable.', code: 'SERVICE_UNAVAILABLE', remediationPhase: 'containment' },
      { status: 503 },
    );
  }

  let userId: string;
  try {
    userId = await getUserId(req);
  } catch {
    return authRequiredResponse();
  }

  try {
    const created = await db.tradeJournal.create({
      data: {
        userId,
        positionId: body.positionId ?? null,
        orderId: body.orderId ?? null,
        symbol: body.symbol || 'BTC',
        side: body.side || 'long',
        entryPrice: body.entryPrice ?? 0,
        exitPrice: body.exitPrice ?? null,
        qty: body.qty ?? 0,
        pnl: body.pnl ?? null,
        pnlPercent: body.pnlPercent ?? null,
        entryReason: body.entryReason ?? null,
        exitReason: body.exitReason ?? null,
        aiInsight: body.aiInsight ?? null,
        lessons: body.lessons ?? null,
        rating: body.rating ?? null,
        tags: body.tags ?? null,
      },
    });
    return NextResponse.json(created);
  } catch (error) {
    logSecurityEvent({
      eventType: 'JOURNAL_POST_ERROR',
      route: '/api/trading/journal',
      userId,
      reason: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: `Failed to create journal entry: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 },
    );
  }
}
