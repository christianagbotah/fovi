import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearVerifiedMarketDataCacheForTests,
  getVerifiedCandles,
  getVerifiedQuote,
  supportsVerifiedCandles,
  validateCandleTimeframe,
} from '@/lib/verified-market-data';
import type { CandleData } from '@/lib/types';

const NOW = Date.UTC(2026, 7, 31, 4, 0, 0);

function make4hCandles(count = 40, latestTs = NOW - 30 * 60 * 1000): number[][] {
  const interval = 4 * 60 * 60 * 1000;
  return Array.from({ length: count }, (_, i) => {
    const ts = latestTs - (count - 1 - i) * interval;
    const open = 67000 + i * 10;
    const close = open + 5;
    return [ts, open, open + 20, open - 20, close];
  });
}

describe('verified market data', () => {
  beforeEach(() => clearVerifiedMarketDataCacheForTests());

  it('uses CoinGecko last_updated_at as quote observedAt', async () => {
    const observedSec = Math.floor((NOW - 30_000) / 1000);
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      bitcoin: { usd: 68000, usd_24h_vol: 1_000_000, usd_24h_change: 1.2, last_updated_at: observedSec },
    }), { status: 200 }));

    const result = await getVerifiedQuote(' btc ', { fetchFn: fetchFn as unknown as typeof fetch, now: () => NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.quote.symbol).toBe('BTC');
    expect(result.metadata.observedAt).toBe(new Date(observedSec * 1000).toISOString());
    expect(result.metadata.receivedAt).toBe(new Date(NOW).toISOString());
  });

  it('rejects stale quote timestamps', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      bitcoin: { usd: 68000, last_updated_at: Math.floor((NOW - 10 * 60 * 1000) / 1000) },
    }), { status: 200 }));
    const result = await getVerifiedQuote('BTC', { fetchFn: fetchFn as unknown as typeof fetch, now: () => NOW });
    expect(result).toMatchObject({ ok: false, code: 'STALE_DATA' });
  });

  it('rejects a quote without provider observedAt', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ bitcoin: { usd: 68000 } }), { status: 200 }));
    const result = await getVerifiedQuote('BTC', { fetchFn: fetchFn as unknown as typeof fetch, now: () => NOW });
    expect(result).toMatchObject({ ok: false, code: 'MISSING_OBSERVED_AT' });
  });

  it('supports verified crypto candles only at 4h in Phase 2B', () => {
    expect(supportsVerifiedCandles('btc', '4h')).toBe(true);
    expect(supportsVerifiedCandles('BTC', '1h')).toBe(false);
    expect(supportsVerifiedCandles('AAPL', '4h')).toBe(false);
  });

  it('uses latest candle timestamp as observedAt', async () => {
    const raw = make4hCandles();
    const latest = raw[raw.length - 1][0];
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(raw), { status: 200 }));
    const result = await getVerifiedCandles('BTC', '4h', 40, { fetchFn: fetchFn as unknown as typeof fetch, now: () => NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.metadata.observedAt).toBe(new Date(latest).toISOString());
    expect(result.metadata.receivedAt).toBe(new Date(NOW).toISOString());
    expect(result.metadata.volumeAvailable).toBe(false);
  });

  it('rejects stale candle series even when fetched now', async () => {
    const raw = make4hCandles(40, NOW - 8 * 60 * 60 * 1000);
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(raw), { status: 200 }));
    const result = await getVerifiedCandles('BTC', '4h', 40, { fetchFn: fetchFn as unknown as typeof fetch, now: () => NOW });
    expect(result).toMatchObject({ ok: false, code: 'STALE_DATA' });
  });

  it('rejects timeframe mismatch', async () => {
    const interval = 30 * 60 * 1000;
    const raw = Array.from({ length: 40 }, (_, i) => {
      const ts = NOW - (39 - i) * interval;
      return [ts, 100 + i, 102 + i, 99 + i, 101 + i];
    });
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(raw), { status: 200 }));
    const result = await getVerifiedCandles('BTC', '4h', 40, { fetchFn: fetchFn as unknown as typeof fetch, now: () => NOW });
    expect(result).toMatchObject({ ok: false, code: 'TIMEFRAME_MISMATCH' });
  });

  it('cache hit preserves correct candle-array shape and avoids refetch', async () => {
    const raw = make4hCandles();
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(raw), { status: 200 }));
    const deps = { fetchFn: fetchFn as unknown as typeof fetch, now: () => NOW };
    const first = await getVerifiedCandles('ETH', '4h', 40, deps);
    const second = await getVerifiedCandles('ETH', '4h', 40, deps);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    if (second.ok) {
      expect(Array.isArray(second.candles)).toBe(true);
      expect(second.candles[0]).toEqual(expect.objectContaining({ open: expect.any(Number), close: expect.any(Number) }));
    }
  });

  it('unknown volume is not represented as provider-verified volume', async () => {
    const raw = make4hCandles();
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(raw), { status: 200 }));
    const result = await getVerifiedCandles('SOL', '4h', 40, { fetchFn: fetchFn as unknown as typeof fetch, now: () => NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.metadata.volumeAvailable).toBe(false);
    expect(result.candles.every((c) => c.volume === 0)).toBe(true);
  });

  it('validates actual 4h candle spacing', () => {
    const candles: CandleData[] = make4hCandles().map((r) => ({
      timestamp: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: 0,
    }));
    expect(validateCandleTimeframe(candles, '4h')).toBe(true);
  });
});
