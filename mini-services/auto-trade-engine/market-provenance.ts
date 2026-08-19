// ============================================================
// market-provenance.ts — Startup-free provenance parsing for engine
// CR4.3A R7:
//   Blocker A: differentiate absent vs malformed fields.
//   Blocker B: header/body disagreement MUST fail closed.
//   Blocker C: no String()/Boolean() coercion on untrusted input.
//   No Bun.serve, no global state, importable without side effects.
// ============================================================

/**
 * Parsed market price with provenance.
 * `isLive` is the engine-consumable gate: true ONLY when
 * provenance is explicitly 'live' and NOT synthetic.
 */
export interface PriceWithProvenance {
  price: number;
  environment: 'live' | 'demo' | 'unknown';
  isSynthetic: boolean;
  source: string;
  observedAt?: string;
}

export interface CandlesWithProvenance {
  candles: { timestamp: number; open: number; high: number; low: number; close: number; volume: number }[];
  provenance: {
    environment: 'live' | 'demo' | 'unknown';
    isSynthetic: boolean;
    source: string;
    observedAt?: string;
  };
}

// ============================================================
// Helpers
// ============================================================

function isValidObservedAt(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed === '') return false;
  const ts = new Date(trimmed).getTime();
  if (isNaN(ts) || ts <= 0) return false;
  return true;
}

const UNKNOWN_RESULT = { environment: 'unknown' as const, isSynthetic: true, source: 'unknown' };

/**
 * Parse provenance from HTTP response headers and optional JSON body.
 * Used by the engine to determine if market data is live, demo, or unknown.
 *
 * CR4.3A R7 Blocker A — differentiate absent vs malformed:
 * - Use Object.prototype.hasOwnProperty.call(bodyProv, field) to detect presence
 * - If field present but wrong type → REJECT immediately (unknown), no header fallback
 * - If field genuinely absent → fall back to header
 * - No Boolean()/String() coercion on isSynthetic/environment/source
 *
 * CR4.3A R7 Blocker B — header/body disagreement must fail closed:
 * - If BOTH header and body provide a field, they MUST agree
 * - If they disagree → UNKNOWN
 *
 * CR4.3A R7 Blocker C — no input coercion:
 * - No String(bodyObserved) on already-validated string
 * - observedAt is MANDATORY
 */
