import { NextResponse } from 'next/server';
import { getAllDemoSymbols, getDemoCandles } from '@/lib/broker/demo';
import { fetchAllRealPrices, fetchCryptoPrices, type MarketPrice } from '@/lib/market-data';

// ============================================================
// Real Market Data Integration — Unified Service
// ------------------------------------------------------------
// Uses src/lib/market-data.ts which centralizes:
//   - Crypto:  CoinGecko free API (no key)
//   - Forex:   ExchangeRate-API (free, no key)
//   - Metals:  metals.live API (free, no key)
//   - Stocks:  Finnhub free API (FINNHUB_API_KEY env var)
// All API calls wrapped in try/catch with demo fallback.
// ============================================================

// CoinGecko coin IDs for OHLC candles
const COINGECKO_IDS: Record<string, string> = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', BNB: 'binancecoin',
  XRP: 'ripple', DOGE: 'dogecoin', ADA: 'cardano', AVAX: 'avalanche-2',
  DOT: 'polkadot', LINK: 'chainlink',
};

const COINGECKO_DAYS_MAP: Record<string, number> = {
  '1m': 1, '5m': 1, '15m': 1, '1h': 1, '4h': 1, '1d': 30, '1w': 90,
};

// In-memory cache for OHLC data
const ohlcCache = new Map<string, { data: unknown; ts: number }>();
const OHLC_CACHE_TTL = 30_000;

function getCached<T>(key: string): T | null {
  const entry = ohlcCache.get(key);
  if (entry && Date.now() - entry.ts < OHLC_CACHE_TTL) return entry.data as T;
  return null;
}

function setCache(key: string, data: unknown) {
  ohlcCache.set(key, { data, ts: Date.now() });
}

// ============================================================
// CoinGecko: OHLC candles for a single coin
// ============================================================

async function fetchCryptoCandles(
  symbol: string,
  timeframe: string,
  limit: number,
): Promise<ReturnType<typeof getDemoCandles> | null> {
  const coinId = COINGECKO_IDS[symbol];
  if (!coinId) return null;

  const cacheKey = `candles_${symbol}_${timeframe}`;
  const cached = getCached<ReturnType<typeof getDemoCandles>>(cacheKey);
  if (cached) return cached;

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
      timestamp: c[0],
      open: c[1],
      high: c[2],
      low: c[3],
      close: c[4],
      volume: 0,
    }));

    if (candles.length === 0) return null;
    setCache(cacheKey, candles);
    return candles;
  } catch (err) {
    console.warn(
      `[market/symbols] CoinGecko OHLC failed for ${symbol}, using demo:`,
      err,
    );
    return null;
  }
}

// ============================================================
// Route handler
// ============================================================

export async function GET(req: globalThis.Request) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get('symbol');
  const timeframe = searchParams.get('timeframe') || '1d';
  const limit = parseInt(searchParams.get('limit') || '100');
  const liveOnly = searchParams.get('live') === 'true';

  // --- Single symbol price lookup ---------------------------
  if (symbol && !timeframe) {
    // If someone requests a single symbol without timeframe, return price data
    const { getSinglePrice } = await import('@/lib/market-data');
    const price = await getSinglePrice(symbol);
    return NextResponse.json(price);
  }

  // --- Candles for a specific symbol -------------------------
  if (symbol) {
    const cryptoCandles = await fetchCryptoCandles(symbol, timeframe, limit);
    if (cryptoCandles && cryptoCandles.length > 0) {
      return NextResponse.json(cryptoCandles);
    }
    const candles = getDemoCandles(symbol, timeframe, limit);
    return NextResponse.json(candles);
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
        price: real.price,
        change: real.change,
        changePercent: real.changePercent,
        volume: real.volume,
        high24h: real.high24h,
        low24h: real.low24h,
        _realData: true,
      };
    }
    return { ...sym, _realData: false };
  });

  // Filter to only live data if requested
  if (liveOnly) {
    const live = enrichedSymbols.filter(s => (s as Record<string, unknown>)._realData === true);
    return NextResponse.json(live);
  }

  return NextResponse.json(enrichedSymbols);
}
