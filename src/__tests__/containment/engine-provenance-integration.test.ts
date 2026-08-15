// ============================================================
// engine-provenance-integration.test.ts — CR4.1
// Tests the engine's market-provenance.ts module directly.
// These are pure functions — no mocking of the module itself.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseResponseProvenance,
  parseSinglePriceResponse,
  parseCandleResponse,
  validateEngineProvenance,
} from '../../../mini-services/auto-trade-engine/market-provenance';

describe('parseSinglePriceResponse — provenance parsing', () => {
  it('demo headers → environment=demo, isSynthetic=true', () => {
    const headers = new Headers({
      'x-environment': 'demo',
      'x-synthetic': 'true',
      'x-data-source': 'fovi-demo-generator',
    });
    const body = {
      price: 67500,
      environment: 'demo',
      isSynthetic: true,
      source: 'fovi-demo-generator',
    };
    const result = parseSinglePriceResponse(headers, body);
    expect(result).not.toBeNull();
    expect(result!.environment).toBe('demo');
    expect(result!.isSynthetic).toBe(true);
    expect(result!.source).toBe('fovi-demo-generator');
  });

  it('live headers → environment=live', () => {
    const headers = new Headers({
      'x-environment': 'live',
      'x-synthetic': 'false',
      'x-data-source': 'exchange',
    });
    const body = {
      price: 42000,
      environment: 'live',
      isSynthetic: false,
      source: 'exchange',
    };
    const result = parseSinglePriceResponse(headers, body);
    expect(result).not.toBeNull();
    expect(result!.environment).toBe('live');
    expect(result!.isSynthetic).toBe(false);
  });

  it('missing provenance → returns result with environment=unknown', () => {
    const headers = new Headers();
    const body = { price: 42000 };
    const result = parseSinglePriceResponse(headers, body);
    // parseSinglePriceResponse only returns null for invalid price (<=0 or non-number).
    // Valid price with unknown provenance still returns the PriceWithProvenance object.
    expect(result).not.toBeNull();
    expect(result!.price).toBe(42000);
    expect(result!.environment).toBe('unknown');
    expect(result!.source).toBe('missing');
  });
});

describe('parseSinglePriceResponse — mismatched provenance', () => {
  it('mismatched header/body → environment=unknown', () => {
    const headers = new Headers({ 'x-environment': 'live' });
    const body = {
      price: 42000,
      environment: 'demo',
      isSynthetic: true,
      source: 'fovi-demo-generator',
    };
    const result = parseSinglePriceResponse(headers, body);
    expect(result).not.toBeNull();
    expect(result!.environment).toBe('unknown');
    expect(result!.source).toBe('mismatch');
  });
});

describe('parseCandleResponse — provenance parsing', () => {
  const sampleCandles = [
    { timestamp: 1000, open: 100, high: 110, low: 95, close: 105, volume: 1000 },
    { timestamp: 2000, open: 105, high: 115, low: 100, close: 110, volume: 1200 },
  ];

  it('valid live candles with provenance → returns candles', () => {
    const headers = new Headers({
      'x-environment': 'live',
      'x-synthetic': 'false',
      'x-data-source': 'exchange',
    });
    const body = {
      candles: sampleCandles,
      environment: 'live',
      isSynthetic: false,
      source: 'exchange',
    };
    const result = parseCandleResponse(headers, body);
    expect(result).not.toBeNull();
    expect(result!.candles).toHaveLength(2);
    expect(result!.provenance.environment).toBe('live');
    expect(result!.provenance.isSynthetic).toBe(false);
  });

  it('demo candles → returns candles with environment=demo', () => {
    const headers = new Headers({
      'x-environment': 'demo',
      'x-synthetic': 'true',
      'x-data-source': 'fovi-demo-generator',
    });
    const body = {
      candles: sampleCandles,
      environment: 'demo',
      isSynthetic: true,
      source: 'fovi-demo-generator',
    };
    const result = parseCandleResponse(headers, body);
    expect(result).not.toBeNull();
    expect(result!.candles).toHaveLength(2);
    expect(result!.provenance.environment).toBe('demo');
    expect(result!.provenance.isSynthetic).toBe(true);
  });

  it('missing provenance on candle body → returns candles with environment=unknown', () => {
    const headers = new Headers();
    const body = { candles: sampleCandles };
    const result = parseCandleResponse(headers, body);
    expect(result).not.toBeNull();
    expect(result!.candles).toHaveLength(2);
    expect(result!.provenance.environment).toBe('unknown');
    expect(result!.provenance.source).toBe('missing');
  });
});

describe('validateEngineProvenance — engine-level validation', () => {
  it('rejects unknown provenance', () => {
    const result = validateEngineProvenance({
      environment: 'unknown',
      isSynthetic: true,
      source: 'missing',
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('unknown');
  });

  it('accepts valid live provenance (positive control)', () => {
    const result = validateEngineProvenance({
      environment: 'live',
      isSynthetic: false,
      source: 'broker-api',
    });
    expect(result.valid).toBe(true);
  });

  it('accepts valid demo provenance (positive control)', () => {
    const result = validateEngineProvenance({
      environment: 'demo',
      isSynthetic: true,
      source: 'fovi-demo-generator',
    });
    expect(result.valid).toBe(true);
  });

  it('rejects demo + non-synthetic (malformed)', () => {
    const result = validateEngineProvenance({
      environment: 'demo',
      isSynthetic: false,
      source: 'test',
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('synthetic');
  });

  it('rejects live + synthetic (malformed)', () => {
    const result = validateEngineProvenance({
      environment: 'live',
      isSynthetic: true,
      source: 'test',
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('synthetic');
  });
});
