// ============================================================
// provenance.test.ts — CR4.3A R7 Behavioral tests for shared provenance model
// Tests parseProvenance, validateProvenanceForEngine from src/lib/provenance.ts
// and parseResponseProvenance, parseSinglePriceResponse, parseCandleResponse,
// validateEngineProvenance from mini-services/auto-trade-engine/market-provenance.ts
//
// CR4.3A R7: All tests updated for mandatory observedAt, Blocker A/B/C.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseProvenance,
  validateProvenanceForEngine,
  UNKNOWN_PROVENANCE,
  LIVE_PROVENANCE,
  DEMO_PROVENANCE,
} from '@/lib/provenance';
import {
  parseResponseProvenance,
  parseSinglePriceResponse,
  parseCandleResponse,
  validateEngineProvenance,
} from '../../../mini-services/auto-trade-engine/market-provenance';

const VALID_OBSERVED_AT = '2025-01-15T12:00:00.000Z';

describe('Shared Provenance Model — parseProvenance', () => {
  // ── Positive control: live headers+body match → live ──
  it('matching live headers + body → environment=live, isSynthetic=false', () => {
    const headers = new Headers({
      'x-environment': 'live',
      'x-synthetic': 'false',
      'x-data-source': 'broker-api',
      'x-observed-at': VALID_OBSERVED_AT,
    });
    const body = {
      environment: 'live',
      isSynthetic: false,
      source: 'broker-api',
      observedAt: VALID_OBSERVED_AT,
    };
    const result = parseProvenance(headers, body);
    expect(result.environment).toBe('live');
    expect(result.isSynthetic).toBe(false);
    expect(result.source).toBe('broker-api');
    expect(result.observedAt).toBe(VALID_OBSERVED_AT);
  });

  // ── Positive control: demo headers+body match → demo ──
  it('matching demo headers + body → environment=demo, isSynthetic=true', () => {
    const headers = new Headers({
      'x-environment': 'demo',
      'x-synthetic': 'true',
      'x-data-source': 'fovi-demo-generator',
      'x-observed-at': VALID_OBSERVED_AT,
    });
    const body = {
      environment: 'demo',
      isSynthetic: true,
      source: 'fovi-demo-generator',
      observedAt: VALID_OBSERVED_AT,
    };
    const result = parseProvenance(headers, body);
    expect(result.environment).toBe('demo');
    expect(result.isSynthetic).toBe(true);
    expect(result.source).toBe('fovi-demo-generator');
    expect(result.observedAt).toBe(VALID_OBSERVED_AT);
  });

  // ── Missing provenance entirely → unknown (observedAt checked first) ──
  it('missing provenance (no headers, no body) → environment=unknown', () => {
    const headers = new Headers();
    const result = parseProvenance(headers);
    expect(result.environment).toBe('unknown');
    expect(result.source).toBe('missing-observedAt');
  });

  // ── Mismatched headers/body → unknown (fail closed) ──
  it('mismatched headers vs body environment → unknown (Blocker B)', () => {
    const headers = new Headers({
      'x-environment': 'live',
      'x-synthetic': 'false',
      'x-data-source': 'broker-api',
      'x-observed-at': VALID_OBSERVED_AT,
    });
    const body = {
      environment: 'demo',
      isSynthetic: true,
      source: 'fovi-demo-generator',
      observedAt: VALID_OBSERVED_AT,
    };
    const result = parseProvenance(headers, body);
    expect(result.environment).toBe('unknown');
    expect(result.source).toBe('header-body-disagreement-environment');
  });

  // ── Malformed environment value → unknown ──
  it('malformed environment value (e.g. "staging") → unknown', () => {
    const headers = new Headers({
      'x-environment': 'staging',
      'x-observed-at': VALID_OBSERVED_AT,
      'x-synthetic': 'false',
      'x-data-source': 'test',
    });
    const body = {
      environment: 'staging',
      isSynthetic: false,
      source: 'test',
      observedAt: VALID_OBSERVED_AT,
    };
    const result = parseProvenance(headers, body);
    expect(result.environment).toBe('unknown');
  });

  // ── Nested provenance under "provenance" key ──
  it('provenance nested under body.provenance key is extracted correctly', () => {
    const headers = new Headers({
      'x-environment': 'live',
      'x-synthetic': 'false',
      'x-observed-at': VALID_OBSERVED_AT,
    });
    const body = {
      price: 42000,
      provenance: {
        environment: 'live',
        isSynthetic: false,
        source: 'exchange',
        observedAt: VALID_OBSERVED_AT,
      },
    };
    const result = parseProvenance(headers, body);
    expect(result.environment).toBe('live');
    expect(result.isSynthetic).toBe(false);
    expect(result.source).toBe('exchange');
  });

  // ── Mismatched nested provenance → unknown (Blocker B) ──
  it('mismatched header vs nested body.provenance → unknown', () => {
    const headers = new Headers({
      'x-environment': 'demo',
      'x-synthetic': 'true',
      'x-observed-at': VALID_OBSERVED_AT,
    });
    const body = {
      price: 42000,
      provenance: {
        environment: 'live',
        isSynthetic: false,
        observedAt: VALID_OBSERVED_AT,
      },
    };
    const result = parseProvenance(headers, body);
    expect(result.environment).toBe('unknown');
  });
});

