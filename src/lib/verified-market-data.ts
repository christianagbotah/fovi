import type { CandleData, Timeframe } from './types';
import type { Provenance } from './provenance';

export type MarketDataFailureCode =
  | 'NO_DATA'
  | 'SYNTHETIC_DATA'
  | 'STALE_DATA'
  | 'UNVERIFIED_SOURCE'
  | 'INVALID_QUOTE'
  | 'INVALID_OHLC'
  | 'INVALID_TIMESTAMP'
  | 'MISSING_OBSERVED_AT'
  | 'INSUFFICIENT_HISTORY'
  | 'TIMEFRAME_MISMATCH'
  | 'UNSUPPORTED_MARKET_DATA'
  | 'PROVIDER_UNAVAILABLE';

export interface VerifiedQuote {
  symbol: string;
  price: number;
  volume: number | null;
  changePercent24h: number | null;
}

export interface VerifiedMarketMetadata {
  source: 'coingecko';
  environment: 'live';
  isSynthetic: false;
  observedAt: string;
  receivedAt: string;
}

export type VerifiedQuoteResult =
  | { ok: true; quote: VerifiedQuote; metadata: VerifiedMarketMetadata }
  | { ok: false; code: MarketDataFailureCode; message: string };

export type VerifiedCandlesResult =
  | {
      ok: true;
      candles: CandleData[];
      metadata: VerifiedMarketMetadata & { timeframe: '4h'; volumeAvailable: false };
    }
  | { ok: false; code: MarketDataFailureCode; message: string };

export interface VerifiedMarketDataDeps {
  fetchFn?: typeof fetch;
  now?: () => number;
}

const COINGECKO_IDS: Record<string, string> = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', BNB: 'binancecoin',
  XRP: 'ripple', DOGE: 'dogecoin', ADA: 'cardano', AVAX: 'avalanche-2',
  DOT: 'polkadot', LINK: 'chainlink',
};

export const VERIFIED_CRYPTO_SYMBOLS = Object.freeze(Object.keys(COINGECKO_IDS));
export const VERIFIED_CANDLE_TIMEFRAMES = Object.freeze(['4h'] as const);

const QUOTE_MAX_AGE_MS = 2 * 60 * 1000;
const CANDLE_4H_MAX_AGE_MS = 5 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 60 * 1000;
const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
const INTERVAL_TOLERANCE = 0.20;
const CACHE_TTL_MS = 30_000;

interface CachedCandles {
  candles: CandleData[];
  observedAt: string;
  receivedAt: string;
  volumeAvailable: false;
  cachedAt: number;
}

const candleCache = new Map<string, CachedCandles>();

export function normalizeMarketSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

export function isVerifiedCryptoSymbol(symbol: string): boolean {
  return normalizeMarketSymbol(symbol) in COINGECKO_IDS;
}

export function supportsVerifiedCandles(symbol: string, timeframe: Timeframe): boolean {
  return isVerifiedCryptoSymbol(symbol) && timeframe === '4h';
}

