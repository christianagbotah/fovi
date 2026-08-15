// ============================================================
// GET /api/trading/market/symbols — Market data
// Phase 1 CR2:
//   Fix timeframe check (was defaulting before checking).
//   Tag demo candle fallback with provenance.
//   Tag real data with provenance.
// ============================================================

import { NextResponse } from 'next/server';
import { getAllDemoSymbols, getDemoCandles } from '@/lib/broker/demo';
import { fetchAllRealPrices, fetchCryptoPrices, type MarketPrice } from '@/lib/market-data';
import { DEMO_PROVENANCE_HEADER } from '@/lib/trading-policy';

const COINGECKO_IDS: Record<string, string> = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', BNB: 'binancecoin',
  XRP: 'ripple', DOGE: 'dogecoin', ADA: 'cardano', AVAX: 'avalanche-2',
  DOT: 'polkadot', LINK: 'chainlink',
};

const COINGECKO_DAYS_MAP: Record<string, number> = {
  '1m': 1, '5m': 1, '15m': 1, '1h': 1, '4h': 1, '1d': 30, '1w': 90,
};

const ohlcCache = new Map<string, { data: unknown; ts: number; provenance: { environment: string; isSynthetic: boolean; source: string } }>();
const OHLC_CACHE_TTL = 30_000;

function getCached<T>(key: string): { data: T; provenance: { environment: string; isSynthetic: boolean; source: string } } | null {
  const entry = ohlcCache.get(key);
  if (entry && Date.now() - entry.ts < OHLC_CACHE_TTL) return { data: entry.data as T, provenance: entry.provenance };
  return null;
}

function setCache(key: string, data: unknown, provenance: { environment: string; isSynthetic: boolean; source: string }) {
  ohlcCache.set(key, { data, ts: Date.now(), provenance });
}

async function fetchCryptoCandles(
  symbol: string,
  timeframe: string,
  limit: number,
): Promise<{ candles: ReturnType<typeof getDemoCandles> | null; provenance: { environment: string; isSynthetic: boolean; source: string } }> {
  const coinId = COINGECKO_IDS[symbol];
  if (!coinId) return { candles: null, provenance: { environment: 'demo', isSynthetic: true, source: 'fovi-demo-generator' } };

  const cacheKey = `candles_${symbol}_${timeframe}`;
  const cached = getCached<ReturnType<typeof getDemoCandles>>(cacheKey);
  if (cached) return { candles: cached.data, provenance: cached.provenance };

  try {
    const days = COINGECKO_DAYS_MAP[timeframe] ?? 30;
    const url = `https://api.coingecko.com/api/v3/coins/${coinId}/ohlc?vs_currency=usd&days=${days}`;
    const res = await fetch(url, {
      next: { revalidate: 30 },
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`CoinGecko OHLC HTTP ${res.status}`);

    const raw = (await res.json()) as number[][];
    const candles = raw.slice(-limit).map((c) => ({
      timestamp: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: 0,
    }));

    if (candles.length === 0) {
      const provenance = { environment: 'demo' as const, isSynthetic: true as const, source: 'fovi-demo-generator' as const };
      return { candles: null, provenance };
    }

    const provenance = { environment: 'live', isSynthetic: false, source: 'coingecko' };
    setCache(cacheKey, candles, provenance);
    return { candles, provenance };
  } catch {
    const provenance = { environment: 'demo' as const, isSynthetic: true as const, source: 'fovi-demo-generator' as const };
    return { candles: null, provenance };
  }
}

export async function GET(req: globalThis.Request) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get('symbol');
  const timeframeParam = searchParams.get('timeframe');
  const limit = parseInt(searchParams.get('limit') || '100');

  // --- Single symbol price lookup (no timeframe requested) ---
  if (symbol && !timeframeParam) {
    const { getSinglePrice } = await import('@/lib/market-data');
    const price = await getSinglePrice(symbol);
    return NextResponse.json(price);
  }

  // --- Candles for a specific symbol ---
  if (symbol && timeframeParam) {
    const { candles: cryptoCandles, provenance } = await fetchCryptoCandles(symbol, timeframeParam, limit);
    if (cryptoCandles && cryptoCandles.length > 0) {
      const headers: Record<string, string> = {
        'x-environment': provenance.environment,
        'x-synthetic': String(provenance.isSynthetic),
        'x-data-source': provenance.source,
      };
      return NextResponse.json(cryptoCandles, { headers });
    }
    // Demo fallback — tag with provenance
    const demoCandles = getDemoCandles(symbol, timeframeParam, limit);
    return NextResponse.json(demoCandles, { headers: DEMO_PROVENANCE_HEADER });
  }

  // --- Full symbol list (merged real data + demo fallback) ---
  const [realPricesMap, demoSymbols] = await Promise.all([
    fetchAllRealPrices(),
    Promise.resolve(getAllDemoSymbols()),
  ]);

  const enrichedSymbols = demoSymbols.map((sym) => {
    const real = realPricesMap.get(sym.symbol);
    if (real) {
      return {
        ...sym,
        price: real.price, change: real.change, changePercent: real.changePercent,
        volume: real.volume, high24h: real.high24h, low24h: real.low24h,
        environment: 'live', isSynthetic: false, source: 'market-data-service',
      };
    }
    return { ...sym, environment: 'demo', isSynthetic: true, source: 'fovi-demo-generator' };
  });

  return NextResponse.json(enrichedSymbols);
}
