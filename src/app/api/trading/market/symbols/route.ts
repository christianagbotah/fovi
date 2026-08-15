// ============================================================
// GET /api/trading/market/symbols — Market data
// Phase 1 CR4.1:
//   All responses use shared provenance model from src/lib/provenance.ts.
//   Single prices, candles, caches, and demo fallbacks carry provenance.
//   Demo data is never represented as live.
// ============================================================

import { NextResponse } from 'next/server';
import { getAllDemoSymbols, getDemoCandles } from '@/lib/broker/demo';
import { fetchAllRealPrices, fetchCryptoPrices, type MarketPrice } from '@/lib/market-data';
import {
  type Provenance,
  provenanceHeaders,
  DEMO_PROVENANCE,
} from '@/lib/provenance';

const COINGECKO_IDS: Record<string, string> = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', BNB: 'binancecoin',
  XRP: 'ripple', DOGE: 'dogecoin', ADA: 'cardano', AVAX: 'avalanche-2',
  DOT: 'polkadot', LINK: 'chainlink',
};

const COINGECKO_DAYS_MAP: Record<string, number> = {
  '1m': 1, '5m': 1, '15m': 1, '1h': 1, '4h': 1, '1d': 30, '1w': 90,
};

// Cache stores provenance alongside data so cached data retains original provenance
interface CacheEntry<T> {
  data: T;
  provenance: Provenance;
  ts: number;
}

const ohlcCache = new Map<string, CacheEntry<unknown>>();
const OHLC_CACHE_TTL = 30_000;

function getCached<T>(key: string): { data: T; provenance: Provenance } | null {
  const entry = ohlcCache.get(key);
  if (entry && Date.now() - entry.ts < OHLC_CACHE_TTL) return { data: entry.data as T, provenance: entry.provenance };
  return null;
}

function setCache(key: string, data: unknown, provenance: Provenance) {
  ohlcCache.set(key, { data, provenance, ts: Date.now() });
}

async function fetchCryptoCandles(
  symbol: string,
  timeframe: string,
  limit: number,
): Promise<{ candles: ReturnType<typeof getDemoCandles> | null; provenance: Provenance }> {
  const coinId = COINGECKO_IDS[symbol];
  if (!coinId) return { candles: null, provenance: { ...DEMO_PROVENANCE } };

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
      return { candles: null, provenance: { ...DEMO_PROVENANCE } };
    }

    const provenance: Provenance = {
      environment: 'live',
      isSynthetic: false,
      source: 'coingecko',
      observedAt: new Date().toISOString(),
    };
    setCache(cacheKey, candles, provenance);
    return { candles, provenance };
  } catch {
    return { candles: null, provenance: { ...DEMO_PROVENANCE } };
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
    const provenance: Provenance = price._realData
      ? { environment: 'live', isSynthetic: false, source: 'market-data-service', observedAt: new Date().toISOString() }
      : { ...DEMO_PROVENANCE };
    return NextResponse.json(
      { ...price, provenance },
      { headers: provenanceHeaders(provenance) },
    );
  }

  // --- Candles for a specific symbol ---
  if (symbol && timeframeParam) {
    const { candles: cryptoCandles, provenance } = await fetchCryptoCandles(symbol, timeframeParam, limit);
    if (cryptoCandles && cryptoCandles.length > 0) {
      return NextResponse.json(
        { candles: cryptoCandles, provenance },
        { headers: provenanceHeaders(provenance) },
      );
    }
    // Demo fallback — tagged with demo provenance, never live
    const demoCandles = getDemoCandles(symbol, timeframeParam, limit);
    const demoProv: Provenance = { ...DEMO_PROVENANCE };
    return NextResponse.json(
      { candles: demoCandles, provenance: demoProv },
      { headers: provenanceHeaders(demoProv) },
    );
  }

  // --- Full symbol list (merged real data + demo fallback) ---
  const [realPricesMap, demoSymbols] = await Promise.all([
    fetchAllRealPrices(),
    Promise.resolve(getAllDemoSymbols()),
  ]);

  const enrichedSymbols = demoSymbols.map((sym) => {
    const real = realPricesMap.get(sym.symbol);
    if (real) {
      const prov: Provenance = {
        environment: 'live',
        isSynthetic: false,
        source: 'market-data-service',
        observedAt: new Date().toISOString(),
      };
      return {
        ...sym,
        price: real.price, change: real.change, changePercent: real.changePercent,
        volume: real.volume, high24h: real.high24h, low24h: real.low24h,
        provenance: prov,
      };
    }
    const prov: Provenance = { ...DEMO_PROVENANCE };
    return { ...sym, provenance: prov };
  });

  return NextResponse.json(enrichedSymbols);
}
