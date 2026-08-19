// ============================================================
// provenance-disagreement.test.ts — CR4.3A R7
// Tests Blocker B: header/body disagreement MUST fail closed.
// Tests BOTH parseProvenance and parseResponseProvenance.
// ============================================================

import { describe, it, expect } from 'vitest';
import { parseProvenance } from '@/lib/provenance';
import { parseResponseProvenance } from '../../../mini-services/auto-trade-engine/market-provenance';

const T1 = '2025-01-15T12:00:00.000Z';
const T2 = '2025-01-15T13:00:00.000Z';

// ── Helpers ──

function makeHeaders(overrides?: Record<string, string>): Headers {
  return new Headers({
    'x-environment': 'live',
    'x-synthetic': 'false',
    'x-data-source': 'exchange',
    'x-observed-at': T1,
    ...overrides,
  });
}

function makeBody(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    environment: 'live',
    isSynthetic: false,
    source: 'exchange',
    observedAt: T1,
    ...overrides,
  };
}

// ============================================================
// A. Header/body agreement (ACCEPT)
// ============================================================

describe('Blocker B — header/body agreement → ACCEPT', () => {
  describe('parseProvenance', () => {
    it('environment live/live → ACCEPT', () => {
      const result = parseProvenance(makeHeaders(), makeBody({ environment: 'live' }));
      expect(result.environment).toBe('live');
      expect(result.source).toBe('exchange');
    });

    it('environment demo/demo → ACCEPT', () => {
      const result = parseProvenance(
        makeHeaders({ 'x-environment': 'demo', 'x-synthetic': 'true', 'x-data-source': 'fovi-demo-generator' }),
        makeBody({ environment: 'demo', isSynthetic: true, source: 'fovi-demo-generator' }),
      );
      expect(result.environment).toBe('demo');
      expect(result.source).toBe('fovi-demo-generator');
    });

    it('isSynthetic true/true → ACCEPT', () => {
      const result = parseProvenance(
        makeHeaders({ 'x-synthetic': 'true', 'x-environment': 'demo' }),
        makeBody({ isSynthetic: true, environment: 'demo' }),
      );
      expect(result.isSynthetic).toBe(true);
      expect(result.environment).toBe('demo');
    });

    it('source A/A → ACCEPT', () => {
      const result = parseProvenance(
        makeHeaders({ 'x-data-source': 'coingecko' }),
        makeBody({ source: 'coingecko' }),
      );
      expect(result.source).toBe('coingecko');
    });

    it('observedAt T1/T1 → ACCEPT', () => {
      const result = parseProvenance(
        makeHeaders({ 'x-observed-at': T1 }),
        makeBody({ observedAt: T1 }),
      );
      expect(result.observedAt).toBe(T1);
    });
  });

  describe('parseResponseProvenance', () => {
    it('environment live/live → ACCEPT', () => {
      const result = parseResponseProvenance(makeHeaders(), makeBody({ environment: 'live' }));
      expect(result.environment).toBe('live');
      expect(result.source).toBe('exchange');
    });

    it('environment demo/demo → ACCEPT', () => {
      const result = parseResponseProvenance(
        makeHeaders({ 'x-environment': 'demo', 'x-synthetic': 'true', 'x-data-source': 'fovi-demo-generator' }),
        makeBody({ environment: 'demo', isSynthetic: true, source: 'fovi-demo-generator' }),
      );
      expect(result.environment).toBe('demo');
      expect(result.source).toBe('fovi-demo-generator');
    });

    it('isSynthetic true/true → ACCEPT', () => {
      const result = parseResponseProvenance(
        makeHeaders({ 'x-synthetic': 'true', 'x-environment': 'demo' }),
        makeBody({ isSynthetic: true, environment: 'demo' }),
      );
      expect(result.isSynthetic).toBe(true);
      expect(result.environment).toBe('demo');
    });

    it('source A/A → ACCEPT', () => {
      const result = parseResponseProvenance(
        makeHeaders({ 'x-data-source': 'coingecko' }),
        makeBody({ source: 'coingecko' }),
      );
      expect(result.source).toBe('coingecko');
    });

    it('observedAt T1/T1 → ACCEPT', () => {
      const result = parseResponseProvenance(
        makeHeaders({ 'x-observed-at': T1 }),
        makeBody({ observedAt: T1 }),
      );
      expect(result.observedAt).toBe(T1);
    });
  });
});

// ============================================================
// B. Header/body disagreement (REJECT)
// ============================================================

