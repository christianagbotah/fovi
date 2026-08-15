// ============================================================
// market-provenance.ts — Startup-free provenance parsing for engine
// Phase 1 CR4.1:
//   Exports pure functions for parsing provenance from HTTP responses.
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

/**
 * Parse provenance from HTTP response headers and optional JSON body.
 * Used by the engine to determine if market data is live, demo, or unknown.
 *
 * Fail-closed rules:
 * - Missing provenance → unknown
 * - Malformed values → unknown
 * - Header/body disagreement → unknown
 * - Non-empty array without provenance → unknown (NOT live)
 */
export function parseResponseProvenance(
  headers: Headers | Record<string, string>,
  body?: Record<string, unknown>,
): { environment: 'live' | 'demo' | 'unknown'; isSynthetic: boolean; source: string; observedAt?: string } {
  const getHeader = (name: string): string | null => {
    if (headers instanceof Headers) return headers.get(name);
    return (headers as Record<string, string>)[name.toLowerCase()] ?? null;
  };

  const headerEnv = getHeader('x-environment');
  const headerSynth = getHeader('x-synthetic');
  const headerSource = getHeader('x-data-source');

  // Extract body provenance (top-level or nested under 'provenance' key)
  const bodyProv = (body?.provenance as Record<string, unknown> | undefined) || body;
  const bodyEnv = bodyProv?.environment as string | undefined;
  const bodySynth = bodyProv?.isSynthetic;
  const bodySource = bodyProv?.source as string | undefined;
  const bodyObserved = bodyProv?.observedAt as string | undefined;

  // Missing provenance entirely → unknown
  if (!headerEnv && !bodyEnv) {
    return { environment: 'unknown', isSynthetic: true, source: 'missing' };
  }

  // Disagreement between headers and body → unknown (fail closed)
  if (headerEnv && bodyEnv && headerEnv !== bodyEnv) {
    return { environment: 'unknown', isSynthetic: true, source: 'mismatch' };
  }
  if (headerSynth && bodySynth !== undefined && headerSynth !== String(bodySynth)) {
    return { environment: 'unknown', isSynthetic: true, source: 'mismatch' };
  }
  if (headerSource && bodySource && headerSource !== bodySource) {
    return { environment: 'unknown', isSynthetic: true, source: 'mismatch' };
  }

  const env = (bodyEnv || headerEnv) as 'live' | 'demo' | 'unknown';

  // Only 'live' and 'demo' are valid; everything else → unknown
  if (env !== 'live' && env !== 'demo') {
    return { environment: 'unknown', isSynthetic: true, source: 'invalid' };
  }

  const synth = bodySynth !== undefined ? Boolean(bodySynth) : headerSynth === 'true';
  const source = bodySource || headerSource || 'unknown';
  const observedAt = bodyObserved;

  return { environment: env, isSynthetic: synth, source, observedAt };
}

/**
 * Validate provenance for engine consumption.
 * Returns { valid: true } or { valid: false, reason: string }.
 * Unknown provenance is ALWAYS rejected.
 */
export function validateEngineProvenance(
  prov: { environment: 'live' | 'demo' | 'unknown'; isSynthetic: boolean; source: string },
): { valid: boolean; reason?: string } {
  if (prov.environment === 'unknown') {
    return { valid: false, reason: `Provenance is unknown (source: ${prov.source}) — cannot determine data origin` };
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
  // Candles may be nested under 'candles' key (new format) or be the array itself
  let candles = body.candles as unknown[] | undefined;
  if (!Array.isArray(candles)) {
    // Try body itself as an array (legacy format)
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
