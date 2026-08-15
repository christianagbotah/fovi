// ============================================================
// provenance.ts — Shared provenance model for market data
// Phase 1 CR4: Typed provenance with validation and fail-closed parsing.
// ============================================================

export interface Provenance {
  environment: 'live' | 'demo' | 'unknown';
  isSynthetic: boolean;
  source: string;
  observedAt: string;
}

export const LIVE_PROVENANCE: Provenance = {
  environment: 'live',
  isSynthetic: false,
  source: 'broker-api',
  observedAt: new Date().toISOString(),
};

export const DEMO_PROVENANCE: Provenance = {
  environment: 'demo',
  isSynthetic: true,
  source: 'fovi-demo-generator',
  observedAt: new Date().toISOString(),
};

export const UNKNOWN_PROVENANCE: Provenance = {
  environment: 'unknown',
  isSynthetic: true,
  source: 'unknown',
  observedAt: new Date().toISOString(),
};

export function provenanceHeaders(p: Provenance): Record<string, string> {
  return {
    'x-environment': p.environment,
    'x-synthetic': String(p.isSynthetic),
    'x-data-source': p.source,
    'x-demo': String(p.environment === 'demo'),
  };
}

/**
 * Parse provenance from HTTP response headers and optionally a JSON body.
 * Body provenance may be at top level or nested under a "provenance" key.
 * If headers and body disagree, returns UNKNOWN_PROVENANCE (fail closed).
 * Missing provenance → UNKNOWN_PROVENANCE.
 */
export function parseProvenance(
  headers: Headers,
  body?: Record<string, unknown>,
): Provenance {
  const headerEnv = headers.get('x-environment');
  const headerSynth = headers.get('x-synthetic');
  const headerSource = headers.get('x-data-source');

  // Extract body provenance (top-level or nested)
  const bodyProv = (body?.provenance as Record<string, unknown> | undefined) || body;
  const bodyEnv = bodyProv?.environment as string | undefined;
  const bodySynth = bodyProv?.isSynthetic;
  const bodySource = bodyProv?.source as string | undefined;

  // Disagreement → fail closed
  if (headerEnv && bodyEnv && headerEnv !== bodyEnv) return UNKNOWN_PROVENANCE;
  if (headerSynth && bodySynth !== undefined && headerSynth !== String(bodySynth)) return UNKNOWN_PROVENANCE;
  if (headerSource && bodySource && headerSource !== bodySource) return UNKNOWN_PROVENANCE;

  const env = (bodyEnv || headerEnv) as Provenance['environment'] || 'unknown';
  const synth = bodySynth !== undefined ? Boolean(bodySynth) : headerSynth === 'true';
  const source = bodySource || headerSource || 'unknown';

  // Only 'live' and 'demo' are valid; everything else → unknown
  if (!['live', 'demo'].includes(env)) return UNKNOWN_PROVENANCE;

  return { environment: env, isSynthetic: synth, source, observedAt: new Date().toISOString() };
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
  if (p.environment === 'demo' && !p.isSynthetic)
    return { valid: false, reason: 'Demo data must be synthetic' };
  if (p.isSynthetic && p.environment === 'live')
    return { valid: false, reason: 'Live data cannot be synthetic' };
  return { valid: true };
}
