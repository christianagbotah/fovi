// ============================================================
// Unified Market Data Service
// ------------------------------------------------------------
// Centralized real-time market data for all asset types:
//   - Crypto: CoinGecko free API (no key)
//   - Forex:  ExchangeRate-API (free, no key)
//   - Metals/Commodities: metals.live API (free, no key)
//   - Stocks/Indices: Finnhub free API (FINNHUB_API_KEY env var)
// All calls have try/catch with graceful fallback to demo prices.
// ============================================================

import { getDemoPrice, getAssetType, SYMBOL_NAMES, BASE_PRICES } from './broker/demo';

// ============================================================
// Types
// ============================================================

export interface MarketPrice {
  symbol: string;
  name: string;
  assetType: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  high24h: number;
  low24h: number;
  _realData: boolean;
}

// ============================================================
// Memory cache with per-source TTL
// ============================================================

const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL = {
  crypto: 30_000,   // 30 seconds
  forex: 60_000,    // 60 seconds
  metals: 60_000,   // 60 seconds
  stocks: 300_000,  // 5 minutes
  indices: 300_000, // 5 minutes
};

function getCached<T>(key: string, ttl: number): T | null {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < ttl) return entry.data as T;
  cache.delete(key);
  return null;
}

function setCache(key: string, data: unknown) {
  cache.set(key, { data, ts: Date.now() });
}

// ============================================================
// Symbol mappings
// ============================================================

const COINGECKO_IDS: Record<string, string> = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', BNB: 'binancecoin',
  XRP: 'ripple', DOGE: 'dogecoin', ADA: 'cardano', AVAX: 'avalanche-2',
  DOT: 'polkadot', LINK: 'chainlink', MATIC: 'matic-network',
  UNI: 'uniswap', ATOM: 'cosmos', NEAR: 'near', APT: 'aptos',
  ARB: 'arbitrum', OP: 'optimism', PEPE: 'pepe', SHIB: 'shiba-inu',
  TON: 'the-open-network',
};

// Forex: internal symbol -> currency code to look up
const FOREX_MAP: Record<string, { base: string; quote: string; invert?: boolean }> = {
  EURUSD: { base: 'EUR', quote: 'USD' },
  GBPUSD: { base: 'GBP', quote: 'USD' },
  USDJPY: { base: 'JPY', quote: 'USD', invert: true },
  AUDUSD: { base: 'AUD', quote: 'USD' },
  USDCAD: { base: 'CAD', quote: 'USD', invert: true },
  NZDUSD: { base: 'NZD', quote: 'USD' },
  USDCHF: { base: 'CHF', quote: 'USD', invert: true },
  EURGBP: { base: 'GBP', quote: 'EUR', invert: true },
  EURJPY: { base: 'JPY', quote: 'EUR', invert: true },
  GBPJPY: { base: 'JPY', quote: 'GBP', invert: true },
};

const STOCK_SYMBOLS = [
  'AAPL', 'GOOGL', 'MSFT', 'AMZN', 'NVDA', 'TSLA', 'META', 'NFLX', 'AMD', 'INTC',
  'CRM', 'ORCL', 'JPM', 'V', 'WMT', 'DIS', 'BA', 'PYPL', 'UBER', 'COIN',
];
const INDEX_SYMBOLS = ['US30', 'NAS100', 'SPX500', 'FTSE100', 'DAX40'];

// Finnhub uses different ticker formats
const FINNHUB_MAP: Record<string, string> = {
  US30: '.DJI',
  NAS100: '.NDX',
  SPX500: '.INX',
  FTSE100: '.FTSE',
  DAX40: '.GDAXI',
};

// ============================================================
// 1. Crypto — CoinGecko Free API (no key)
// ============================================================

interface CoinGeckoMarket {
  symbol: string;
  current_price: number;
  price_change_24h: number;
  price_change_percentage_24h: number;
  total_volume: number;
  high_24h: number;
  low_24h: number;
}

