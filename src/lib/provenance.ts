// ============================================================
// provenance.ts — Shared provenance model for market data
// CR4.3A R7:
//   - Factory functions replace stale constants (fresh timestamps)
//   - Blocker A: hasOwnProperty differentiates absent vs malformed
//   - Blocker B: header/body disagreement MUST fail closed
//   - Blocker C: no String()/Boolean() coercion on untrusted input
//   - observedAt is MANDATORY (all four provenance fields required)
// ============================================================

export interface Provenance {
  environment: 'live' | 'demo' | 'unknown';
  isSynthetic: boolean;
  source: string;
  observedAt: string;
}

// ============================================================
// Factory functions — each call creates a fresh timestamp
// ============================================================

/**
 * Create a live provenance object with a fresh observedAt timestamp.
 */
export function createLiveProvenance(source: string = 'broker-api'): Provenance {
  return {
    environment: 'live',
    isSynthetic: false,
    source,
    observedAt: new Date().toISOString(),
  };
}

/**
 * Create a demo provenance object with a fresh observedAt timestamp.
 */
export function createDemoProvenance(source: string = 'fovi-demo-generator'): Provenance {
  return {
    environment: 'demo',
    isSynthetic: true,
    source,
    observedAt: new Date().toISOString(),
  };
}

/**
 * Create an unknown provenance object with a fresh observedAt timestamp.
 */
export function createUnknownProvenance(source: string = 'unknown'): Provenance {
  return {
    environment: 'unknown',
    isSynthetic: true,
    source,
    observedAt: new Date().toISOString(),
  };
}

// ============================================================
// Backward-compatible constant re-exports
// @deprecated Use createLiveProvenance(), createDemoProvenance(),
//   createUnknownProvenance() instead for fresh timestamps.
// ============================================================

/** @deprecated Use createLiveProvenance() for fresh timestamps */
export const LIVE_PROVENANCE: Provenance = createLiveProvenance();

/** @deprecated Use createDemoProvenance() for fresh timestamps */
export const DEMO_PROVENANCE: Provenance = createDemoProvenance();

/** @deprecated Use createUnknownProvenance() for fresh timestamps */
export const UNKNOWN_PROVENANCE: Provenance = createUnknownProvenance();

// ============================================================
// Helpers
// ============================================================

export function provenanceHeaders(p: Provenance): Record<string, string> {
  return {
    'x-environment': p.environment,
    'x-synthetic': String(p.isSynthetic),
    'x-data-source': p.source,
    'x-observed-at': p.observedAt,
    'x-demo': String(p.environment === 'demo'),
  };
}

/**
 * Validate that a string is a non-empty, non-whitespace, valid positive Date ISO string.
 */
function isValidObservedAt(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed === '') return false;
  const ts = new Date(trimmed).getTime();
  if (isNaN(ts) || ts <= 0) return false;
  return true;
}

/**
 * Parse provenance from HTTP response headers and optionally a JSON body.
 * Body provenance may be at top level or nested under a "provenance" key.
 *
 * CR4.3A R7 Blocker A — differentiate absent vs malformed:
 * - Use Object.prototype.hasOwnProperty.call to detect property presence
 * - If property EXISTS but is wrong type → fail closed (unknown), no header fallback
 * - If property is a string but not 'live'/'demo' → fail closed, no header fallback
 * - If property is genuinely absent → fall back to header
 * - Same for isSynthetic and source
 * - NO Boolean(untrustedValue), NO String(untrustedValue) on input
 * - If isSynthetic is a string like 'false' → REJECT immediately
 *
 * CR4.3A R7 Blocker B — header/body disagreement must fail closed:
 * - If BOTH header and body provide a field, they MUST agree
 * - If they disagree → UNKNOWN (provenance cannot be trusted)
 *
 * CR4.3A R7 Blocker C — no input coercion:
 * - No String(bodyValue) on already-validated string values
 * - observedAt is MANDATORY — reject absent, undefined, null, empty, whitespace,
 *   number, array, object, boolean. Must be non-empty string that parses to valid positive Date.
 */
