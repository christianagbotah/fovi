import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';

const DEMO_ENTRIES = [
  {
    id: 'journal_demo_1',
    userId: 'usr_demo_1',
    positionId: null,
    orderId: null,
    symbol: 'NVDA',
    side: 'long',
    entryPrice: 875.20,
    exitPrice: 920.50,
    qty: 10,
    pnl: 453.0,
    pnlPercent: 5.18,
    entryReason: 'Momentum breakout above prior resistance with strong volume confirmation.',
    exitReason: 'Hit take-profit target after 3-day rally.',
    aiInsight:
      'Strong execution — entry aligned with MACD crossover and 20 EMA support. RSI was heating up (72) at entry but volume supported continuation. Consider trailing stop earlier next time to capture more upside.',
    lessons: 'Trail stops more aggressively on parabolic moves; partial profit at +3%.',
    rating: 4,
    tags: 'momentum,breakout,tech',
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    id: 'journal_demo_2',
    userId: 'usr_demo_1',
    positionId: null,
    orderId: null,
    symbol: 'BTC',
    side: 'long',
    entryPrice: 64200,
    exitPrice: 67100,
    qty: 0.5,
    pnl: 1450,
    pnlPercent: 4.51,
    entryReason: 'DCA buy triggered on 5% pullback from local high.',
    exitReason: 'Grid sell order filled at upper grid level.',
    aiInsight:
      'Grid strategy performed as designed. Volatility regime was appropriate (ATR ~3%). Spread buys evenly captured the dip. Watch for trend exhaustion at major resistance zones.',
    lessons: 'Increase grid spacing in low-vol regimes to avoid overtrading.',
    rating: 5,
    tags: 'crypto,grid,dca',
    createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
    updatedAt: new Date(Date.now() - 86400000 * 2).toISOString(),
  },
  {
    id: 'journal_demo_3',
    userId: 'usr_demo_1',
    positionId: null,
    orderId: null,
    symbol: 'TSLA',
    side: 'short',
    entryPrice: 252.10,
    exitPrice: 248.30,
    qty: 20,
    pnl: 76,
    pnlPercent: 1.51,
    entryReason: 'RSI overbought + bearish divergence on 1h chart.',
    exitReason: 'Stop-loss hit on intraday reversal.',
    aiInsight:
      'Setup was valid but timing was early. Stock squeezed 2% above entry before reversing. Risk management kept loss small but the trade outcome was sub-optimal. Wait for confirmation candle next time.',
    lessons: 'Wait for close below support before shorting overbought conditions.',
    rating: 2,
    tags: 'short,rsi,divergence',
    createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
    updatedAt: new Date(Date.now() - 86400000 * 3).toISOString(),
  },
  {
    id: 'journal_demo_4',
    userId: 'usr_demo_1',
    positionId: null,
    orderId: null,
    symbol: 'ETH',
    side: 'long',
    entryPrice: 3180,
    exitPrice: 3520,
    qty: 2,
    pnl: 680,
    pnlPercent: 10.69,
    entryReason: 'Breakout above 50-day high with rising volume.',
    exitReason: 'Trailed stop hit after 8% run.',
    aiInsight:
      'Excellent trend-following trade. Entry was tight, position sizing matched risk profile. Trailing stop locked in 80% of the move. Repeat this pattern when conditions align.',
    lessons: 'Trust the trend — do not exit early on pullbacks within trend structure.',
    rating: 5,
    tags: 'crypto,breakout,trend',
    createdAt: new Date(Date.now() - 86400000 * 4).toISOString(),
    updatedAt: new Date(Date.now() - 86400000 * 4).toISOString(),
  },
  {
    id: 'journal_demo_5',
    userId: 'usr_demo_1',
    positionId: null,
    orderId: null,
    symbol: 'AAPL',
    side: 'long',
    entryPrice: 188.40,
    exitPrice: 192.10,
    qty: 50,
    pnl: 185,
    pnlPercent: 1.96,
    entryReason: 'Support bounce with bullish engulfing candle.',
    exitReason: 'Scalp target hit at next resistance.',
    aiInsight:
      'Clean scalp on a range-bound day. Support held, volume confirmed reversal. Risk/reward was 1:1.5 — acceptable for high-probability setup.',
    lessons: 'Look for clearer range extremes; entry was 0.5% from ideal.',
    rating: 3,
    tags: 'stock,scalp,support',
    createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
    updatedAt: new Date(Date.now() - 86400000 * 5).toISOString(),
  },
];

const DB_MODEL = 'tradeJournal';

export async function GET() {
  if (!db || !hasModel(DB_MODEL)) {
    return NextResponse.json(DEMO_ENTRIES);
  }
  try {
    const userId = 'usr_demo_1';
    const entries = await db.tradeJournal.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return NextResponse.json(entries);
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('validating datasource')) {
      return NextResponse.json(DEMO_ENTRIES);
    }
    const msg = error instanceof Error ? error.message : 'Failed to fetch journal entries';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!db || !hasModel(DB_MODEL)) {
    const created = {
      id: `journal_demo_${Date.now()}`,
      userId: 'usr_demo_1',
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
      aiInsight:
        body.aiInsight ||
        'AI Insight (demo): Trade executed within acceptable risk parameters. Consider reviewing position sizing relative to overall portfolio exposure.',
      lessons: body.lessons ?? null,
      rating: body.rating ?? null,
      tags: body.tags ?? null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return NextResponse.json(created);
  }
  try {
    const userId = 'usr_demo_1';
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
        aiInsight:
          body.aiInsight ||
          'AI Insight: Trade executed within acceptable risk parameters. Consider reviewing position sizing relative to overall portfolio exposure.',
        lessons: body.lessons ?? null,
        rating: body.rating ?? null,
        tags: body.tags ?? null,
      },
    });
    return NextResponse.json(created);
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('validating datasource')) {
      const fallback = {
        id: `journal_demo_${Date.now()}`,
        userId: 'usr_demo_1',
        symbol: body.symbol || 'BTC',
        side: body.side || 'long',
        entryPrice: body.entryPrice ?? 0,
        createdAt: new Date().toISOString(),
      };
      return NextResponse.json(fallback);
    }
    const msg = error instanceof Error ? error.message : 'Failed to create journal entry';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
