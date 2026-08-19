// ============================================================
// engine-core.ts — Startup-free core module for auto-trade-engine
// CR4.3A R7:
//   Pure functions and injectable deps. No Bun.serve, no global timers,
//   no process event handlers, no top-level side effects.
//   Importable without triggering any server startup.
//   isExplicitlyDemoAccount now delegates to canonical engine-eligibility.
// ============================================================

import { type CandleData, type TradeSignal } from './strategies';
import {
  parseSinglePriceResponse,
  parseCandleResponse,
  validateEngineProvenance,
} from './market-provenance';

import { evaluateEngineAccountEligibility, type EngineAccountDescriptor } from '../../src/lib/engine-eligibility';

export {
  parseResponseProvenance,
  validateEngineProvenance,
  parseSinglePriceResponse,
  parseCandleResponse,
  type PriceWithProvenance,
  type CandlesWithProvenance,
} from './market-provenance';


// ============================================================
// Types
// ============================================================

export interface FetchMarketPriceDeps {
  nextjsApi: string;
  fetchFn?: typeof fetch;
}

export interface FetchCandlesDeps {
  nextjsApi: string;
  fetchFn?: typeof fetch;
}

// ============================================================
// isExplicitlyDemoAccount — delegates to canonical engine-eligibility
// ============================================================

export function isExplicitlyDemoAccount(
  account: {
    broker: string;
    accountType: string;
    isDemo: boolean | null;
    isActive?: boolean | null;
    apiKey: string | null;
    apiSecret: string | null;
    passphrase: string | null;
  } | null,
): boolean {
  const result = evaluateEngineAccountEligibility(account ? {
    broker: account.broker,
    accountType: account.accountType,
    isDemo: account.isDemo,
    isActive: account.isActive ?? null,
    apiKey: account.apiKey,
    apiSecret: account.apiSecret,
    passphrase: account.passphrase,
  } : null);
  return result.eligible;
}

// Re-export canonical eligibility for engine modules that need it
export { evaluateEngineAccountEligibility, type EngineAccountDescriptor, type EligibilityResult } from '../../src/lib/engine-eligibility';

// ============================================================
// Market Data Constants
// ============================================================

const COINGECKO_IDS: Record<string, string> = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', BNB: 'binancecoin',
  XRP: 'ripple', DOGE: 'dogecoin', ADA: 'cardano', AVAX: 'avalanche-2',
  DOT: 'polkadot', LINK: 'chainlink',
};

const DEMO_BASE_PRICES: Record<string, number> = {
  AAPL: 195.5, GOOGL: 178.2, MSFT: 445.8, AMZN: 198.3, NVDA: 920.5,
  TSLA: 245.6, META: 530.2, NFLX: 720.1, AMD: 178.5, INTC: 32.4,
  BTC: 67500, ETH: 3520, SOL: 172.5, BNB: 595, XRP: 0.58,
  DOGE: 0.165, ADA: 0.48, AVAX: 38.2, DOT: 7.35, LINK: 17.8,
};

const ALL_SYMBOLS = Object.keys(DEMO_BASE_PRICES);

export { COINGECKO_IDS, DEMO_BASE_PRICES, ALL_SYMBOLS };

// ============================================================
// Helpers
// ============================================================

function isCryptoSymbol(symbol: string): boolean {
  return symbol.toUpperCase() in COINGECKO_IDS;
}

function getDemoPrice(symbol: string): number {
  const base = DEMO_BASE_PRICES[symbol] || 100;
  const seed = Math.sin(Date.now() / 5000 + base) * 10000;
  const rand = seed - Math.floor(seed);
  return Math.max(0.01, Math.round((base + (rand - 0.48) * 2 * 0.002 * base) * 100) / 100);
}

export { isCryptoSymbol, getDemoPrice };

function roundPrice(price: number): number {
  if (price >= 1000) return Math.round(price * 100) / 100;
  if (price >= 1) return Math.round(price * 1000) / 1000;
  if (price >= 0.01) return Math.round(price * 100000) / 100000;
  return Math.round(price * 1000000) / 1000000;
}

export { roundPrice };

// ============================================================
// fetchMarketPrice — 3-layer price fetch with provenance
// ============================================================