export async function fetchCryptoPrices(): Promise<Map<string, MarketPrice>> {
  const cacheKey = 'market_data_crypto';
  const cached = getCached<Map<string, MarketPrice>>(cacheKey, CACHE_TTL.crypto);
  if (cached) return cached;

  const result = new Map<string, MarketPrice>();

  try {
    const url =
      'https://api.coingecko.com/api/v3/coins/markets' +
      '?vs_currency=usd&order=market_cap_desc&per_page=30&page=1' +
      '&sparkline=false&price_change_percentage=24h';
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
    const data: CoinGeckoMarket[] = await res.json();

    for (const coin of data) {
      const sym = coin.symbol?.toUpperCase();
      if (sym && COINGECKO_IDS[sym]) {
        result.set(sym, {
          symbol: sym,
          name: SYMBOL_NAMES[sym] || sym,
          assetType: 'crypto',
          price: coin.current_price,
          change: coin.price_change_24h ?? 0,
          changePercent: coin.price_change_percentage_24h ?? 0,
          volume: coin.total_volume ?? 0,
          high24h: coin.high_24h ?? coin.current_price * 1.02,
          low24h: coin.low_24h ?? coin.current_price * 0.98,
          _realData: true,
        });
      }
    }

    if (result.size > 0) {
      console.log(`[market-data] CoinGecko: ${result.size} real crypto prices`);
      setCache(cacheKey, result);
    }
  } catch (err) {
    console.warn('[market-data] CoinGecko failed, using demo:', err instanceof Error ? err.message : err);
  }

  return result;
}

// ============================================================
// 2. Forex — ExchangeRate-API (free, no key)
// ============================================================

export async function fetchForexPrices(): Promise<Map<string, MarketPrice>> {
  const cacheKey = 'market_data_forex';
  const cached = getCached<Map<string, MarketPrice>>(cacheKey, CACHE_TTL.forex);
  if (cached) return cached;

  const result = new Map<string, MarketPrice>();

  try {
    const url = 'https://open.er-api.com/v6/latest/USD';
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`ExchangeRate-API HTTP ${res.status}`);
    const data = await res.json();
    const rates: Record<string, number> = data?.rates;
    if (!rates) throw new Error('No rates in response');

    // Build price data for each forex pair
    for (const [symbol, mapping] of Object.entries(FOREX_MAP)) {
      let price: number;
      if (mapping.invert) {
        // USDJPY: API gives JPY per USD, which is what we want (e.g., 154.5)
        price = rates[mapping.base] ?? BASE_PRICES[symbol] ?? 0;
      } else {
        // EURUSD: API gives EUR per USD, we want USD per EUR, so invert
        const rate = rates[mapping.base];
        price = rate && rate > 0 ? 1 / rate : (BASE_PRICES[symbol] ?? 0);
      }
      if (price > 0) {
        result.set(symbol, {
          symbol,
          name: SYMBOL_NAMES[symbol] || symbol,
          assetType: 'forex',
          price,
          change: 0,
          changePercent: 0,
          volume: 0,
          high24h: price * 1.005,
          low24h: price * 0.995,
          _realData: true,
        });
      }
    }

    if (result.size > 0) {
      console.log(`[market-data] ExchangeRate-API: ${result.size} real forex prices`);
      setCache(cacheKey, result);
    }
  } catch (err) {
    console.warn('[market-data] ExchangeRate-API failed, using demo:', err instanceof Error ? err.message : err);
  }

  return result;
}

// ============================================================
// 3. Metals/Commodities — metals.live API (free, no key)
// ============================================================

interface MetalsLiveSpot {
 metal: string;
  price: number;
  prev_close: number;
  change: number;
  change_percent: number;
  updated: string;
}

export async function fetchMetalPrices(): Promise<Map<string, MarketPrice>> {
  const cacheKey = 'market_data_metals';
  const cached = getCached<Map<string, MarketPrice>>(cacheKey, CACHE_TTL.metals);
  if (cached) return cached;

  const result = new Map<string, MarketPrice>();

  try {
    const url = 'https://api.metals.live/v1/spot';
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`metals.live HTTP ${res.status}`);
    const data: MetalsLiveSpot[] = await res.json();

    if (!Array.isArray(data)) throw new Error('Invalid response format');

    // metals.live returns prices per troy ounce for gold, per troy ounce for silver
    for (const item of data) {
      const metal = item.metal?.toLowerCase();
      if (metal === 'gold') {
        result.set('XAUUSD', {
          symbol: 'XAUUSD',
          name: 'Gold',
          assetType: 'commodity',
          price: item.price,
          change: item.change ?? 0,
          changePercent: item.change_percent ?? 0,
          volume: 0,
          high24h: item.price * 1.01,
          low24h: item.price * 0.99,
          _realData: true,
        });
      } else if (metal === 'silver') {
        result.set('XAGUSD', {
          symbol: 'XAGUSD',
          name: 'Silver',
          assetType: 'commodity',
          price: item.price,
          change: item.change ?? 0,
          changePercent: item.change_percent ?? 0,
          volume: 0,
          high24h: item.price * 1.01,
          low24h: item.price * 0.99,
          _realData: true,
        });
      }
    }

    if (result.size > 0) {
      console.log(`[market-data] metals.live: ${result.size} real metal prices`);
      setCache(cacheKey, result);
    }
  } catch (err) {
    console.warn('[market-data] metals.live failed, using demo:', err instanceof Error ? err.message : err);
  }

  return result;
}

