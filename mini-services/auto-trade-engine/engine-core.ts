// ============================================================
// engine-core.ts — Startup-free core module for auto-trade-engine
// Phase 2B: verified market data only for trading decisions.
// ============================================================

import { type CandleData } from './strategies';
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

export interface FetchMarketPriceDeps {
  nextjsApi: string;
  fetchFn?: typeof fetch;
}

export interface FetchCandlesDeps {
  nextjsApi: string;
  fetchFn?: typeof fetch;
}

export interface EnginePriceResult {
  price: number;
  isDemoData: boolean;
  environment: 'live' | 'demo' | 'unknown';
  source: string;
  observedAt: string;
  dataUnavailable?: boolean;
  reason?: string;
}

export interface EngineCandlesResult {
  candles: CandleData[];
  provenance: {
    environment: 'live' | 'demo' | 'unknown';
    isSynthetic: boolean;
    source: string;
    observedAt: string;
  };
  dataUnavailable?: boolean;
  reason?: string;
  volumeAvailable?: boolean;
}

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

export { evaluateEngineAccountEligibility, type EngineAccountDescriptor, type EligibilityResult } from '../../src/lib/engine-eligibility';

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

function isCryptoSymbol(symbol: string): boolean {
  return symbol.toUpperCase() in COINGECKO_IDS;
}

// Explicit demo helper retained for isolated demo tooling/tests only.
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

function unavailablePrice(reason: string): EnginePriceResult {
  return {
    price: 0,
    isDemoData: false,
    environment: 'unknown',
    source: 'no-verified-provider',
    observedAt: new Date().toISOString(),
    dataUnavailable: true,
    reason,
  };
}

export async function fetchMarketPrice(
  symbol: string,
  deps: FetchMarketPriceDeps,
): Promise<EnginePriceResult> {
  const fetchFn = deps.fetchFn || fetch;
  try {
    const res = await fetchFn(
      `${deps.nextjsApi}/api/trading/market/symbols?symbol=${encodeURIComponent(symbol)}`,
      { signal: AbortSignal.timeout(5000) } as RequestInit,
    );
    if (!res.ok) return unavailablePrice(`MARKET_DATA_UNAVAILABLE_HTTP_${res.status}`);

    const data = await res.json() as Record<string, unknown>;
    const parsed = parseSinglePriceResponse(res.headers, data);
    if (!parsed || parsed.price <= 0) return unavailablePrice('MARKET_DATA_INVALID_PRICE');

    const validation = validateEngineProvenance(parsed);
    if (!validation.valid || parsed.environment !== 'live' || parsed.isSynthetic) {
      return unavailablePrice(`MARKET_DATA_PROVENANCE_REJECTED:${validation.reason ?? 'not-live'}`);
    }

    return {
      price: parsed.price,
      isDemoData: false,
      environment: 'live',
      source: parsed.source,
      observedAt: parsed.observedAt!,
    };
  } catch (error) {
    return unavailablePrice(error instanceof Error ? error.message : 'MARKET_DATA_UNAVAILABLE');
  }
}

// Isolated diagnostic helper only. Production fetchCandles() never calls it.
export async function fetchCoinGeckoOHLC(
  symbol: string,
  limit: number,
  fetchFn?: typeof fetch,
): Promise<{ candles: CandleData[]; observedAt: string } | null> {
  const coinId = COINGECKO_IDS[symbol.toUpperCase()];
  if (!coinId) return null;
  const fn = fetchFn || fetch;
  try {
    const url = `https://api.coingecko.com/api/v3/coins/${coinId}/ohlc?vs_currency=usd&days=30`;
    const res = await fn(url, { signal: AbortSignal.timeout(8000) } as RequestInit);
    if (!res.ok) return null;
    const raw = (await res.json()) as number[][];
    if (!Array.isArray(raw) || raw.length === 0) return null;
    const candles: CandleData[] = raw.slice(-limit).map((c) => ({
      timestamp: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: 0,
    }));
    const latestTs = candles[candles.length - 1]?.timestamp;
    if (!latestTs) return null;
    return { candles, observedAt: new Date(latestTs).toISOString() };
  } catch {
    return null;
  }
}

export async function fetchNextJSCandles(
  symbol: string,
  limit: number,
  nextjsApi: string,
  fetchFn?: typeof fetch,
): Promise<EngineCandlesResult | null> {
  const fn = fetchFn || fetch;
  try {
    const url = `${nextjsApi}/api/trading/market/symbols?symbol=${encodeURIComponent(symbol)}&timeframe=4h&limit=${limit}`;
    const res = await fn(url, { signal: AbortSignal.timeout(8000) } as RequestInit);
    if (!res.ok) return null;
    const data = await res.json() as Record<string, unknown>;
    const parsed = parseCandleResponse(res.headers, data);
    if (!parsed || parsed.candles.length === 0) return null;
    const validation = validateEngineProvenance(parsed.provenance);
    if (!validation.valid || parsed.provenance.environment !== 'live' || parsed.provenance.isSynthetic) return null;
    return {
      candles: parsed.candles,
      provenance: {
        environment: 'live',
        isSynthetic: false,
        source: parsed.provenance.source,
        observedAt: parsed.provenance.observedAt!,
      },
      volumeAvailable: data.volumeAvailable === true,
    };
  } catch {
    return null;
  }
}

export function generateDemoCandles(
  symbol: string,
  limit: number,
): { candles: CandleData[]; provenance: { environment: 'demo'; isSynthetic: true; source: string; observedAt: string } } {
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
      open: roundPrice(open), high: roundPrice(high), low: roundPrice(low), close: roundPrice(close),
      volume: Math.round(base * 1000 * (0.8 + rand * 0.4)),
    });
    price = close;
  }
  return {
    candles,
    provenance: {
      environment: 'demo', isSynthetic: true,
      source: 'fovi-demo-generator', observedAt: new Date().toISOString(),
    },
  };
}

const candleCache = new Map<string, { result: EngineCandlesResult; ts: number }>();
const CANDLE_CACHE_TTL = 45_000;

export async function fetchCandles(
  symbol: string,
  limit: number = 100,
  deps: FetchCandlesDeps,
): Promise<EngineCandlesResult> {
  const cacheKey = `${symbol}_${limit}_4h_verified`;
  const cached = candleCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CANDLE_CACHE_TTL) return cached.result;

  const verified = await fetchNextJSCandles(symbol, limit, deps.nextjsApi, deps.fetchFn);
  if (verified && verified.candles.length >= 10) {
    candleCache.set(cacheKey, { result: verified, ts: Date.now() });
    return verified;
  }

  return {
    candles: [],
    provenance: {
      environment: 'unknown',
      isSynthetic: true,
      source: 'no-verified-provider',
      observedAt: new Date().toISOString(),
    },
    dataUnavailable: true,
    reason: 'MARKET_DATA_UNAVAILABLE',
    volumeAvailable: false,
  };
}