export function parseProvenance(
  headers: Headers,
  body?: Record<string, unknown>,
): Provenance {
  const hasOwn = (obj: unknown, key: string): boolean =>
    Object.prototype.hasOwnProperty.call(obj, key);

  // R8: Helper — null = header absent, string = header present (possibly '')
  const getHeader = (h: Headers, name: string): string | null => h.get(name);

  const headerEnv = getHeader(headers, 'x-environment');
  const headerSynth = getHeader(headers, 'x-synthetic');
  const headerSource = getHeader(headers, 'x-data-source');
  const headerObserved = getHeader(headers, 'x-observed-at');

  // Extract body provenance (top-level or nested)
  const bodyProv = (body?.provenance as Record<string, unknown> | undefined) || body;

  // ── observedAt (MANDATORY) ──
  let observedAt: string | null = null;
  let observedFromBody = false;
  if (bodyProv) {
    if (hasOwn(bodyProv, 'observedAt')) {
      observedFromBody = true;
      const bodyObserved = bodyProv.observedAt;
      if (!isValidObservedAt(bodyObserved)) {
        return createUnknownProvenance('invalid-observedAt');
      }
      // Blocker C: no String() coercion — bodyObserved is already validated as string
      observedAt = bodyObserved as string;
    }
  }
  // If body didn't have it, check header
  if (observedAt === null) {
    if (headerObserved !== null) {
      // Header is PRESENT — validate strictly
      if (!isValidObservedAt(headerObserved)) {
        return createUnknownProvenance('malformed-header-observedAt');
      }
      observedAt = headerObserved;
    }
  }
  // Still null → missing from both → unknown
  if (observedAt === null) {
    return createUnknownProvenance('missing-observedAt');
  }
  // R9: Validate header unconditionally when present (malformed header detected before disagreement)
  if (headerObserved !== null && !isValidObservedAt(headerObserved)) {
    return createUnknownProvenance('malformed-header-observedAt');
  }
  // Blocker B: If BOTH header and body provided observedAt, they must agree
  if (observedFromBody && headerObserved !== null && observedAt !== headerObserved) {
    return createUnknownProvenance('header-body-disagreement-observedAt');
  }

  // ── environment ──
  let env: 'live' | 'demo' | 'unknown' = 'unknown';
  let envFromBody = false;
  if (bodyProv) {
    if (hasOwn(bodyProv, 'environment')) {
      const bodyEnv = bodyProv.environment;
      // Property exists but wrong type → reject
      if (typeof bodyEnv !== 'string') {
        return createUnknownProvenance('malformed-environment');
      }
      // String but not 'live' or 'demo' → reject
      if (bodyEnv !== 'live' && bodyEnv !== 'demo') {
        return createUnknownProvenance('invalid-environment');
      }
      env = bodyEnv;
      envFromBody = true;
    }
  }
  // If body didn't have it, check header
  if (headerEnv !== null) {
    // Header is PRESENT — validate strictly: only 'live' or 'demo'
    if (headerEnv !== 'live' && headerEnv !== 'demo') {
      return createUnknownProvenance('malformed-header-environment');
    }
  }
  // Only fall back to header if header is present AND valid
  // (header is absent case handled by env still being 'unknown')
  if (env === 'unknown' && headerEnv !== null && (headerEnv === 'live' || headerEnv === 'demo')) {
    env = headerEnv as 'live' | 'demo';
  }
  if (env === 'unknown') {
    return createUnknownProvenance('missing-environment');
  }
  // Blocker B: If BOTH header and body provided environment, they must agree
  if (envFromBody && headerEnv !== null && env !== headerEnv) {
    return createUnknownProvenance('header-body-disagreement-environment');
  }

  // ── isSynthetic ──
  let synth: boolean | null = null;
  let synthFromBody = false;
  if (bodyProv) {
    if (hasOwn(bodyProv, 'isSynthetic')) {
      const bodySynth = bodyProv.isSynthetic;
      // Property exists but not a boolean → REJECT immediately
      if (typeof bodySynth !== 'boolean') {
        return createUnknownProvenance('malformed-isSynthetic');
      }
      synth = bodySynth;
      synthFromBody = true;
    }
  }
  // If body didn't have it, check header
  if (synth === null && headerSynth !== null) {
    // Header is PRESENT — validate strictly: only 'true' or 'false'
    if (headerSynth !== 'true' && headerSynth !== 'false') {
      return createUnknownProvenance('malformed-header-isSynthetic');
    }
    synth = headerSynth === 'true';
  }
  if (synth === null) {
    return createUnknownProvenance('missing-isSynthetic');
  }
  // R9: Validate header unconditionally when present
  if (headerSynth !== null && headerSynth !== 'true' && headerSynth !== 'false') {
    return createUnknownProvenance('malformed-header-isSynthetic');
  }
  // Blocker B: If BOTH header and body provided isSynthetic, they must agree
  if (synthFromBody && headerSynth !== null) {
    const headerBool = headerSynth === 'true';
    if (synth !== headerBool) {
      return createUnknownProvenance('header-body-disagreement-isSynthetic');
    }
  }

  // ── source ──
  let source: string | null = null;
  let sourceFromBody = false;
  if (bodyProv) {
    if (hasOwn(bodyProv, 'source')) {
      const bodySource = bodyProv.source;
      // Property exists but wrong type → reject
      if (typeof bodySource !== 'string') {
        return createUnknownProvenance('malformed-source');
      }
      if (bodySource.trim() === '') {
        return createUnknownProvenance('empty-source');
      }
      source = bodySource;
      sourceFromBody = true;
    }
  }
  // If body didn't have it, check header
  if (source === null && headerSource !== null) {
    // Header is PRESENT — validate strictly: non-empty after trim
    if (headerSource.trim() === '') {
      return createUnknownProvenance('malformed-header-source');
    }
    source = headerSource;
  }
  if (source === null) {
    return createUnknownProvenance('missing-source');
  }
  // R9: Validate header unconditionally when present (malformed header detected before disagreement)
  if (headerSource !== null && headerSource.trim() === '') {
    return createUnknownProvenance('malformed-header-source');
  }
  // Blocker B: If BOTH header and body provided source, they must agree
  if (sourceFromBody && headerSource !== null && source !== headerSource) {
    return createUnknownProvenance('header-body-disagreement-source');
  }

  return { environment: env, isSynthetic: synth, source, observedAt };
}

/**
 * Validate provenance for engine consumption.
 * Returns { valid: true } or { valid: false, reason: string }.
 */
export function validateProvenanceForEngine(
  p: Provenance,
): { valid: boolean; reason?: string } {
  if (p.environment === 'unknown')
    return { valid: false, reason: 'Provenance is unknown — cannot determine data origin' };
  if (!p.observedAt || !isValidObservedAt(p.observedAt))
    return { valid: false, reason: 'Provenance observedAt is missing or invalid' };
  if (p.environment === 'demo' && !p.isSynthetic)
    return { valid: false, reason: 'Demo data must be synthetic' };
  if (p.isSynthetic && p.environment === 'live')
    return { valid: false, reason: 'Live data cannot be synthetic' };
  return { valid: true };
}