describe('Shared Provenance Model — validateProvenanceForEngine', () => {
  it('valid live provenance → valid:true', () => {
    const result = validateProvenanceForEngine(LIVE_PROVENANCE);
    expect(result.valid).toBe(true);
  });

  it('valid demo provenance (isSynthetic=true) → valid:true', () => {
    const result = validateProvenanceForEngine(DEMO_PROVENANCE);
    expect(result.valid).toBe(true);
  });

  it('unknown provenance → valid:false (rejected)', () => {
    const result = validateProvenanceForEngine(UNKNOWN_PROVENANCE);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('unknown');
  });

  it('demo + non-synthetic → valid:false (rejected)', () => {
    const result = validateProvenanceForEngine({
      ...DEMO_PROVENANCE,
      isSynthetic: false,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('synthetic');
  });

  it('live + synthetic → valid:false (rejected)', () => {
    const result = validateProvenanceForEngine({
      ...LIVE_PROVENANCE,
      isSynthetic: true,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('synthetic');
  });
});

describe('Engine parseResponseProvenance — matching headers+body', () => {
  it('matching live headers + body → environment=live', () => {
    const headers = new Headers({
      'x-environment': 'live',
      'x-synthetic': 'false',
      'x-data-source': 'broker-api',
      'x-observed-at': VALID_OBSERVED_AT,
    });
    const body = {
      environment: 'live',
      isSynthetic: false,
      source: 'broker-api',
      observedAt: VALID_OBSERVED_AT,
    };
    const result = parseResponseProvenance(headers, body);
    expect(result.environment).toBe('live');
    expect(result.isSynthetic).toBe(false);
    expect(result.source).toBe('broker-api');
  });

  it('matching demo headers + body → environment=demo, isSynthetic=true', () => {
    const headers = new Headers({
      'x-environment': 'demo',
      'x-synthetic': 'true',
      'x-data-source': 'fovi-demo-generator',
      'x-observed-at': VALID_OBSERVED_AT,
    });
    const body = {
      environment: 'demo',
      isSynthetic: true,
      source: 'fovi-demo-generator',
      observedAt: VALID_OBSERVED_AT,
    };
    const result = parseResponseProvenance(headers, body);
    expect(result.environment).toBe('demo');
    expect(result.isSynthetic).toBe(true);
  });

  it('missing provenance entirely → environment=unknown (missing-observedAt)', () => {
    const headers = new Headers();
    const body = { price: 42000 };
    const result = parseResponseProvenance(headers, body);
    expect(result.environment).toBe('unknown');
    expect(result.source).toBe('missing-observedAt');
  });

  it('mismatched header vs body → environment=unknown (Blocker B)', () => {
    const headers = new Headers({
      'x-environment': 'live',
      'x-data-source': 'header-src',
      'x-synthetic': 'false',
      'x-observed-at': VALID_OBSERVED_AT,
    });
    const body = { environment: 'demo', isSynthetic: true, source: 'body-src', observedAt: VALID_OBSERVED_AT };
    const result = parseResponseProvenance(headers, body);
    expect(result.environment).toBe('unknown');
    expect(result.source).toBe('header-body-disagreement-environment');
  });

  it('malformed environment → environment=unknown', () => {
    const headers = new Headers({
      'x-environment': 'prod',
      'x-observed-at': VALID_OBSERVED_AT,
      'x-synthetic': 'false',
      'x-data-source': 'test',
    });
    const body = { environment: 'prod', isSynthetic: false, source: 'test', observedAt: VALID_OBSERVED_AT };
    const result = parseResponseProvenance(headers, body);
    expect(result.environment).toBe('unknown');
  });

  it('accepts plain Record headers (not only Headers instance)', () => {
    const headers = { 'x-environment': 'live', 'x-synthetic': 'false', 'x-data-source': 'record-src', 'x-observed-at': VALID_OBSERVED_AT };
    const body = { environment: 'live', isSynthetic: false, source: 'record-src', observedAt: VALID_OBSERVED_AT };
    const result = parseResponseProvenance(headers, body);
    expect(result.environment).toBe('live');
  });
});

describe('Engine parseSinglePriceResponse', () => {
  it('valid demo price with demo headers → environment=demo, isSynthetic=true', () => {
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
    expect(result!.price).toBe(67500);
    expect(result!.environment).toBe('demo');
    expect(result!.isSynthetic).toBe(true);
  });

  it('valid live price with live headers → environment=live', () => {
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
    expect(result!.price).toBe(42000);
    expect(result!.environment).toBe('live');
    expect(result!.isSynthetic).toBe(false);
  });

  it('missing provenance on valid price → returns result with environment=unknown', () => {
    const headers = new Headers();
    const body = { price: 42000 };
    const result = parseSinglePriceResponse(headers, body);
    expect(result).not.toBeNull();
    expect(result!.price).toBe(42000);
    expect(result!.environment).toBe('unknown');
    expect(result!.source).toBe('missing-observedAt');
  });

  it('price <= 0 returns null regardless of provenance', () => {
    const headers = new Headers({
      'x-environment': 'live',
      'x-synthetic': 'false',
    });
    const body = { price: -5, environment: 'live', isSynthetic: false };
    const result = parseSinglePriceResponse(headers, body);
    expect(result).toBeNull();
  });

  it('uses currentPrice field when price is absent', () => {
    const headers = new Headers({
      'x-environment': 'live',
      'x-synthetic': 'false',
      'x-data-source': 'test',
      'x-observed-at': VALID_OBSERVED_AT,
    });
    const body = { currentPrice: 150.25, environment: 'live', isSynthetic: false, source: 'test', observedAt: VALID_OBSERVED_AT };
    const result = parseSinglePriceResponse(headers, body);
    expect(result).not.toBeNull();
    expect(result!.price).toBe(150.25);
  });
});

describe('Engine parseCandleResponse', () => {
  const sampleCandles = [
    { timestamp: 1000, open: 100, high: 110, low: 95, close: 105, volume: 1000 },
    { timestamp: 2000, open: 105, high: 115, low: 100, close: 110, volume: 1200 },
  ];

  it('candles nested under "candles" key with live provenance → returns candles', () => {
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
    expect(result!.candles[0].close).toBe(105);
    expect(result!.provenance.environment).toBe('live');
  });

  it('candles with demo provenance → returns candles with environment=demo', () => {
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
  });

  it('empty candles array → returns null', () => {
    const headers = new Headers({ 'x-environment': 'live' });
    const body = { candles: [], environment: 'live', isSynthetic: false };
    const result = parseCandleResponse(headers, body);
    expect(result).toBeNull();
  });

  it('missing candles key → returns null', () => {
    const headers = new Headers({ 'x-environment': 'live' });
    const body = { environment: 'live', isSynthetic: false };
    const result = parseCandleResponse(headers, body);
    expect(result).toBeNull();
  });

  it('missing provenance on candles body → returns candles with environment=unknown', () => {
    const headers = new Headers();
    const body = { candles: sampleCandles };
    const result = parseCandleResponse(headers, body);
    expect(result).not.toBeNull();
    expect(result!.candles).toHaveLength(2);
    expect(result!.provenance.environment).toBe('unknown');
    expect(result!.provenance.source).toBe('missing-observedAt');
  });
});

describe('Engine validateEngineProvenance', () => {
  it('valid live → valid:true (positive control)', () => {
    const result = validateEngineProvenance({
      environment: 'live',
      isSynthetic: false,
      source: 'broker-api',
      observedAt: VALID_OBSERVED_AT,
    });
    expect(result.valid).toBe(true);
  });

  it('valid demo (isSynthetic=true) → valid:true (positive control)', () => {
    const result = validateEngineProvenance({
      environment: 'demo',
      isSynthetic: true,
      source: 'fovi-demo-generator',
      observedAt: VALID_OBSERVED_AT,
    });
    expect(result.valid).toBe(true);
  });

  it('unknown → valid:false', () => {
    const result = validateEngineProvenance({
      environment: 'unknown',
      isSynthetic: true,
      source: 'missing',
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('unknown');
  });

  it('demo + non-synthetic → valid:false', () => {
    const result = validateEngineProvenance({
      environment: 'demo',
      isSynthetic: false,
      source: 'test',
      observedAt: VALID_OBSERVED_AT,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('synthetic');
  });

  it('live + synthetic → valid:false', () => {
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