describe('Blocker B — header/body disagreement → REJECT', () => {
  describe('parseProvenance', () => {
    it('header env=live, body env=demo → REJECT (disagreement)', () => {
      const result = parseProvenance(
        makeHeaders({ 'x-environment': 'live' }),
        makeBody({ environment: 'demo', isSynthetic: true }),
      );
      expect(result.environment).toBe('unknown');
      expect(result.source).toContain('disagreement');
    });

    it('header env=demo, body env=live → REJECT (disagreement)', () => {
      const result = parseProvenance(
        makeHeaders({ 'x-environment': 'demo' }),
        makeBody({ environment: 'live', isSynthetic: false }),
      );
      expect(result.environment).toBe('unknown');
      expect(result.source).toContain('disagreement');
    });

    it('header isSynthetic=true, body isSynthetic=false → REJECT (disagreement)', () => {
      const result = parseProvenance(
        makeHeaders({ 'x-synthetic': 'true' }),
        makeBody({ isSynthetic: false }),
      );
      expect(result.environment).toBe('unknown');
      expect(result.source).toContain('disagreement');
    });

    it('header isSynthetic=false, body isSynthetic=true → REJECT (disagreement)', () => {
      const result = parseProvenance(
        makeHeaders({ 'x-synthetic': 'false' }),
        makeBody({ isSynthetic: true }),
      );
      expect(result.environment).toBe('unknown');
      expect(result.source).toContain('disagreement');
    });

    it('header source=coingecko, body source=other → REJECT (disagreement)', () => {
      const result = parseProvenance(
        makeHeaders({ 'x-data-source': 'coingecko' }),
        makeBody({ source: 'other' }),
      );
      expect(result.environment).toBe('unknown');
      expect(result.source).toContain('disagreement');
    });

    it('header observedAt=T1, body observedAt=T2 → REJECT (disagreement)', () => {
      const result = parseProvenance(
        makeHeaders({ 'x-observed-at': T1 }),
        makeBody({ observedAt: T2 }),
      );
      expect(result.environment).toBe('unknown');
      expect(result.source).toContain('disagreement');
    });
  });

  describe('parseResponseProvenance', () => {
    it('header env=live, body env=demo → REJECT (disagreement)', () => {
      const result = parseResponseProvenance(
        makeHeaders({ 'x-environment': 'live' }),
        makeBody({ environment: 'demo', isSynthetic: true }),
      );
      expect(result.environment).toBe('unknown');
      expect(result.source).toContain('disagreement');
    });

    it('header env=demo, body env=live → REJECT (disagreement)', () => {
      const result = parseResponseProvenance(
        makeHeaders({ 'x-environment': 'demo' }),
        makeBody({ environment: 'live', isSynthetic: false }),
      );
      expect(result.environment).toBe('unknown');
      expect(result.source).toContain('disagreement');
    });

    it('header isSynthetic=true, body isSynthetic=false → REJECT (disagreement)', () => {
      const result = parseResponseProvenance(
        makeHeaders({ 'x-synthetic': 'true' }),
        makeBody({ isSynthetic: false }),
      );
      expect(result.environment).toBe('unknown');
      expect(result.source).toContain('disagreement');
    });

    it('header isSynthetic=false, body isSynthetic=true → REJECT (disagreement)', () => {
      const result = parseResponseProvenance(
        makeHeaders({ 'x-synthetic': 'false' }),
        makeBody({ isSynthetic: true }),
      );
      expect(result.environment).toBe('unknown');
      expect(result.source).toContain('disagreement');
    });

    it('header source=coingecko, body source=other → REJECT (disagreement)', () => {
      const result = parseResponseProvenance(
        makeHeaders({ 'x-data-source': 'coingecko' }),
        makeBody({ source: 'other' }),
      );
      expect(result.environment).toBe('unknown');
      expect(result.source).toContain('disagreement');
    });

    it('header observedAt=T1, body observedAt=T2 → REJECT (disagreement)', () => {
      const result = parseResponseProvenance(
        makeHeaders({ 'x-observed-at': T1 }),
        makeBody({ observedAt: T2 }),
      );
      expect(result.environment).toBe('unknown');
      expect(result.source).toContain('disagreement');
    });
  });
});

// ============================================================
// C. Malformed body + valid header (maintained from R6)
// ============================================================

