import { describe, it, expect, vi } from 'vitest';
import {
  fetchCandles,
  fetchNextJSCandles,
  fetchCoinGeckoOHLC,
  generateDemoCandles,
  fetchMarketPrice,
} from '../../../mini-services/auto-trade-engine/engine-core';
import {
  parseCandleResponse,
  validateEngineProvenance,
} from '../../../mini-services/auto-trade-engine/market-provenance';

const T1 = '2026-08-31T00:00:00.000Z';

function liveHeaders(observedAt = T1) {
  return new Headers({
    'x-environment': 'live',
    'x-synthetic': 'false',
    'x-data-source': 'coingecko',
    'x-observed-at': observedAt,
  });
}

function candleBody(count = 40, observedAt = T1) {
  return {
    candles: Array.from({ length: count }, (_, i) => ({
      timestamp: Date.now() - (count - i) * 4 * 60 * 60 * 1000,
      open: 67000 + i * 10, high: 67100 + i * 10, low: 66900 + i * 10,
      close: 67050 + i * 10, volume: 0,
    })),
    provenance: { environment: 'live', isSynthetic: false, source: 'coingecko', observedAt },
    volumeAvailable: false,
  };
}

describe('Phase 2B verified engine market-data integration', () => {
  it('parseCandleResponse preserves provider observedAt', () => {
    const parsed = parseCandleResponse(liveHeaders(), candleBody());
    expect(parsed).not.toBeNull();
    expect(parsed!.provenance.observedAt).toBe(T1);
    expect(validateEngineProvenance(parsed!.provenance).valid).toBe(true);
  });

  it('fetchNextJSCandles accepts live non-synthetic provenance', async () => {
    const body = candleBody();
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: liveHeaders() }));
    const result = await fetchNextJSCandles('BTC', 40, 'http://test.local', fetchFn as unknown as typeof fetch);
    expect(result).not.toBeNull();
    expect(result!.provenance.environment).toBe('live');
    expect(result!.provenance.isSynthetic).toBe(false);
    expect(result!.provenance.observedAt).toBe(T1);
  });

  it('fetchCandles uses canonical Next.js endpoint only and returns live data', async () => {
    const body = candleBody();
    const fetchFn = vi.fn(async (url: string) => {
      expect(url).toContain('http://test.local/api/trading/market/symbols');
      expect(url).toContain('timeframe=4h');
      expect(url).not.toContain('coingecko.com');
      return new Response(JSON.stringify(body), { status: 200, headers: liveHeaders() });
    });
    const result = await fetchCandles('BTC', 40, { nextjsApi: 'http://test.local', fetchFn: fetchFn as unknown as typeof fetch });
    expect(result.dataUnavailable).not.toBe(true);
    expect(result.candles).toHaveLength(40);
    expect(result.provenance.environment).toBe('live');
  });

  it('fetchCandles provider failure returns unavailable, never demo fallback', async () => {
    const fetchFn = vi.fn(async () => new Response('unavailable', { status: 503 }));
    const result = await fetchCandles('AAPL', 40, { nextjsApi: 'http://test.local', fetchFn: fetchFn as unknown as typeof fetch });
    expect(result.dataUnavailable).toBe(true);
    expect(result.candles).toEqual([]);
    expect(result.provenance.environment).toBe('unknown');
    expect(result.provenance.source).toBe('no-verified-provider');
  });

  it('fetchMarketPrice accepts canonical verified price response', async () => {
    const body = { price: 67500, provenance: { environment: 'live', isSynthetic: false, source: 'coingecko', observedAt: T1 } };
    const fetchFn = vi.fn(async (url: string) => {
      expect(url).toContain('http://test.local/api/trading/market/symbols?symbol=BTC');
      expect(url).not.toContain('coingecko.com');
      return new Response(JSON.stringify(body), { status: 200, headers: liveHeaders() });
    });
    const result = await fetchMarketPrice('BTC', { nextjsApi: 'http://test.local', fetchFn: fetchFn as unknown as typeof fetch });
    expect(result.dataUnavailable).not.toBe(true);
    expect(result.environment).toBe('live');
    expect(result.isDemoData).toBe(false);
    expect(result.price).toBe(67500);
  });

  it('fetchMarketPrice rejects demo/synthetic response', async () => {
    const headers = new Headers({ 'x-environment': 'demo', 'x-synthetic': 'true', 'x-data-source': 'fovi-demo-generator', 'x-observed-at': T1 });
    const body = { price: 67500, provenance: { environment: 'demo', isSynthetic: true, source: 'fovi-demo-generator', observedAt: T1 } };
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers }));
    const result = await fetchMarketPrice('BTC', { nextjsApi: 'http://test.local', fetchFn: fetchFn as unknown as typeof fetch });
    expect(result.dataUnavailable).toBe(true);
    expect(result.price).toBe(0);
  });

  it('fetchMarketPrice transport failure returns unavailable, not demo', async () => {
    const fetchFn = vi.fn(async () => new Response('unavailable', { status: 503 }));
    const result = await fetchMarketPrice('BTC', { nextjsApi: 'http://test.local', fetchFn: fetchFn as unknown as typeof fetch });
    expect(result.dataUnavailable).toBe(true);
    expect(result.environment).toBe('unknown');
    expect(result.isDemoData).toBe(false);
    expect(result.source).toBe('no-verified-provider');
  });

  it('direct CoinGecko diagnostic helper derives observedAt from latest candle timestamp', async () => {
    const latest = Date.UTC(2026, 7, 31, 0, 0, 0);
    const raw = Array.from({ length: 10 }, (_, i) => [
      latest - (9 - i) * 4 * 60 * 60 * 1000,
      67000 + i, 67100 + i, 66900 + i, 67050 + i,
    ]);
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(raw), { status: 200 }));
    const result = await fetchCoinGeckoOHLC('BTC', 10, fetchFn as unknown as typeof fetch);
    expect(result).not.toBeNull();
    expect(result!.observedAt).toBe(new Date(latest).toISOString());
  });

  it('demo candle helper remains isolated and explicitly synthetic', () => {
    const result = generateDemoCandles('BTC', 10);
    expect(result.provenance.environment).toBe('demo');
    expect(result.provenance.isSynthetic).toBe(true);
    expect(result.provenance.source).toBe('fovi-demo-generator');
  });
});