// ============================================================
// 4. Stocks & Indices — Finnhub Free API (requires FINNHUB_API_KEY)
// ============================================================

interface FinnhubQuote {
  c: number;  // Current price
  h: number;  // High price of the day
  l: number;  // Low price of the day
   o: number;  // Open price of the day
   pc: number; // Previous close price
}

export async function fetchStockPrices(): Promise<Map<string, MarketPrice>> {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) {
    console.log('[market-data] Finnhub: no FINNHUB_API_KEY, stocks use demo data');
    return new Map();
  }

  const cacheKey = 'market_data_stocks';
  const cached = getCached<Map<string, MarketPrice>>(cacheKey, CACHE_TTL.stocks);
  if (cached) return cached;

  const result = new Map<string, MarketPrice>();

  // Fetch in parallel with concurrency limit (Finnhub free: 60 calls/min)
  const allTickers = [...STOCK_SYMBOLS, ...INDEX_SYMBOLS];
  const batchSize = 5;

  for (let i = 0; i < allTickers.length; i += batchSize) {
    const batch = allTickers.slice(i, i + batchSize);
    const promises = batch.map(async (sym) => {
      const finnhubSym = FINNHUB_MAP[sym] || sym;
      try {
        const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(finnhubSym)}&token=${apiKey}`;
        const res = await fetch(url, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(8_000),
        });
        if (!res.ok) throw new Error(`Finnhub HTTP ${res.status} for ${sym}`);
        const q: FinnhubQuote = await res.json();

        if (q.c > 0) {
          const change = q.c - q.pc;
          const changePercent = q.pc > 0 ? (change / q.pc) * 100 : 0;
          const assetType = INDEX_SYMBOLS.includes(sym) ? 'index' : 'stock';
          return {
            symbol: sym,
            name: SYMBOL_NAMES[sym] || sym,
            assetType,
            price: q.c,
            change,
            changePercent,
            volume: 0,
            high24h: q.h || q.c * 1.01,
            low24h: q.l || q.c * 0.99,
            _realData: true,
          } as MarketPrice;
        }
      } catch (err) {
        console.warn(`[market-data] Finnhub failed for ${sym}:`, err instanceof Error ? err.message : err);
      }
      return null;
    });

    const results = await Promise.all(promises);
    for (const r of results) {
      if (r) result.set(r.symbol, r);
    }

    // Rate-limit between batches (Finnhub free tier)
    if (i + batchSize < allTickers.length) {
      await new Promise(resolve => setTimeout(resolve, 1100));
    }
  }

  if (result.size > 0) {
    console.log(`[market-data] Finnhub: ${result.size} real stock/index prices`);
    setCache(cacheKey, result);
  }

  return result;
}

// ============================================================
// Unified: fetch all real prices in parallel
// ============================================================

export async function fetchAllRealPrices(): Promise<Map<string, MarketPrice>> {
  const [crypto, forex, metals, stocks] = await Promise.all([
    fetchCryptoPrices(),
    fetchForexPrices(),
    fetchMetalPrices(),
    fetchStockPrices(),
  ]);

  const all = new Map<string, MarketPrice>();
  for (const map of [crypto, forex, metals, stocks]) {
    for (const [sym, data] of map) {
      all.set(sym, data);
    }
  }

  return all;
}

// ============================================================
// Get single symbol price (real > demo fallback)
// ============================================================

export async function getSinglePrice(symbol: string): Promise<MarketPrice> {
  // Determine which source to query
  if (COINGECKO_IDS[symbol]) {
    const crypto = await fetchCryptoPrices();
    const real = crypto.get(symbol);
    if (real) return real;
  }

  if (FOREX_MAP[symbol]) {
    const forex = await fetchForexPrices();
    const real = forex.get(symbol);
    if (real) return real;
  }

  if (['XAUUSD', 'XAGUSD'].includes(symbol)) {
    const metals = await fetchMetalPrices();
    const real = metals.get(symbol);
    if (real) return real;
  }

  if (STOCK_SYMBOLS.includes(symbol) || INDEX_SYMBOLS.includes(symbol)) {
    const stocks = await fetchStockPrices();
    const real = stocks.get(symbol);
    if (real) return real;
  }

  // Demo fallback
  const price = getDemoPrice(symbol);
  return {
    symbol,
    name: SYMBOL_NAMES[symbol] || symbol,
    assetType: getAssetType(symbol),
    price,
    change: 0,
    changePercent: 0,
    volume: 0,
    high24h: price * 1.02,
    low24h: price * 0.98,
    _realData: false,
  };
}