export function parseResponseProvenance(
  headers: Headers | Record<string, string>,
  body?: Record<string, unknown>,
): { environment: 'live' | 'demo' | 'unknown'; isSynthetic: boolean; source: string; observedAt?: string } {
  const getHeader = (name: string): string | null => {
    if (headers instanceof Headers) return headers.get(name);
    return (headers as Record<string, string>)[name.toLowerCase()] ?? null;
  };

  const hasOwn = (obj: unknown, key: string): boolean =>
    Object.prototype.hasOwnProperty.call(obj, key);

  const headerEnv = getHeader('x-environment');
  const headerSynth = getHeader('x-synthetic');
  const headerSource = getHeader('x-data-source');
  const headerObserved = getHeader('x-observed-at');

  // Extract body provenance (top-level or nested under 'provenance' key)
  const bodyProv = (body?.provenance as Record<string, unknown> | undefined) || body;

  // ── observedAt (MANDATORY) ──
  let observedAt: string | undefined;
  let observedFromBody = false;
  if (bodyProv) {
    if (hasOwn(bodyProv, 'observedAt')) {
      observedFromBody = true;
      const bodyObserved = bodyProv.observedAt;
      if (!isValidObservedAt(bodyObserved)) {
        return { ...UNKNOWN_RESULT, source: 'invalid-observedAt' };
      }
      // Blocker C: no String() coercion — bodyObserved is already validated as string
      observedAt = bodyObserved as string;
    }
  }
  if (observedAt === undefined) {
    if (headerObserved !== null) {
      // Header is PRESENT — validate strictly
      if (!isValidObservedAt(headerObserved)) {
        return { ...UNKNOWN_RESULT, source: 'malformed-header-observedAt' };
      }
      observedAt = headerObserved;
    }
  }
  if (observedAt === undefined) {
    return { ...UNKNOWN_RESULT, source: 'missing-observedAt' };
  }
  // R9: Validate header unconditionally when present
  if (headerObserved !== null && !isValidObservedAt(headerObserved)) {
    return { ...UNKNOWN_RESULT, source: 'malformed-header-observedAt' };
  }
  // Blocker B: If BOTH header and body provided observedAt, they must agree
  if (observedFromBody && headerObserved !== null && observedAt !== headerObserved) {
    return { ...UNKNOWN_RESULT, source: 'header-body-disagreement-observedAt' };
  }

  // ── environment ──
  let env: 'live' | 'demo' | 'unknown' = 'unknown';
  let envFromBody = false;
  if (bodyProv) {
    if (hasOwn(bodyProv, 'environment')) {
      const bodyEnv = bodyProv.environment;
      if (typeof bodyEnv !== 'string') {
        return { ...UNKNOWN_RESULT, source: 'malformed-environment' };
      }
      if (bodyEnv !== 'live' && bodyEnv !== 'demo') {
        return { ...UNKNOWN_RESULT, source: 'invalid-environment' };
      }
      env = bodyEnv;
      envFromBody = true;
    }
  }
  // If body didn't have it, check header
  if (headerEnv !== null) {
    // Header is PRESENT — validate strictly: only 'live' or 'demo'
    if (headerEnv !== 'live' && headerEnv !== 'demo') {
      return { ...UNKNOWN_RESULT, source: 'malformed-header-environment' };
    }
  }
  // Only fall back to header if header is present AND valid
  // (header is absent case handled by env still being 'unknown')
  if (env === 'unknown' && headerEnv !== null && (headerEnv === 'live' || headerEnv === 'demo')) {
    env = headerEnv as 'live' | 'demo';
  }
  if (env === 'unknown') {
    return { ...UNKNOWN_RESULT, source: 'missing-environment' };
  }
  // Blocker B: If BOTH header and body provided environment, they must agree
  if (envFromBody && headerEnv !== null && env !== headerEnv) {
    return { ...UNKNOWN_RESULT, source: 'header-body-disagreement-environment' };
  }

  // ── isSynthetic ──
  let synth: boolean | null = null;
  let synthFromBody = false;
  if (bodyProv) {
    if (hasOwn(bodyProv, 'isSynthetic')) {
      const bodySynth = bodyProv.isSynthetic;
      if (typeof bodySynth !== 'boolean') {
        return { ...UNKNOWN_RESULT, source: 'malformed-isSynthetic' };
      }
      synth = bodySynth;
      synthFromBody = true;
    }
  }
  // If body didn't have it, check header
  if (synth === null && headerSynth !== null) {
    // Header is PRESENT — validate strictly: only 'true' or 'false'
    if (headerSynth !== 'true' && headerSynth !== 'false') {
      return { ...UNKNOWN_RESULT, source: 'malformed-header-isSynthetic' };
    }
    synth = headerSynth === 'true';
  }
  if (synth === null) {
    return { ...UNKNOWN_RESULT, source: 'missing-isSynthetic' };
  }
  // R9: Validate header unconditionally when present
  if (headerSynth !== null && headerSynth !== 'true' && headerSynth !== 'false') {
    return { ...UNKNOWN_RESULT, source: 'malformed-header-isSynthetic' };
  }
  // Blocker B: If BOTH header and body provided isSynthetic, they must agree
  if (synthFromBody && headerSynth !== null) {
    const headerBool = headerSynth === 'true';
    if (synth !== headerBool) {
      return { ...UNKNOWN_RESULT, source: 'header-body-disagreement-isSynthetic' };
    }
  }

  // ── source ──
  let source: string | null = null;
  let sourceFromBody = false;
  if (bodyProv) {
    if (hasOwn(bodyProv, 'source')) {
      const bodySource = bodyProv.source;
      if (typeof bodySource !== 'string') {
        return { ...UNKNOWN_RESULT, source: 'malformed-source' };
      }
      if (bodySource.trim() === '') {
        return { ...UNKNOWN_RESULT, source: 'empty-source' };
      }
      source = bodySource;
      sourceFromBody = true;
    }
  }
  // If body didn't have it, check header
  if (source === null && headerSource !== null) {
    // Header is PRESENT — validate strictly: non-empty after trim
    if (headerSource.trim() === '') {
      return { ...UNKNOWN_RESULT, source: 'malformed-header-source' };
    }
    source = headerSource;
  }
  if (source === null) {
    return { ...UNKNOWN_RESULT, source: 'missing-source' };
  }
  // R9: Validate header unconditionally when present
  if (headerSource !== null && headerSource.trim() === '') {
    return { ...UNKNOWN_RESULT, source: 'malformed-header-source' };
  }
  // Blocker B: If BOTH header and body provided source, they must agree
  if (sourceFromBody && headerSource !== null && source !== headerSource) {
    return { ...UNKNOWN_RESULT, source: 'header-body-disagreement-source' };
  }

  return { environment: env, isSynthetic: synth, source, observedAt };
}

