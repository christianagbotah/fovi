import { describe, it, expect } from 'vitest';
import { parseProvenance } from '@/lib/provenance';
import { parseResponseProvenance } from '../../../mini-services/auto-trade-engine/market-provenance';

/**
 * §6: Malformed-header regression tests.
 * VALID BODY supplied, but MALFORMED header also present.
 * A malformed header must NEVER be interpreted as absent.
 * A malformed header must NEVER silently normalize.
 */

const T1 = '2026-08-19T08:00:00.000Z';

const VALID_BODY = {
  environment: 'live',
  isSynthetic: false,
  source: 'coingecko',
  observedAt: T1,
};

describe('§6 malformed-header regression — valid body + malformed header', () => {
  // --- x-synthetic header ---

  it('x-synthetic: garbage => REJECT (parseProvenance)', () => {
    const headers = new Headers({
      'x-synthetic': 'garbage',
      'x-environment': 'live',
      'x-data-source': 'coingecko',
      'x-observed-at': T1,
    });
    const result = parseProvenance(headers, VALID_BODY);
    expect(result.environment).toBe('unknown');
    expect(result.source).toBe('malformed-header-isSynthetic');
  });

  it('x-synthetic: garbage => REJECT (parseResponseProvenance)', () => {
    const headers = {
      'x-synthetic': 'garbage',
      'x-environment': 'live',
      'x-data-source': 'coingecko',
      'x-observed-at': T1,
    };
    const result = parseResponseProvenance(headers, VALID_BODY);
    expect(result.environment).toBe('unknown');
    expect(result.source).toBe('malformed-header-isSynthetic');
  });

  it('x-synthetic: yes => REJECT (parseProvenance)', () => {
    const headers = new Headers({
      'x-synthetic': 'yes',
      'x-environment': 'live',
      'x-data-source': 'coingecko',
      'x-observed-at': T1,
    });
    const result = parseProvenance(headers, VALID_BODY);
    expect(result.environment).toBe('unknown');
    expect(result.source).toBe('malformed-header-isSynthetic');
  });

  it('x-synthetic: yes => REJECT (parseResponseProvenance)', () => {
    const headers = {
      'x-synthetic': 'yes',
      'x-environment': 'live',
      'x-data-source': 'coingecko',
      'x-observed-at': T1,
    };
    const result = parseResponseProvenance(headers, VALID_BODY);
    expect(result.environment).toBe('unknown');
    expect(result.source).toBe('malformed-header-isSynthetic');
  });

  it('x-synthetic: 0 => REJECT (parseProvenance)', () => {
    const headers = new Headers({
      'x-synthetic': '0',
      'x-environment': 'live',
      'x-data-source': 'coingecko',
      'x-observed-at': T1,
    });
    const result = parseProvenance(headers, VALID_BODY);
    expect(result.environment).toBe('unknown');
    expect(result.source).toBe('malformed-header-isSynthetic');
  });

  it('x-synthetic: 0 => REJECT (parseResponseProvenance)', () => {
    const headers = {
      'x-synthetic': '0',
      'x-environment': 'live',
      'x-data-source': 'coingecko',
      'x-observed-at': T1,
    };
    const result = parseResponseProvenance(headers, VALID_BODY);
    expect(result.environment).toBe('unknown');
    expect(result.source).toBe('malformed-header-isSynthetic');
  });

  // --- x-environment header ---

  it('x-environment: staging => REJECT (parseProvenance)', () => {
    const headers = new Headers({
      'x-environment': 'staging',
      'x-synthetic': 'false',
      'x-data-source': 'coingecko',
      'x-observed-at': T1,
    });
    const result = parseProvenance(headers, VALID_BODY);
    expect(result.environment).toBe('unknown');
    expect(result.source).toBe('malformed-header-environment');
  });

  it('x-environment: staging => REJECT (parseResponseProvenance)', () => {
    const headers = {
      'x-environment': 'staging',
      'x-synthetic': 'false',
      'x-data-source': 'coingecko',
      'x-observed-at': T1,
    };
    const result = parseResponseProvenance(headers, VALID_BODY);
    expect(result.environment).toBe('unknown');
    expect(result.source).toBe('malformed-header-environment');
  });

  it('x-environment: empty string => REJECT (parseProvenance)', () => {
    const headers = new Headers({
      'x-environment': '',
      'x-synthetic': 'false',
      'x-data-source': 'coingecko',
      'x-observed-at': T1,
    });
    const result = parseProvenance(headers, VALID_BODY);
    expect(result.environment).toBe('unknown');
    expect(result.source).toBe('malformed-header-environment');
  });

  it('x-environment: empty string => REJECT (parseResponseProvenance)', () => {
    const headers = {
      'x-environment': '',
      'x-synthetic': 'false',
      'x-data-source': 'coingecko',
      'x-observed-at': T1,
    };
    const result = parseResponseProvenance(headers, VALID_BODY);
    expect(result.environment).toBe('unknown');
    expect(result.source).toBe('malformed-header-environment');
  });

  // --- x-data-source header ---

  it('x-data-source: empty string => REJECT (parseProvenance)', () => {
    const headers = new Headers({
      'x-environment': 'live',
      'x-synthetic': 'false',
      'x-data-source': '',
      'x-observed-at': T1,
    });
    const result = parseProvenance(headers, VALID_BODY);
    expect(result.environment).toBe('unknown');
    expect(result.source).toBe('malformed-header-source');
  });

  it('x-data-source: empty string => REJECT (parseResponseProvenance)', () => {
    const headers = {
      'x-environment': 'live',
      'x-synthetic': 'false',
      'x-data-source': '',
      'x-observed-at': T1,
    };
    const result = parseResponseProvenance(headers, VALID_BODY);
    expect(result.environment).toBe('unknown');
    expect(result.source).toBe('malformed-header-source');
  });

  it('x-data-source: whitespace => REJECT (parseProvenance)', () => {
    const headers = new Headers({
      'x-environment': 'live',
      'x-synthetic': 'false',
      'x-data-source': '   ',
      'x-observed-at': T1,
    });
    const result = parseProvenance(headers, VALID_BODY);
    expect(result.environment).toBe('unknown');
    expect(result.source).toBe('malformed-header-source');
  });

  it('x-data-source: whitespace => REJECT (parseResponseProvenance)', () => {
    const headers = {
      'x-environment': 'live',
      'x-synthetic': 'false',
      'x-data-source': '   ',
      'x-observed-at': T1,
    };
    const result = parseResponseProvenance(headers, VALID_BODY);
    expect(result.environment).toBe('unknown');
    expect(result.source).toBe('malformed-header-source');
  });

  // --- x-observed-at header ---

  it('x-observed-at: not-a-date => REJECT (parseProvenance)', () => {
    const headers = new Headers({
      'x-environment': 'live',
      'x-synthetic': 'false',
      'x-data-source': 'coingecko',
      'x-observed-at': 'not-a-date',
    });
    const result = parseProvenance(headers, VALID_BODY);
    expect(result.environment).toBe('unknown');
    expect(result.source).toBe('malformed-header-observedAt');
  });

  it('x-observed-at: not-a-date => REJECT (parseResponseProvenance)', () => {
    const headers = {
      'x-environment': 'live',
      'x-synthetic': 'false',
      'x-data-source': 'coingecko',
      'x-observed-at': 'not-a-date',
    };
    const result = parseResponseProvenance(headers, VALID_BODY);
    expect(result.environment).toBe('unknown');
    expect(result.source).toBe('malformed-header-observedAt');
  });
});