describe('Blocker B — malformed body + valid header → REJECT (malformed, not disagreement)', () => {
  describe('parseProvenance', () => {
    it('body environment=["live"], header live → REJECT malformed-environment', () => {
      const result = parseProvenance(makeHeaders(), makeBody({ environment: ['live'] }));
      expect(result.environment).toBe('unknown');
      expect(result.source).toBe('malformed-environment');
    });

    it('body source=["coingecko"], header valid → REJECT malformed-source', () => {
      const result = parseProvenance(
        makeHeaders({ 'x-data-source': 'coingecko' }),
        makeBody({ source: ['coingecko'] }),
      );
      expect(result.environment).toBe('unknown');
      expect(result.source).toBe('malformed-source');
    });

    it('body isSynthetic="false", header "false" → REJECT malformed-isSynthetic', () => {
      const result = parseProvenance(
        makeHeaders({ 'x-synthetic': 'false' }),
        makeBody({ isSynthetic: 'false' }),
      );
      expect(result.environment).toBe('unknown');
      expect(result.source).toBe('malformed-isSynthetic');
    });

    it('body observedAt=123, header valid → REJECT invalid-observedAt', () => {
      const result = parseProvenance(makeHeaders(), makeBody({ observedAt: 123 }));
      expect(result.environment).toBe('unknown');
      expect(result.source).toBe('invalid-observedAt');
    });
  });

  describe('parseResponseProvenance', () => {
    it('body environment=["live"], header live → REJECT malformed-environment', () => {
      const result = parseResponseProvenance(makeHeaders(), makeBody({ environment: ['live'] }));
      expect(result.environment).toBe('unknown');
      expect(result.source).toBe('malformed-environment');
    });

    it('body source=["coingecko"], header valid → REJECT malformed-source', () => {
      const result = parseResponseProvenance(
        makeHeaders({ 'x-data-source': 'coingecko' }),
        makeBody({ source: ['coingecko'] }),
      );
      expect(result.environment).toBe('unknown');
      expect(result.source).toBe('malformed-source');
    });

    it('body isSynthetic="false", header "false" → REJECT malformed-isSynthetic', () => {
      const result = parseResponseProvenance(
        makeHeaders({ 'x-synthetic': 'false' }),
        makeBody({ isSynthetic: 'false' }),
      );
      expect(result.environment).toBe('unknown');
      expect(result.source).toBe('malformed-isSynthetic');
    });

    it('body observedAt=123, header valid → REJECT invalid-observedAt', () => {
      const result = parseResponseProvenance(makeHeaders(), makeBody({ observedAt: 123 }));
      expect(result.environment).toBe('unknown');
      expect(result.source).toBe('invalid-observedAt');
    });
  });
});

// ============================================================
// D. Missing body + valid header (ABSENT ≠ MALFORMED → fallback OK)
// ============================================================

describe('Blocker B — missing body field + valid header → ACCEPT (fallback, not disagreement)', () => {
  describe('parseProvenance', () => {
    it('body missing environment, header live → ACCEPT (fallback)', () => {
      const body = { isSynthetic: false, source: 'exchange', observedAt: T1 };
      const result = parseProvenance(makeHeaders(), body);
      expect(result.environment).toBe('live');
    });

    it('body missing source, header coingecko → ACCEPT (fallback)', () => {
      const body = { environment: 'live', isSynthetic: false, observedAt: T1 };
      const result = parseProvenance(makeHeaders({ 'x-data-source': 'coingecko' }), body);
      expect(result.source).toBe('coingecko');
    });

    it('body missing isSynthetic, header "true" → ACCEPT (fallback)', () => {
      const body = { environment: 'demo', source: 'fovi-demo-generator', observedAt: T1 };
      const result = parseProvenance(
        makeHeaders({ 'x-environment': 'demo', 'x-synthetic': 'true', 'x-data-source': 'fovi-demo-generator' }),
        body,
      );
      expect(result.isSynthetic).toBe(true);
    });

    it('body missing observedAt, header valid → ACCEPT (fallback)', () => {
      const body = { environment: 'live', isSynthetic: false, source: 'exchange' };
      const result = parseProvenance(makeHeaders(), body);
      expect(result.observedAt).toBe(T1);
    });
  });

  describe('parseResponseProvenance', () => {
    it('body missing environment, header live → ACCEPT (fallback)', () => {
      const body = { isSynthetic: false, source: 'exchange', observedAt: T1 };
      const result = parseResponseProvenance(makeHeaders(), body);
      expect(result.environment).toBe('live');
    });

    it('body missing source, header coingecko → ACCEPT (fallback)', () => {
      const body = { environment: 'live', isSynthetic: false, observedAt: T1 };
      const result = parseResponseProvenance(makeHeaders({ 'x-data-source': 'coingecko' }), body);
      expect(result.source).toBe('coingecko');
    });

    it('body missing isSynthetic, header "true" → ACCEPT (fallback)', () => {
      const body = { environment: 'demo', source: 'fovi-demo-generator', observedAt: T1 };
      const result = parseResponseProvenance(
        makeHeaders({ 'x-environment': 'demo', 'x-synthetic': 'true', 'x-data-source': 'fovi-demo-generator' }),
        body,
      );
      expect(result.isSynthetic).toBe(true);
    });

    it('body missing observedAt, header valid → ACCEPT (fallback)', () => {
      const body = { environment: 'live', isSynthetic: false, source: 'exchange' };
      const result = parseResponseProvenance(makeHeaders(), body);
      expect(result.observedAt).toBe(T1);
    });
  });
});
