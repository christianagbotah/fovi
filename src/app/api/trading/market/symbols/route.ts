import { NextResponse } from 'next/server';
import { getAllDemoSymbols, getDemoCandles } from '@/lib/broker/demo';

// ============================================================
// Real Market Data Integration — CoinGecko Free API
// ------------------------------------------------------------
// Crypto data is fetched live from CoinGecko (no API key needed).
// Stocks / forex / commodities continue to use the demo system
// below. On a VPS, set TWELVEDATA_API_KEY (or similar) to enable
// real stock data — see fetchStockSymbols() hook below.
// All real API calls are wrapped in try/catch with demo fallback
// so the app never breaks when CoinGecko is unavailable.
// ============================================================

// CoinGecko coin IDs for our crypto symbols
const COINGECKO_IDS: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  BNB: 'binancecoin',
  XRP: 'ripple',
  DOGE: 'dogecoin',
  ADA: 'cardano',
  AVAX: 'avalanche-2',
  DOT: 'polkadot',
  LINK: 'chainlink',
};

// Timeframe → CoinGecko `days` parameter
// (1m..4h use 1 day of minutely OHLC; 1d uses 30d; 1w uses 90d)
const COINGECKO_DAYS_MAP: Record<string, number> = {
  '1m': 1,
  '5m': 1,
  '15m': 1,
  '1h': 1,
  '4h': 1,
  '1d': 30,
  '1w': 90,
};

// In-memory cache for API responses — avoids hammering CoinGecko
const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL = 30_000; // 30 seconds

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data as T;
  return null;
}

function setCache(key: string, data: unknown) {
  cache.set(key, { data, ts: Date.now() });
}

// ============================================================
// CoinGecko: symbols list (top 20 by market cap)
// ============================================================

interface CoinGeckoMarket {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  market_cap: number;
  total_volume: number;
  price_change_24h: number;
  price_change_percentage_24h: number;
  high_24h: number;
  low_24h: number;
}

async function fetchCryptoSymbols(): Promise<CoinGeckoMarket[]> {
  const cached = getCached<CoinGeckoMarket[]>('crypto_symbols');
  if (cached) return cached;

  try {
    const url =
      'https://api.coingecko.com/api/v3/coins/markets' +
      '?vs_currency=usd&order=market_cap_desc&per_page=20&page=1' +
      '&sparkline=false&price_change_percentage=24h';
    const res = await fetch(url, {
      next: { revalidate: 30 },
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`CoinGecko markets HTTP ${res.status}`);
    const data = (await res.json()) as CoinGeckoMarket[];
    setCache('crypto_symbols', data);
    return data;
  } catch (err) {
    console.warn('[market/symbols] CoinGecko markets failed, using demo:', err);
    return [];
  }
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

    // CoinGecko returns: [[timestamp, open, high, low, close], ...]
    const raw = (await res.json()) as number[][];
    const candles = raw.slice(-limit).map((c) => ({
      timestamp: c[0],
      open: c[1],
      high: c[2],
      low: c[3],
      close: c[4],
      // CoinGecko free OHLC endpoint does not include volume
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
// Stocks / Forex / Commodities — demo with real-API hook
// ------------------------------------------------------------
// On a VPS with TWELVEDATA_API_KEY set, you would call the
// TwelveData `/symbol_price` or `/time_series` endpoints here.
// For local / open-source use we keep the demo broker data so
// the platform is fully functional without an API key.
// ============================================================

async function fetchStockSymbols(): Promise<ReturnType<typeof getAllDemoSymbols> | null> {
  // Hook for real stock data when an API key is configured.
  // Example (TwelveData):
  //   const key = process.env.TWELVEDATA_API_KEY;
  //   if (!key) return null;
  //   const res = await fetch(`https://api.twelvedata.com/price?symbol=AAPL&apikey=${key}`);
  //   ...
  return null;
}

// ============================================================
// Route handler
// ============================================================

export async function GET(req: globalThis.Request) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get('symbol');
  const timeframe = searchParams.get('timeframe') || '1d';
  const limit = parseInt(searchParams.get('limit') || '100');

  // --- Candles for a specific symbol -------------------------
  if (symbol) {
    // Try real API for crypto first
    const cryptoCandles = await fetchCryptoCandles(symbol, timeframe, limit);
    if (cryptoCandles && cryptoCandles.length > 0) {
      return NextResponse.json(cryptoCandles);
    }
    // Fallback to demo for stocks / forex / commodities
    const candles = getDemoCandles(symbol, timeframe, limit);
    return NextResponse.json(candles);
  }

  // --- Full symbol list (merged real crypto + demo rest) -----
  const [cryptoData, demoSymbols] = await Promise.all([
    fetchCryptoSymbols(),
    Promise.resolve(getAllDemoSymbols()),
  ]);

  // Optional real stock data (returns null without an API key)
  const realStocks = await fetchStockSymbols();

  const cryptoSet = COINGECKO_IDS;
  const enrichedSymbols = demoSymbols.map((sym) => {
    // Real crypto data from CoinGecko
    if (cryptoSet[sym.symbol]) {
      const cgData = cryptoData.find(
        (c) => c.symbol?.toUpperCase() === sym.symbol,
      );
      if (cgData) {
        return {
          ...sym,
          price: cgData.current_price,
          change: cgData.price_change_24h ?? 0,
          changePercent: cgData.price_change_percentage_24h ?? 0,
          volume: cgData.total_volume ?? 0,
          high24h: cgData.high_24h ?? sym.high24h,
          low24h: cgData.low_24h ?? sym.low24h,
          _realData: true,
        };
      }
    }

    // Real stock data hook (if API key configured)
    if (realStocks) {
      const rs = realStocks.find((r) => r.symbol === sym.symbol);
      if (rs) {
        return { ...rs, _realData: true };
      }
    }

    // Pure demo data
    return { ...sym, _realData: false };
  });

  return NextResponse.json(enrichedSymbols);
}
