// ============================================================
// provenance-blocker-a.test.ts — CR4.3A R7
// Tests Blocker A provenance parsing in both parseProvenance
// (lib/provenance) and parseResponseProvenance (market-provenance).
//
// Blocker A: differentiate absent vs malformed fields.
//   - Property EXISTS but wrong type → REJECT (unknown), no header fallback
//   - Property genuinely absent → fall back to header
//   - No Boolean()/String() coercion on untrusted input
//   - observedAt is MANDATORY
// ============================================================

import { describe, it, expect } from 'vitest';
import { parseProvenance } from '@/lib/provenance';
import { parseResponseProvenance } from '../../../mini-services/auto-trade-engine/market-provenance';

const VALID_OBSERVED_AT = '2025-01-15T12:00:00.000Z';

// ── Helpers ──

function validHeaders(extra?: Record<string, string>): Headers {
  return new Headers({
    'x-environment': 'live',
    'x-synthetic': 'false',
    'x-data-source': 'exchange',
    'x-observed-at': VALID_OBSERVED_AT,
    ...extra,
  });
}

function validBody(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    environment: 'live',
    isSynthetic: false,
    source: 'exchange',
    observedAt: VALID_OBSERVED_AT,
    ...overrides,
  };
}

// ============================================================
// A. Environment type enforcement
// ============================================================

describe('Blocker A — environment type enforcement', () => {
  describe('parseProvenance', () => {
    it('body environment=["live"], header live → REJECT malformed-environment', () => {
      const result = parseProvenance(validHeaders(), validBody({ environment: ['live'] }));
      expect(result.environment).toBe('unknown');
      expect(result.source).toBe('malformed-environment');
    });

    it('body environment=["demo"], header demo → REJECT malformed-environment', () => {
      const result = parseProvenance(
        validHeaders({ 'x-environment': 'demo' }),
        validBody({ environment: ['demo'] }),
      );
      expect(result.environment).toBe('unknown');
      expect(result.source).toBe('malformed-environment');
    });

    it('body environment=1, header live → REJECT malformed-environment', () => {
      const result = parseProvenance(validHeaders(), validBody({ environment: 1 }));
      expect(result.environment).toBe('unknown');
      expect(result.source).toBe('malformed-environment');
    });
  });

  describe('parseResponseProvenance', () => {
    it('body environment=["live"], header live → REJECT malformed-environment', () => {
      const result = parseResponseProvenance(validHeaders(), validBody({ environment: ['live'] }));
      expect(result.environment).toBe('unknown');
      expect(result.source).toBe('malformed-environment');
    });

    it('body environment=["demo"], header demo → REJECT malformed-environment', () => {
      const result = parseResponseProvenance(
        validHeaders({ 'x-environment': 'demo' }),
        validBody({ environment: ['demo'] }),
      );
      expect(result.environment).toBe('unknown');
      expect(result.source).toBe('malformed-environment');
    });

    it('body environment=1, header live → REJECT malformed-environment', () => {
      const result = parseResponseProvenance(validHeaders(), validBody({ environment: 1 }));
      expect(result.environment).toBe('unknown');
      expect(result.source).toBe('malformed-environment');
    });
  });
});

// ============================================================
// B. Source type enforcement
// ============================================================

describe('Blocker A — source type enforcement', () => {
  describe('parseProvenance', () => {
    it('body source=["coingecko"], header coingecko → REJECT malformed-source', () => {
      const result = parseProvenance(
        validHeaders({ 'x-data-source': 'coingecko' }),
        validBody({ source: ['coingecko'] }),
      );
      expect(result.environment).toBe('unknown');
      expect(result.source).toBe('malformed-source');
    });
  });

  describe('parseResponseProvenance', () => {
    it('body source=["coingecko"], header coingecko → REJECT malformed-source', () => {
      const result = parseResponseProvenance(
        validHeaders({ 'x-data-source': 'coingecko' }),
        validBody({ source: ['coingecko'] }),
      );
      expect(result.environment).toBe('unknown');
      expect(result.source).toBe('malformed-source');
    });
  });
});

// ============================================================
// C. isSynthetic type enforcement
// ============================================================

