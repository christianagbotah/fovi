// ============================================================
// Provenance Tests (Phase 1 CR4)
// Test shared provenance parsing and validation.
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  parseProvenance,
  validateProvenanceForEngine,
  UNKNOWN_PROVENANCE,
  DEMO_PROVENANCE,
  LIVE_PROVENANCE,
  provenanceHeaders,
} from '@/lib/provenance';

// ================================================================
// parseProvenance
// ================================================================
describe('parseProvenance', () => {
  it('matching headers+body → correct environment (live)', () => {
    const headers = new Headers({
      'x-environment': 'live',
      'x-synthetic': 'false',
      'x-data-source': 'broker-api',
    });
    const body = {
      provenance: {
        environment: 'live',
        isSynthetic: false,
        source: 'broker-api',
      },
    };

    const result = parseProvenance(headers, body);
    expect(result.environment).toBe('live');
    expect(result.isSynthetic).toBe(false);
    expect(result.source).toBe('broker-api');
  });

  it('matching headers+body → correct environment (demo)', () => {
    const headers = new Headers({
      'x-environment': 'demo',
      'x-synthetic': 'true',
      'x-data-source': 'fovi-demo-generator',
    });
    const body = {
      provenance: {
        environment: 'demo',
        isSynthetic: true,
        source: 'fovi-demo-generator',
      },
    };

    const result = parseProvenance(headers, body);
    expect(result.environment).toBe('demo');
    expect(result.isSynthetic).toBe(true);
    expect(result.source).toBe('fovi-demo-generator');
  });

  it('mismatching headers+body environment → unknown', () => {
    const headers = new Headers({ 'x-environment': 'live' });
    const body = { provenance: { environment: 'demo', isSynthetic: true, source: 'test' } };
    const result = parseProvenance(headers, body);
    expect(result.environment).toBe('unknown');
  });

  it('mismatching headers+body synthetic flag → unknown', () => {
    const headers = new Headers({ 'x-environment': 'live', 'x-synthetic': 'false' });
    const body = { provenance: { environment: 'live', isSynthetic: true, source: 'test' } };
    const result = parseProvenance(headers, body);
    expect(result.environment).toBe('unknown');
  });

  it('mismatching headers+body source → unknown', () => {
    const headers = new Headers({ 'x-environment': 'live', 'x-data-source': 'source-A' });
    const body = { provenance: { environment: 'live', isSynthetic: false, source: 'source-B' } };
    const result = parseProvenance(headers, body);
    expect(result.environment).toBe('unknown');
  });

  it('missing provenance (no headers, no body) → unknown', () => {
    const result = parseProvenance(new Headers(), {});
    expect(result.environment).toBe('unknown');
  });

  it('only headers (no body provenance) → uses header values', () => {
    const headers = new Headers({
      'x-environment': 'demo',
      'x-synthetic': 'true',
      'x-data-source': 'test-source',
    });
    const result = parseProvenance(headers, {});
    expect(result.environment).toBe('demo');
    expect(result.isSynthetic).toBe(true);
    expect(result.source).toBe('test-source');
  });

  it('only body provenance (no headers) → uses body values', () => {
    const body = {
      provenance: {
        environment: 'live',
        isSynthetic: false,
        source: 'broker-direct',
      },
    };
    const result = parseProvenance(new Headers(), body);
    expect(result.environment).toBe('live');
    expect(result.isSynthetic).toBe(false);
    expect(result.source).toBe('broker-direct');
  });

  it('invalid environment string → unknown', () => {
    const headers = new Headers({ 'x-environment': 'staging' });
    const body = { provenance: { environment: 'staging', isSynthetic: false, source: 'test' } };
    const result = parseProvenance(headers, body);
    expect(result.environment).toBe('unknown');
  });
});

// ================================================================
// validateProvenanceForEngine
// ================================================================
describe('validateProvenanceForEngine', () => {
  it('live + non-synthetic → valid', () => {
    const result = validateProvenanceForEngine(LIVE_PROVENANCE);
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('demo + synthetic → valid', () => {
    const result = validateProvenanceForEngine(DEMO_PROVENANCE);
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('unknown environment → invalid', () => {
    const result = validateProvenanceForEngine(UNKNOWN_PROVENANCE);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('unknown');
  });

  it('live + synthetic → invalid', () => {
    const result = validateProvenanceForEngine({
      environment: 'live', isSynthetic: true, source: 'test', observedAt: new Date().toISOString(),
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('synthetic');
  });

  it('demo + non-synthetic → invalid', () => {
    const result = validateProvenanceForEngine({
      environment: 'demo', isSynthetic: false, source: 'test', observedAt: new Date().toISOString(),
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('synthetic');
  });
});

// ================================================================
// Provenance constants
// ================================================================
describe('provenance constants', () => {
  it('DEMO_PROVENANCE has correct values', () => {
    expect(DEMO_PROVENANCE.environment).toBe('demo');
    expect(DEMO_PROVENANCE.isSynthetic).toBe(true);
    expect(DEMO_PROVENANCE.source).toBe('fovi-demo-generator');
  });

  it('LIVE_PROVENANCE has correct values', () => {
    expect(LIVE_PROVENANCE.environment).toBe('live');
    expect(LIVE_PROVENANCE.isSynthetic).toBe(false);
  });

  it('UNKNOWN_PROVENANCE has correct values', () => {
    expect(UNKNOWN_PROVENANCE.environment).toBe('unknown');
    expect(UNKNOWN_PROVENANCE.isSynthetic).toBe(true);
    expect(UNKNOWN_PROVENANCE.source).toBe('unknown');
  });

  it('provenanceHeaders produces correct keys', () => {
    const h = provenanceHeaders(DEMO_PROVENANCE);
    expect(h['x-environment']).toBe('demo');
    expect(h['x-synthetic']).toBe('true');
    expect(h['x-data-source']).toBe('fovi-demo-generator');
    expect(h['x-demo']).toBe('true');
  });
});