function isoFromEpochMs(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function fail(code: MarketDataFailureCode, message: string): VerifiedQuoteResult | VerifiedCandlesResult {
  return { ok: false, code, message };
}

function validateObservedAt(observedAt: string, now: number, maxAgeMs: number): MarketDataFailureCode | null {
  const observedMs = new Date(observedAt).getTime();
  if (!Number.isFinite(observedMs) || observedMs <= 0) return 'INVALID_TIMESTAMP';
  if (observedMs > now + MAX_FUTURE_SKEW_MS) return 'INVALID_TIMESTAMP';
  if (now - observedMs > maxAgeMs) return 'STALE_DATA';
  return null;
}

export function validateCandleShape(candle: CandleData): string | null {
  const numeric = [candle.timestamp, candle.open, candle.high, candle.low, candle.close];
  if (numeric.some((v) => !Number.isFinite(v))) return 'Candle values must be finite';
  if (candle.timestamp <= 0) return 'Candle timestamp must be positive';
  if (candle.open <= 0 || candle.high <= 0 || candle.low <= 0 || candle.close <= 0) {
    return 'OHLC prices must be positive';
  }
  if (candle.high < Math.max(candle.open, candle.close)) return 'High is below open/close';
  if (candle.low > Math.min(candle.open, candle.close)) return 'Low is above open/close';
  return null;
}

export function validateCandleTimeframe(candles: CandleData[], timeframe: Timeframe): boolean {
  if (timeframe !== '4h' || candles.length < 3) return false;
  const intervals: number[] = [];
  for (let i = 1; i < candles.length; i += 1) intervals.push(candles[i].timestamp - candles[i - 1].timestamp);
  intervals.sort((a, b) => a - b);
  const median = intervals[Math.floor(intervals.length / 2)];
  const min = FOUR_HOURS_MS * (1 - INTERVAL_TOLERANCE);
  const max = FOUR_HOURS_MS * (1 + INTERVAL_TOLERANCE);
  return median >= min && median <= max;
}

export function toProvenance(metadata: VerifiedMarketMetadata): Provenance {
  return {
    environment: metadata.environment,
    isSynthetic: metadata.isSynthetic,
    source: metadata.source,
    observedAt: metadata.observedAt,
  };
}

export async function getVerifiedQuote(
  rawSymbol: string,
  deps: VerifiedMarketDataDeps = {},
): Promise<VerifiedQuoteResult> {
  const symbol = normalizeMarketSymbol(rawSymbol);
  const coinId = COINGECKO_IDS[symbol];
  if (!coinId) return fail('UNSUPPORTED_MARKET_DATA', `No verified quote provider for ${symbol}`) as VerifiedQuoteResult;

  const fetchFn = deps.fetchFn ?? fetch;
  const now = (deps.now ?? Date.now)();

  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coinId)}&vs_currencies=usd&include_24hr_vol=true&include_24hr_change=true&include_last_updated_at=true`;
    const res = await fetchFn(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
    } as RequestInit);
    if (!res.ok) return fail('PROVIDER_UNAVAILABLE', `CoinGecko quote HTTP ${res.status}`) as VerifiedQuoteResult;

    const body = await res.json() as Record<string, {
      usd?: number;
      usd_24h_vol?: number;
      usd_24h_change?: number;
      last_updated_at?: number;
    }>;
    const row = body[coinId];
    if (!row || !Number.isFinite(row.usd) || (row.usd ?? 0) <= 0) {
      return fail('INVALID_QUOTE', `CoinGecko returned an invalid price for ${symbol}`) as VerifiedQuoteResult;
    }
    if (!Number.isFinite(row.last_updated_at)) {
      return fail('MISSING_OBSERVED_AT', `CoinGecko did not provide last_updated_at for ${symbol}`) as VerifiedQuoteResult;
    }

    const observedAt = isoFromEpochMs((row.last_updated_at as number) * 1000);
    if (!observedAt) return fail('INVALID_TIMESTAMP', `Invalid quote timestamp for ${symbol}`) as VerifiedQuoteResult;
    const timestampFailure = validateObservedAt(observedAt, now, QUOTE_MAX_AGE_MS);
    if (timestampFailure) return fail(timestampFailure, `Quote for ${symbol} is not fresh and tradeable`) as VerifiedQuoteResult;

    const metadata: VerifiedMarketMetadata = {
      source: 'coingecko',
      environment: 'live',
      isSynthetic: false,
      observedAt,
      receivedAt: new Date(now).toISOString(),
    };
    return {
      ok: true,
      quote: {
        symbol,
        price: row.usd as number,
        volume: Number.isFinite(row.usd_24h_vol) ? (row.usd_24h_vol as number) : null,
        changePercent24h: Number.isFinite(row.usd_24h_change) ? (row.usd_24h_change as number) : null,
      },
      metadata,
    };
  } catch (error) {
    return fail('PROVIDER_UNAVAILABLE', error instanceof Error ? error.message : 'CoinGecko quote unavailable') as VerifiedQuoteResult;
  }
}

export async function getVerifiedCandles(
  rawSymbol: string,
  timeframe: Timeframe,
  limit = 100,
  deps: VerifiedMarketDataDeps = {},
): Promise<VerifiedCandlesResult> {
  const symbol = normalizeMarketSymbol(rawSymbol);
  const coinId = COINGECKO_IDS[symbol];
  if (!coinId || timeframe !== '4h') {
    return fail('UNSUPPORTED_MARKET_DATA', `Verified ${timeframe} candles are unavailable for ${symbol}`) as VerifiedCandlesResult;
  }

  const now = (deps.now ?? Date.now)();
  const cacheKey = `${symbol}:4h:${Math.max(1, limit)}`;
  const cached = candleCache.get(cacheKey);
  if (cached && now - cached.cachedAt <= CACHE_TTL_MS) {
    const freshnessFailure = validateObservedAt(cached.observedAt, now, CANDLE_4H_MAX_AGE_MS);
    if (!freshnessFailure) {
      return {
        ok: true,
        candles: cached.candles.map((c) => ({ ...c })),
        metadata: {
          source: 'coingecko', environment: 'live', isSynthetic: false,
          observedAt: cached.observedAt, receivedAt: cached.receivedAt,
          timeframe: '4h', volumeAvailable: false,
        },
      };
    }
    candleCache.delete(cacheKey);
  }

  const fetchFn = deps.fetchFn ?? fetch;
  try {
    const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(coinId)}/ohlc?vs_currency=usd&days=30`;
    const res = await fetchFn(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    } as RequestInit);
    if (!res.ok) return fail('PROVIDER_UNAVAILABLE', `CoinGecko OHLC HTTP ${res.status}`) as VerifiedCandlesResult;

    const raw = await res.json() as number[][];
    if (!Array.isArray(raw) || raw.length === 0) {
      return fail('NO_DATA', `CoinGecko returned no candles for ${symbol}`) as VerifiedCandlesResult;
    }

    const all: CandleData[] = [];
    for (const row of raw) {
      if (!Array.isArray(row) || row.length < 5) {
        return fail('INVALID_OHLC', `Malformed OHLC row returned for ${symbol}`) as VerifiedCandlesResult;
      }
      const candle: CandleData = {
        timestamp: Number(row[0]),
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volume: 0,
      };
      const shapeError = validateCandleShape(candle);
      if (shapeError) return fail('INVALID_OHLC', `${shapeError} for ${symbol}`) as VerifiedCandlesResult;
      all.push(candle);
    }

    if (all.length < 35) {
      return fail('INSUFFICIENT_HISTORY', `Only ${all.length} candles available for ${symbol}`) as VerifiedCandlesResult;
    }

    for (let i = 1; i < all.length; i += 1) {
      if (all[i].timestamp <= all[i - 1].timestamp) {
        return fail('INVALID_OHLC', `Candle timestamps are not strictly increasing for ${symbol}`) as VerifiedCandlesResult;
      }
    }
    if (!validateCandleTimeframe(all, timeframe)) {
      return fail('TIMEFRAME_MISMATCH', `Provider candle spacing does not match ${timeframe}`) as VerifiedCandlesResult;
    }

    const observedAt = isoFromEpochMs(all[all.length - 1].timestamp);
    if (!observedAt) return fail('INVALID_TIMESTAMP', `Invalid latest candle timestamp for ${symbol}`) as VerifiedCandlesResult;
    const freshnessFailure = validateObservedAt(observedAt, now, CANDLE_4H_MAX_AGE_MS);
    if (freshnessFailure) return fail(freshnessFailure, `Latest ${symbol} candle is not fresh`) as VerifiedCandlesResult;

    const receivedAt = new Date(now).toISOString();
    const candles = all.slice(-Math.max(1, Math.min(limit, all.length)));
    candleCache.set(cacheKey, {
      candles: candles.map((c) => ({ ...c })), observedAt, receivedAt,
      volumeAvailable: false, cachedAt: now,
    });

    return {
      ok: true,
      candles,
      metadata: {
        source: 'coingecko', environment: 'live', isSynthetic: false,
        observedAt, receivedAt, timeframe: '4h', volumeAvailable: false,
      },
    };
  } catch (error) {
    return fail('PROVIDER_UNAVAILABLE', error instanceof Error ? error.message : 'CoinGecko candles unavailable') as VerifiedCandlesResult;
  }
}

export function clearVerifiedMarketDataCacheForTests(): void {
  candleCache.clear();
}