/**
 * Validate provenance for engine consumption.
 * Returns { valid: true } or { valid: false, reason: string }.
 * Unknown provenance is ALWAYS rejected.
 */
export function validateEngineProvenance(
  prov: { environment: 'live' | 'demo' | 'unknown'; isSynthetic: boolean; source: string; observedAt?: string },
): { valid: boolean; reason?: string } {
  // CR4.3A: Explicitly reject known-bad sources
  const CR43A_REJECT_SOURCES = new Set([
    'malformed-isSynthetic', 'missing-isSynthetic', 'empty-source',
    'invalid-observedAt', 'missing-observedAt', 'malformed-environment',
    'invalid-environment', 'malformed-source', 'missing-environment',
    'missing-source', 'header-body-disagreement-environment',
    'header-body-disagreement-isSynthetic', 'header-body-disagreement-source',
    'header-body-disagreement-observedAt',
    // R8: malformed header-specific rejection sources
    'malformed-header-environment', 'malformed-header-isSynthetic',
    'malformed-header-source', 'malformed-header-observedAt',
  ]);
  if (CR43A_REJECT_SOURCES.has(prov.source)) {
    return { valid: false, reason: `Provenance rejected by CR4.3A strict validation (source: ${prov.source})` };
  }
  if (prov.environment === 'unknown') {
    return { valid: false, reason: `Provenance is unknown (source: ${prov.source}) — cannot determine data origin` };
  }
  // CR4.3A: observedAt validation
  if (!prov.observedAt || !isValidObservedAt(prov.observedAt)) {
    return { valid: false, reason: 'Provenance observedAt is missing or invalid' };
  }
  if (prov.environment === 'demo' && !prov.isSynthetic) {
    return { valid: false, reason: 'Demo environment data must be marked synthetic' };
  }
  if (prov.environment === 'live' && prov.isSynthetic) {
    return { valid: false, reason: 'Live environment data cannot be synthetic' };
  }
  return { valid: true };
}

/**
 * Parse a single-price response from the Next.js market API.
 * Returns the price and provenance, or null if the response is unusable.
 */
export function parseSinglePriceResponse(
  headers: Headers | Record<string, string>,
  body: Record<string, unknown>,
): PriceWithProvenance | null {
  const price = typeof body.price === 'number' ? body.price
    : typeof body.currentPrice === 'number' ? body.currentPrice
    : null;

  if (price === null || price <= 0) return null;

  const prov = parseResponseProvenance(headers, body);
  return {
    price,
    environment: prov.environment,
    isSynthetic: prov.isSynthetic,
    source: prov.source,
    observedAt: prov.observedAt,
  };
}

/**
 * Parse a candle response from the Next.js market API.
 * Candles may be in a top-level 'candles' key or directly as an array.
 */
export function parseCandleResponse(
  headers: Headers | Record<string, string>,
  body: Record<string, unknown>,
): CandlesWithProvenance | null {
  let candles = body.candles as unknown[] | undefined;
  if (!Array.isArray(candles)) {
    if (Array.isArray(body)) {
      candles = body as unknown[];
    } else {
      return null;
    }
  }

  if (!Array.isArray(candles) || candles.length === 0) return null;

  const prov = parseResponseProvenance(headers, body);
  return { candles: candles as CandlesWithProvenance['candles'], provenance: prov };
}
