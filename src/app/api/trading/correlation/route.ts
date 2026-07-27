import { NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';

const PORTFOLIO_SYMBOLS = ['BTC', 'ETH', 'AAPL', 'NVDA', 'TSLA', 'SOL', 'GOOGL'];

// Realistic demo correlation matrix (symmetric, 1.0 on diagonal)
// Order matches PORTFOLIO_SYMBOLS above.
const DEMO_MATRIX: Record<string, Record<string, number>> = {
  BTC: { BTC: 1.0, ETH: 0.85, AAPL: 0.32, NVDA: 0.45, TSLA: 0.28, SOL: 0.78, GOOGL: 0.30 },
  ETH: { BTC: 0.85, ETH: 1.0, AAPL: 0.28, NVDA: 0.42, TSLA: 0.25, SOL: 0.82, GOOGL: 0.26 },
  AAPL: { BTC: 0.32, ETH: 0.28, AAPL: 1.0, NVDA: 0.62, TSLA: 0.41, SOL: 0.22, GOOGL: 0.71 },
  NVDA: { BTC: 0.45, ETH: 0.42, AAPL: 0.62, NVDA: 1.0, TSLA: 0.48, SOL: 0.35, GOOGL: 0.58 },
  TSLA: { BTC: 0.28, ETH: 0.25, AAPL: 0.41, NVDA: 0.48, TSLA: 1.0, SOL: 0.18, GOOGL: 0.34 },
  SOL: { BTC: 0.78, ETH: 0.82, AAPL: 0.22, NVDA: 0.35, TSLA: 0.18, SOL: 1.0, GOOGL: 0.20 },
  GOOGL: { BTC: 0.30, ETH: 0.26, AAPL: 0.71, NVDA: 0.58, TSLA: 0.34, SOL: 0.20, GOOGL: 1.0 },
};

function buildDemoResponse() {
  return {
    symbols: PORTFOLIO_SYMBOLS,
    matrix: DEMO_MATRIX,
    asRows: PORTFOLIO_SYMBOLS.map((row) => ({
      symbol: row,
      values: PORTFOLIO_SYMBOLS.map((col) => DEMO_MATRIX[row][col]),
    })),
    computedAt: new Date().toISOString(),
    source: 'demo',
  };
}

export async function GET() {
  if (!db || !hasModel('tradingAccount')) {
    return NextResponse.json(buildDemoResponse());
  }
  try {
    const userId = 'usr_demo_1';
    // Pull user's open positions to derive their actual portfolio symbols
    const account = await db.tradingAccount.findFirst({
      where: { userId, isDefault: true },
    });

    if (!account) {
      return NextResponse.json(buildDemoResponse());
    }

    const positions = await db.position.findMany({
      where: { accountId: account.id, status: 'open' },
    });

    const symbols = Array.from(new Set(positions.map((p) => p.symbol))).slice(0, 12);
    if (symbols.length === 0) {
      return NextResponse.json(buildDemoResponse());
    }

    // Fetch recent daily market data per symbol for correlation calculation
    const since = new Date(Date.now() - 60 * 86400000); // 60 days
    const seriesMap: Record<string, number[]> = {};
    for (const symbol of symbols) {
      const rows = await db.marketData.findMany({
        where: { symbol, timeframe: '1d', timestamp: { gte: since } },
        orderBy: { timestamp: 'asc' },
      });
      if (rows.length >= 10) {
        seriesMap[symbol] = rows.map((r) => r.close);
      }
    }

    const validSymbols = symbols.filter((s) => (seriesMap[s]?.length ?? 0) >= 10);
    if (validSymbols.length === 0) {
      // Fallback when no market data is available — return demo matrix scaled to requested symbols
      return NextResponse.json(buildDemoResponse());
    }

    // Compute daily returns and Pearson correlation
    const returnsMap: Record<string, number[]> = {};
    for (const s of validSymbols) {
      const prices = seriesMap[s];
      const rets: number[] = [];
      for (let i = 1; i < prices.length; i++) {
        rets.push((prices[i] - prices[i - 1]) / prices[i - 1]);
      }
      returnsMap[s] = rets;
    }

    const matrix: Record<string, Record<string, number>> = {};
    for (const a of validSymbols) {
      matrix[a] = {};
      for (const b of validSymbols) {
        matrix[a][b] = Number(pearson(returnsMap[a], returnsMap[b]).toFixed(4));
      }
    }

    return NextResponse.json({
      symbols: validSymbols,
      matrix,
      asRows: validSymbols.map((row) => ({
        symbol: row,
        values: validSymbols.map((col) => matrix[row][col]),
      })),
      computedAt: new Date().toISOString(),
      source: 'db',
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('validating datasource')) {
      return NextResponse.json(buildDemoResponse());
    }
    const msg = error instanceof Error ? error.message : 'Failed to compute correlation';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const sa = a.slice(0, n);
  const sb = b.slice(0, n);
  const meanA = sa.reduce((x, y) => x + y, 0) / n;
  const meanB = sb.reduce((x, y) => x + y, 0) / n;
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < n; i++) {
    const da = sa[i] - meanA;
    const db_ = sb[i] - meanB;
    num += da * db_;
    denA += da * da;
    denB += db_ * db_;
  }
  const den = Math.sqrt(denA * denB);
  return den === 0 ? 0 : num / den;
}