describe('Blocker A — isSynthetic type enforcement', () => {
  describe('parseProvenance', () => {
    it('body isSynthetic="false", header "false" → REJECT malformed-isSynthetic', () => {
      const result = parseProvenance(
        validHeaders({ 'x-synthetic': 'false' }),
        validBody({ isSynthetic: 'false' }),
      );
      expect(result.environment).toBe('unknown');
      expect(result.source).toBe('malformed-isSynthetic');
    });

    it('body isSynthetic="true", header "true" → REJECT malformed-isSynthetic', () => {
      const result = parseProvenance(
        validHeaders({ 'x-synthetic': 'true' }),
        validBody({ isSynthetic: 'true' }),
      );
      expect(result.environment).toBe('unknown');
      expect(result.source).toBe('malformed-isSynthetic');
    });
  });

  describe('parseResponseProvenance', () => {
    it('body isSynthetic="false", header "false" → REJECT malformed-isSynthetic', () => {
      const result = parseResponseProvenance(
        validHeaders({ 'x-synthetic': 'false' }),
        validBody({ isSynthetic: 'false' }),
      );
      expect(result.environment).toBe('unknown');
      expect(result.source).toBe('malformed-isSynthetic');
    });

    it('body isSynthetic="true", header "true" → REJECT malformed-isSynthetic', () => {
      const result = parseResponseProvenance(
        validHeaders({ 'x-synthetic': 'true' }),
        validBody({ isSynthetic: 'true' }),
      );
      expect(result.environment).toBe('unknown');
      expect(result.source).toBe('malformed-isSynthetic');
    });
  });
});

// ============================================================
// D. observedAt MANDATORY
// ============================================================

describe('Blocker A — observedAt MANDATORY', () => {
  describe('parseProvenance', () => {
    it('body observedAt=123, header valid → REJECT invalid-observedAt', () => {
      const result = parseProvenance(validHeaders(), validBody({ observedAt: 123 }));
      expect(result.environment).toBe('unknown');
      expect(result.source).toBe('invalid-observedAt');
    });

    it('body observedAt=null, header valid → REJECT invalid-observedAt', () => {
      const result = parseProvenance(validHeaders(), validBody({ observedAt: null }));
      expect(result.environment).toBe('unknown');
      expect(result.source).toBe('invalid-observedAt');
    });

    it('body observedAt="", header valid → REJECT invalid-observedAt', () => {
      const result = parseProvenance(validHeaders(), validBody({ observedAt: '' }));
      expect(result.environment).toBe('unknown');
      expect(result.source).toBe('invalid-observedAt');
    });

    it('body observedAt="  ", header valid → REJECT invalid-observedAt', () => {
      const result = parseProvenance(validHeaders(), validBody({ observedAt: '  ' }));
      expect(result.environment).toBe('unknown');
      expect(result.source).toBe('invalid-observedAt');
    });

    it('body observedAt="not-a-date", header valid → REJECT invalid-observedAt', () => {
      const result = parseProvenance(validHeaders(), validBody({ observedAt: 'not-a-date' }));
      expect(result.environment).toBe('unknown');
      expect(result.source).toBe('invalid-observedAt');
    });

    it('missing from both → REJECT missing-observedAt', () => {
      const headersNoObserved = new Headers({
        'x-environment': 'live',
        'x-synthetic': 'false',
        'x-data-source': 'exchange',
      });
      const bodyNoObserved = { environment: 'live', isSynthetic: false, source: 'exchange' };
      const result = parseProvenance(headersNoObserved, bodyNoObserved);
      expect(result.environment).toBe('unknown');
      expect(result.source).toBe('missing-observedAt');
    });
  });

  describe('parseResponseProvenance', () => {
    it('body observedAt=123, header valid → REJECT invalid-observedAt', () => {
      const result = parseResponseProvenance(validHeaders(), validBody({ observedAt: 123 }));
      expect(result.environment).toBe('unknown');
      expect(result.source).toBe('invalid-observedAt');
    });

    it('body observedAt=null, header valid → REJECT invalid-observedAt', () => {
      const result = parseResponseProvenance(validHeaders(), validBody({ observedAt: null }));
      expect(result.environment).toBe('unknown');
      expect(result.source).toBe('invalid-observedAt');
    });

    it('body observedAt="", header valid → REJECT invalid-observedAt', () => {
      const result = parseResponseProvenance(validHeaders(), validBody({ observedAt: '' }));
      expect(result.environment).toBe('unknown');
      expect(result.source).toBe('invalid-observedAt');
    });

    it('body observedAt="  ", header valid → REJECT invalid-observedAt', () => {
      const result = parseResponseProvenance(validHeaders(), validBody({ observedAt: '  ' }));
      expect(result.environment).toBe('unknown');
      expect(result.source).toBe('invalid-observedAt');
    });

    it('body observedAt="not-a-date", header valid → REJECT invalid-observedAt', () => {
      const result = parseResponseProvenance(validHeaders(), validBody({ observedAt: 'not-a-date' }));
      expect(result.environment).toBe('unknown');
      expect(result.source).toBe('invalid-observedAt');
    });

    it('missing from both → REJECT missing-observedAt', () => {
      const headersNoObserved = new Headers({
        'x-environment': 'live',
        'x-synthetic': 'false',
        'x-data-source': 'exchange',
      });
      const bodyNoObserved = { environment: 'live', isSynthetic: false, source: 'exchange' };
      const result = parseResponseProvenance(headersNoObserved, bodyNoObserved);
      expect(result.environment).toBe('unknown');
      expect(result.source).toBe('missing-observedAt');
    });
  });
});

