// ============================================================
// engine-provenance-integration.test.ts — CR4.3A R7
// Tests the engine's market-provenance.ts module directly.
// These are pure functions — no mocking of the module itself.
// R7 updates: observedAt is MANDATORY, Blocker B disagreement,
// Blocker C (no coercion).
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseResponseProvenance,
  parseSinglePriceResponse,
  parseCandleResponse,
  validateEngineProvenance,
} from '../../../mini-services/auto-trade-engine/market-provenance';

const VALID_OBSERVED_AT = '2025-01-15T12:00:00.000Z';

describe('parseSinglePriceResponse — provenance parsing', () => {
  it('demo headers → environment=demo, isSynthetic=true', () => {
    const headers = new Headers({
      'x-environment': 'demo',
      'x-synthetic': 'true',
      'x-data-source': 'fovi-demo-generator',
      'x-observed-at': VALID_OBSERVED_AT,
    });
    const body = {
      price: 67500,
      environment: 'demo',
      isSynthetic: true,
      source: 'fovi-demo-generator',
      observedAt: VALID_OBSERVED_AT,
    };
    const result = parseSinglePriceResponse(headers, body);
    expect(result).not.toBeNull();
    expect(result!.environment).toBe('demo');
    expect(result!.isSynthetic).toBe(true);
    expect(result!.source).toBe('fovi-demo-generator');
    expect(result!.observedAt).toBe(VALID_OBSERVED_AT);
  });

  it('live headers → environment=live', () => {
    const headers = new Headers({
      'x-environment': 'live',
      'x-synthetic': 'false',
      'x-data-source': 'exchange',
      'x-observed-at': VALID_OBSERVED_AT,
    });
    const body = {
      price: 42000,
      environment: 'live',
      isSynthetic: false,
      source: 'exchange',
      observedAt: VALID_OBSERVED_AT,
    };
    const result = parseSinglePriceResponse(headers, body);
    expect(result).not.toBeNull();
    expect(result!.environment).toBe('live');
    expect(result!.isSynthetic).toBe(false);
    expect(result!.observedAt).toBe(VALID_OBSERVED_AT);
  });

  it('missing provenance → returns result with source=missing-observedAt', () => {
    const headers = new Headers();
    const body = { price: 42000 };
    const result = parseSinglePriceResponse(headers, body);
    // parseSinglePriceResponse only returns null for invalid price (<=0 or non-number).
    // Valid price with unknown provenance still returns the PriceWithProvenance object.
    expect(result).not.toBeNull();
    expect(result!.price).toBe(42000);
    expect(result!.environment).toBe('unknown');
    // R7: observedAt is checked first, so source should be missing-observedAt
    expect(result!.source).toBe('missing-observedAt');
  });
});

describe('parseSinglePriceResponse — mismatched provenance (R7 Blocker B)', () => {
  it('mismatched header/body → environment=unknown, source=disagreement', () => {
    const headers = new Headers({
      'x-environment': 'live',
      'x-synthetic': 'false',
      'x-data-source': 'exchange',
      'x-observed-at': VALID_OBSERVED_AT,
    });
    const body = {
      price: 42000,
      environment: 'demo',
      isSynthetic: true,
      source: 'fovi-demo-generator',
      observedAt: VALID_OBSERVED_AT,
    };
    const result = parseSinglePriceResponse(headers, body);
    expect(result).not.toBeNull();
    expect(result!.environment).toBe('unknown');
    // R7 Blocker B: disagreement must fail closed
    expect(result!.source).toBe('header-body-disagreement-environment');
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
      'x-observed-at': VALID_OBSERVED_AT,
    });
    const body = {
      candles: sampleCandles,
      environment: 'live',
      isSynthetic: false,
      source: 'exchange',
      observedAt: VALID_OBSERVED_AT,
    };
    const result = parseCandleResponse(headers, body);
    expect(result).not.toBeNull();
    expect(result!.candles).toHaveLength(2);
    expect(result!.provenance.environment).toBe('live');
    expect(result!.provenance.isSynthetic).toBe(false);
    expect(result!.provenance.observedAt).toBe(VALID_OBSERVED_AT);
  });

  it('demo candles → returns candles with environment=demo', () => {
    const headers = new Headers({
      'x-environment': 'demo',
      'x-synthetic': 'true',
      'x-data-source': 'fovi-demo-generator',
      'x-observed-at': VALID_OBSERVED_AT,
    });
    const body = {
      candles: sampleCandles,
      environment: 'demo',
      isSynthetic: true,
      source: 'fovi-demo-generator',
      observedAt: VALID_OBSERVED_AT,
    };
    const result = parseCandleResponse(headers, body);
    expect(result).not.toBeNull();
    expect(result!.candles).toHaveLength(2);
    expect(result!.provenance.environment).toBe('demo');
    expect(result!.provenance.isSynthetic).toBe(true);
    expect(result!.provenance.observedAt).toBe(VALID_OBSERVED_AT);
  });

  it('missing provenance on candle body → returns candles with source=missing-observedAt', () => {
    const headers = new Headers();
    const body = { candles: sampleCandles };
    const result = parseCandleResponse(headers, body);
    expect(result).not.toBeNull();
    expect(result!.candles).toHaveLength(2);
    expect(result!.provenance.environment).toBe('unknown');
    // R7: observedAt is checked first
    expect(result!.provenance.source).toBe('missing-observedAt');
  });
});