export async function fetchMarketPrice(
  symbol: string,
  deps: FetchMarketPriceDeps,
): Promise<{ price: number; isDemoData: boolean; environment: 'live' | 'demo' | 'unknown'; source: string; observedAt: string }> {
  const fetchFn = deps.fetchFn || fetch;

  // Layer 1: Next.js market API with provenance parsing
  try {
    const res = await fetchFn(
      `${deps.nextjsApi}/api/trading/market/symbols?symbol=${encodeURIComponent(symbol)}`,
      { signal: AbortSignal.timeout(5000) } as RequestInit,
    );
    if (res.ok) {
      const data = await res.json() as Record<string, unknown>;
      const parsed = parseSinglePriceResponse(res.headers, data);
      if (parsed && parsed.price > 0) {
        const validation = validateEngineProvenance(parsed);
        if (validation.valid) {
          return {
            price: parsed.price,
            isDemoData: parsed.environment === 'demo',
            environment: parsed.environment,
            source: parsed.source,
            observedAt: parsed.observedAt!,
          };
        }
        // Unknown/malformed/mismatched provenance — reject, fall through
        console.log(`[EngineCore] Price provenance rejected for ${symbol}: ${validation.reason}`);
      }
    }
  } catch { /* fall through */ }

  // Layer 2: CoinGecko for crypto (direct live source, no provenance headers)
  if (isCryptoSymbol(symbol)) {
    try {
      const id = COINGECKO_IDS[symbol.toUpperCase()];
      const res = await fetchFn(
        `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`,
        { signal: AbortSignal.timeout(5000) } as RequestInit,
      );
      if (res.ok) {
        const data = await res.json() as Record<string, { usd?: number }>;
        const price = data[id]?.usd;
        if (price && price > 0) {
          const observedAt = new Date().toISOString();
          return { price, isDemoData: false, environment: 'live', source: 'coingecko', observedAt };
        }
      }
    } catch { /* fall through */ }
  }

  // Layer 3: Demo price
  return { price: getDemoPrice(symbol), isDemoData: true, environment: 'demo', source: 'fovi-demo-generator', observedAt: new Date().toISOString() };
}

// ============================================================
// fetchCandles — Candle fetch with module-level cache (TTL=45s)
// ============================================================

const candleCache = new Map<string, { result: { candles: CandleData[]; provenance: { environment: 'live' | 'demo' | 'unknown'; isSynthetic: boolean; source: string; observedAt: string } }; ts: number }>();
const CANDLE_CACHE_TTL = 45_000;