// ============================================================
// E. Valid cases
// ============================================================

describe('Blocker A — valid cases', () => {
  describe('parseProvenance', () => {
    it('valid body + valid header agreeing → ACCEPT', () => {
      const result = parseProvenance(validHeaders(), validBody());
      expect(result.environment).toBe('live');
      expect(result.isSynthetic).toBe(false);
      expect(result.source).toBe('exchange');
      expect(result.observedAt).toBe(VALID_OBSERVED_AT);
    });

    it('missing body environment, valid header → ACCEPT (fallback)', () => {
      const body = { isSynthetic: false, source: 'exchange', observedAt: VALID_OBSERVED_AT };
      const result = parseProvenance(validHeaders(), body);
      expect(result.environment).toBe('live');
      expect(result.source).toBe('exchange');
    });

    it('body absent + header absent → REJECT', () => {
      const emptyHeaders = new Headers();
      const result = parseProvenance(emptyHeaders);
      expect(result.environment).toBe('unknown');
    });
  });

  describe('parseResponseProvenance', () => {
    it('valid body + valid header agreeing → ACCEPT', () => {
      const result = parseResponseProvenance(validHeaders(), validBody());
      expect(result.environment).toBe('live');
      expect(result.isSynthetic).toBe(false);
      expect(result.source).toBe('exchange');
      expect(result.observedAt).toBe(VALID_OBSERVED_AT);
    });

    it('missing body environment, valid header → ACCEPT (fallback)', () => {
      const body = { isSynthetic: false, source: 'exchange', observedAt: VALID_OBSERVED_AT };
      const result = parseResponseProvenance(validHeaders(), body);
      expect(result.environment).toBe('live');
      expect(result.source).toBe('exchange');
    });

    it('body absent + header absent → REJECT', () => {
      const emptyHeaders = new Headers();
      const result = parseResponseProvenance(emptyHeaders);
      expect(result.environment).toBe('unknown');
    });
  });
});

// ============================================================
// F. Plain Record headers (parseResponseProvenance)
// ============================================================

describe('Blocker A — Plain Record headers', () => {
  it('Record<string, string> headers work for parseResponseProvenance', () => {
    const recordHeaders: Record<string, string> = {
      'x-environment': 'live',
      'x-synthetic': 'false',
      'x-data-source': 'exchange',
      'x-observed-at': VALID_OBSERVED_AT,
    };
    const result = parseResponseProvenance(recordHeaders, validBody());
    expect(result.environment).toBe('live');
    expect(result.isSynthetic).toBe(false);
    expect(result.source).toBe('exchange');
    expect(result.observedAt).toBe(VALID_OBSERVED_AT);
  });
});