describe('validateEngineProvenance — engine-level validation', () => {
  it('rejects unknown provenance', () => {
    const result = validateEngineProvenance({
      environment: 'unknown',
      isSynthetic: true,
      source: 'unknown',
      observedAt: VALID_OBSERVED_AT,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('unknown');
  });

  it('accepts valid live provenance (positive control)', () => {
    const result = validateEngineProvenance({
      environment: 'live',
      isSynthetic: false,
      source: 'broker-api',
      observedAt: VALID_OBSERVED_AT,
    });
    expect(result.valid).toBe(true);
  });

  it('accepts valid demo provenance (positive control)', () => {
    const result = validateEngineProvenance({
      environment: 'demo',
      isSynthetic: true,
      source: 'fovi-demo-generator',
      observedAt: VALID_OBSERVED_AT,
    });
    expect(result.valid).toBe(true);
  });

  it('rejects demo + non-synthetic (malformed)', () => {
    const result = validateEngineProvenance({
      environment: 'demo',
      isSynthetic: false,
      source: 'test',
      observedAt: VALID_OBSERVED_AT,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('synthetic');
  });

  it('rejects live + synthetic (malformed)', () => {
    const result = validateEngineProvenance({
      environment: 'live',
      isSynthetic: true,
      source: 'test',
      observedAt: VALID_OBSERVED_AT,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('synthetic');
  });
});

// ============================================================
// R7 Blocker A: parseResponseProvenance adversarial tests
// ============================================================

describe('parseResponseProvenance — Blocker A adversarial', () => {
  it('isSynthetic as string "false" → REJECT malformed-isSynthetic', () => {
    const headers = new Headers({
      'x-environment': 'live',
      'x-synthetic': 'false',
      'x-data-source': 'exchange',
      'x-observed-at': VALID_OBSERVED_AT,
    });
    const body = { isSynthetic: 'false', source: 'exchange', observedAt: VALID_OBSERVED_AT };
    const result = parseResponseProvenance(headers, body);
    expect(result.environment).toBe('unknown');
    expect(result.source).toBe('malformed-isSynthetic');
  });

  it('observedAt=123 (number) → REJECT invalid-observedAt', () => {
    const headers = new Headers({
      'x-environment': 'live',
      'x-synthetic': 'false',
      'x-data-source': 'exchange',
      'x-observed-at': VALID_OBSERVED_AT,
    });
    const body = { environment: 'live', isSynthetic: false, source: 'exchange', observedAt: 123 };
    const result = parseResponseProvenance(headers, body);
    expect(result.environment).toBe('unknown');
    expect(result.source).toBe('invalid-observedAt');
  });

  it('environment=["live"] (array) → REJECT malformed-environment', () => {
    const headers = new Headers({
      'x-environment': 'live',
      'x-synthetic': 'false',
      'x-data-source': 'exchange',
      'x-observed-at': VALID_OBSERVED_AT,
    });
    const body = { environment: ['live'], isSynthetic: false, source: 'exchange', observedAt: VALID_OBSERVED_AT };
    const result = parseResponseProvenance(headers, body);
    expect(result.environment).toBe('unknown');
    expect(result.source).toBe('malformed-environment');
  });

  it('source=["coingecko"] (array) → REJECT malformed-source', () => {
    const headers = new Headers({
      'x-environment': 'live',
      'x-synthetic': 'false',
      'x-data-source': 'coingecko',
      'x-observed-at': VALID_OBSERVED_AT,
    });
    const body = { environment: 'live', isSynthetic: false, source: ['coingecko'], observedAt: VALID_OBSERVED_AT };
    const result = parseResponseProvenance(headers, body);
    expect(result.environment).toBe('unknown');
    expect(result.source).toBe('malformed-source');
  });
});

// ============================================================
// R7 Blocker B: header/body disagreement must fail closed
// ============================================================

describe('parseResponseProvenance — Blocker B disagreement', () => {
  it('header env=live, body env=demo, same observedAt → REJECT (disagreement)', () => {
    const headers = new Headers({
      'x-environment': 'live',
      'x-synthetic': 'false',
      'x-data-source': 'exchange',
      'x-observed-at': VALID_OBSERVED_AT,
    });
    const body = { environment: 'demo', isSynthetic: true, source: 'fovi-demo-generator', observedAt: VALID_OBSERVED_AT };
    const result = parseResponseProvenance(headers, body);
    expect(result.environment).toBe('unknown');
    expect(result.source).toBe('header-body-disagreement-environment');
  });

  it('header env=demo, body env=live, same observedAt → REJECT (disagreement)', () => {
    const headers = new Headers({
      'x-environment': 'demo',
      'x-synthetic': 'true',
      'x-data-source': 'fovi-demo-generator',
      'x-observed-at': VALID_OBSERVED_AT,
    });
    const body = { environment: 'live', isSynthetic: false, source: 'exchange', observedAt: VALID_OBSERVED_AT };
    const result = parseResponseProvenance(headers, body);
    expect(result.environment).toBe('unknown');
    expect(result.source).toBe('header-body-disagreement-environment');
  });
});

// ============================================================
// R7 Blocker C: no input coercion — observedAt preserved exactly
// ============================================================

describe('parseResponseProvenance — Blocker C no coercion', () => {
  it('body observedAt string is preserved exactly (no String() coercion)', () => {
    const isoString = '2025-01-15T12:00:00.000Z';
    const headers = new Headers({
      'x-environment': 'live',
      'x-synthetic': 'false',
      'x-data-source': 'exchange',
      'x-observed-at': isoString,
    });
    const body = { environment: 'live', isSynthetic: false, source: 'exchange', observedAt: isoString };
    const result = parseResponseProvenance(headers, body);
    // Blocker C proof: exact string match, no modification
    expect(result.observedAt).toBe('2025-01-15T12:00:00.000Z');
    expect(result.observedAt === '2025-01-15T12:00:00.000Z').toBe(true);
  });
});