export async function fetchCoinGeckoOHLC(symbol: string, limit: number, fetchFn?: typeof fetch): Promise<{ candles: CandleData[]; observedAt: string } | null> {
  const coinId = COINGECKO_IDS[symbol.toUpperCase()];
  if (!coinId) return null;
  const fn = fetchFn || fetch;

  try {
    const url = `https://api.coingecko.com/api/v3/coins/${coinId}/ohlc?vs_currency=usd&days=30`;
    const res = await fn(url, { signal: AbortSignal.timeout(8000) } as RequestInit);
    if (!res.ok) throw new Error(`CoinGecko OHLC HTTP ${res.status}`);

    const raw = (await res.json()) as number[][];
    if (!Array.isArray(raw) || raw.length === 0) return null;

    const candles: CandleData[] = raw.slice(-limit).map((c) => ({
      timestamp: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: 0,
    }));

    const observedAt = new Date().toISOString();
    console.log(`[EngineCore] Fetched ${candles.length} real OHLC candles for ${symbol} from CoinGecko`);
    return { candles, observedAt };
  } catch (err) {
    console.warn(`[EngineCore] CoinGecko OHLC failed for ${symbol}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

export async function fetchNextJSCandles(symbol: string, limit: number, nextjsApi: string, fetchFn?: typeof fetch): Promise<{ candles: CandleData[]; provenance: { environment: 'live'; isSynthetic: boolean; source: string; observedAt: string } } | null> {
  const fn = fetchFn || fetch;

  try {
    const url = `${nextjsApi}/api/trading/market/symbols?symbol=${encodeURIComponent(symbol)}&timeframe=1d&limit=${limit}`;
    const res = await fn(url, { signal: AbortSignal.timeout(8000) } as RequestInit);
    if (!res.ok) return null;

    const data = await res.json() as Record<string, unknown>;
    const parsed = parseCandleResponse(res.headers, data);
    if (!parsed || parsed.candles.length === 0) return null;

    // Validate provenance — reject unknown/malformed
    const validation = validateEngineProvenance(parsed.provenance);
    if (!validation.valid) {
      console.log(`[EngineCore] Candle provenance rejected for ${symbol}: ${validation.reason}`);
      return null;
    }

    // Only accept live candles (demo candles come from our own fallback below)
    if (parsed.provenance.environment !== 'live') {
      console.log(`[EngineCore] Next.js candles for ${symbol} are ${parsed.provenance.environment}, not live — skipping`);
      return null;
    }

    console.log(`[EngineCore] Fetched ${parsed.candles.length} live candles for ${symbol} from Next.js API`);
    return {
      candles: parsed.candles,
      provenance: {
        environment: parsed.provenance.environment as 'live',
        isSynthetic: parsed.provenance.isSynthetic,
        source: parsed.provenance.source,
        observedAt: parsed.provenance.observedAt!,
      },
    };
  } catch (err) {
    console.warn(`[EngineCore] Next.js candle fetch failed for ${symbol}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

export function generateDemoCandles(symbol: string, limit: number): { candles: CandleData[]; provenance: { environment: 'demo'; isSynthetic: true; source: string; observedAt: string } } {
  const base = DEMO_BASE_PRICES[symbol] || 100;
  const now = Date.now();
  const candles: CandleData[] = [];
  let price = base;
  const volatility = base > 1000 ? 0.015 : base > 10 ? 0.02 : 0.03;
  const minuteSeed = Math.floor(now / 60000);

  for (let i = 0; i < limit; i++) {
    const seed = Math.sin(minuteSeed + i * 1.618 + base * 0.01) * 10000;
    const rand = seed - Math.floor(seed);
    const change = (rand - 0.49) * 2 * volatility;
    const open = price;
    const close = price * (1 + change);
    const high = Math.max(open, close) * (1 + Math.abs(rand - 0.5) * volatility * 0.5);
    const low = Math.min(open, close) * (1 - Math.abs(rand - 0.5) * volatility * 0.5);

    candles.push({
      timestamp: now - (limit - i) * 86400000,
      open: roundPrice(open), high: roundPrice(high),
      low: roundPrice(low), close: roundPrice(close),
      volume: Math.round(base * 1000 * (0.8 + rand * 0.4)),
    });
    price = close;
  }

  const observedAt = new Date().toISOString();
  console.log(`[EngineCore] Generated ${candles.length} demo candles for ${symbol} (base=${base})`);
  return {
    candles,
    provenance: { environment: 'demo', isSynthetic: true, source: 'fovi-demo-generator', observedAt },
  };
}

export async function fetchCandles(
  symbol: string,
  limit: number = 100,
  deps: FetchCandlesDeps,
): Promise<{ candles: CandleData[]; provenance: { environment: 'live' | 'demo' | 'unknown'; isSynthetic: boolean; source: string; observedAt: string } }> {
  const cacheKey = `${symbol}_${limit}`;
  const cached = candleCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CANDLE_CACHE_TTL) {
    return cached.result;
  }

  const fetchFn = deps.fetchFn || fetch;

  // Try real sources: CoinGecko for crypto first, then Next.js API
  if (isCryptoSymbol(symbol)) {
    const cg = await fetchCoinGeckoOHLC(symbol, limit, fetchFn);
    if (cg && cg.candles.length >= 10) {
      const result = { candles: cg.candles, provenance: { environment: 'live' as const, isSynthetic: false, source: 'coingecko', observedAt: cg.observedAt } };
      candleCache.set(cacheKey, { result, ts: Date.now() });
      return result;
    }
  }

  const nj = await fetchNextJSCandles(symbol, limit, deps.nextjsApi, fetchFn);
  if (nj && nj.candles.length >= 10) {
    const result = { candles: nj.candles, provenance: { environment: 'live' as const, isSynthetic: false, source: 'nextjs-market-api', observedAt: nj.provenance.observedAt } };
    candleCache.set(cacheKey, { result, ts: Date.now() });
    return result;
  }

  // Demo fallback
  const demo = generateDemoCandles(symbol, limit);
  const result = { candles: demo.candles, provenance: demo.provenance };
  candleCache.set(cacheKey, { result, ts: Date.now() });
  return result;
}
