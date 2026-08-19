// ============================================================
// malformed-header.test.ts — CR4.3A R8
// Tests malformed header rejection for parseProvenance (src/lib/provenance.ts)
// and parseResponseProvenance (market-provenance.ts).
// Each malformed header MUST produce environment='unknown'.
// ============================================================

import { describe, it, expect } from 'vitest';
import { parseProvenance } from '@/lib/provenance';
import { parseResponseProvenance } from '../../../mini-services/auto-trade-engine/market-provenance';

// ============================================================
// Helpers
// ============================================================

const VALID_BODY = {
  environment: 'live',
  isSynthetic: false,
  source: 'market-data-service',
  observedAt: '2024-06-15T12:00:00.000Z',
};

/** Body without isSynthetic — forces header fallback for that field */
const BODY_WITHOUT_SYNTHETIC = {
  environment: 'live',
  source: 'market-data-service',
  observedAt: '2024-06-15T12:00:00.000Z',
};

/** Body without source — forces header fallback for that field */
const BODY_WITHOUT_SOURCE = {
  environment: 'live',
  isSynthetic: false,
  observedAt: '2024-06-15T12:00:00.000Z',
};

/** Body without observedAt — forces header fallback for that field */
const BODY_WITHOUT_OBSERVED = {
  environment: 'live',
  isSynthetic: false,
  source: 'market-data-service',
};

// ============================================================
// 1-4. x-environment malformed headers
// ============================================================

describe('malformed x-environment header', () => {
  const cases = [
    { label: "empty string ''", value: '' },
    { label: "'staging' (invalid value)", value: 'staging' },
    { label: "'LIVE' (wrong case)", value: 'LIVE' },
    { label: "' ' (whitespace)", value: ' ' },
  ];

  for (const { label, value } of cases) {
    describe(label, () => {
      it('parseProvenance → environment=unknown, source=malformed-header-environment', () => {
        const headers = new Headers({ 'x-environment': value });
        const result = parseProvenance(headers, VALID_BODY);
        expect(result.environment).toBe('unknown');
        expect(result.source).toBe('malformed-header-environment');
      });

      it('parseResponseProvenance → environment=unknown, source=malformed-header-environment', () => {
        const result = parseResponseProvenance({ 'x-environment': value }, VALID_BODY);
        expect(result.environment).toBe('unknown');
        expect(result.source).toBe('malformed-header-environment');
      });
    });
  }
});

// ============================================================
// 5-7. x-synthetic malformed headers
// ============================================================

describe('malformed x-synthetic header', () => {
  const cases = [
    { label: "empty string ''", value: '' },
    { label: "'yes' (not 'true'/'false')", value: 'yes' },
    { label: "'1' (not 'true'/'false')", value: '1' },
  ];

  for (const { label, value } of cases) {
    describe(label, () => {
      it('parseProvenance → environment=unknown, source=malformed-header-isSynthetic', () => {
        const headers = new Headers({ 'x-synthetic': value });
        const result = parseProvenance(headers, BODY_WITHOUT_SYNTHETIC);
        expect(result.environment).toBe('unknown');
        expect(result.source).toBe('malformed-header-isSynthetic');
      });

      it('parseResponseProvenance → environment=unknown, source=malformed-header-isSynthetic', () => {
        const result = parseResponseProvenance({ 'x-synthetic': value }, BODY_WITHOUT_SYNTHETIC);
        expect(result.environment).toBe('unknown');
        expect(result.source).toBe('malformed-header-isSynthetic');
      });
    });
  }
});

// ============================================================
// 8-9. x-data-source malformed headers
// ============================================================

describe('malformed x-data-source header', () => {
  const cases = [
    { label: "empty string ''", value: '' },
    { label: "' ' (whitespace)", value: ' ' },
  ];

  for (const { label, value } of cases) {
    describe(label, () => {
      it('parseProvenance → environment=unknown, source=malformed-header-source', () => {
        const headers = new Headers({ 'x-data-source': value });
        const result = parseProvenance(headers, BODY_WITHOUT_SOURCE);
        expect(result.environment).toBe('unknown');
        expect(result.source).toBe('malformed-header-source');
      });

      it('parseResponseProvenance → environment=unknown, source=malformed-header-source', () => {
        const result = parseResponseProvenance({ 'x-data-source': value }, BODY_WITHOUT_SOURCE);
        expect(result.environment).toBe('unknown');
        expect(result.source).toBe('malformed-header-source');
      });
    });
  }
});

// ============================================================
// 10-12. x-observed-at malformed headers
// ============================================================

describe('malformed x-observed-at header', () => {
  const cases = [
    { label: "empty string ''", value: '' },
    { label: "'not-a-date'", value: 'not-a-date' },
    { label: "'2024-13-45' (invalid date)", value: '2024-13-45' },
  ];

  for (const { label, value } of cases) {
    describe(label, () => {
      it('parseProvenance → environment=unknown, source=malformed-header-observedAt', () => {
        const headers = new Headers({ 'x-observed-at': value });
        const result = parseProvenance(headers, BODY_WITHOUT_OBSERVED);
        expect(result.environment).toBe('unknown');
        expect(result.source).toBe('malformed-header-observedAt');
      });

      it('parseResponseProvenance → environment=unknown, source=malformed-header-observedAt', () => {
        const result = parseResponseProvenance({ 'x-observed-at': value }, BODY_WITHOUT_OBSERVED);
        expect(result.environment).toBe('unknown');
        expect(result.source).toBe('malformed-header-observedAt');
      });
    });
  }
});
