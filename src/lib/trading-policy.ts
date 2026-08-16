// ============================================================
// trading-policy.ts — Central server-side trading policy
// Phase 1: Emergency Containment (Correction Round 3)
//   - UNCONDITIONAL paper/demo-only: no env var can override
//   - Genuine timing-safe comparison: SHA-256 + timingSafeEqual
// ============================================================

import { NextResponse } from 'next/server';
import { createHash, timingSafeEqual as nodeTimingSafeEqual } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';

// ── Environment controls ──
// All default to false. These variables EXIST for future Phase 2+ use.
// During Phase 1, they CANNOT override containment.

function envBool(name: string): boolean {
  const raw = process.env[name];
  if (!raw) return false;
  const lower = raw.trim().toLowerCase();
  return lower === 'true' || lower === '1' || lower === 'yes';
}

/**
 * @deprecated Phase 1: This variable is read but NEVER consulted for
 * containment decisions. Live trading is unconditionally blocked.
 * Kept only for forward-compatibility and to avoid breaking imports.
 */
export const LIVE_TRADING_ENABLED = envBool('LIVE_TRADING_ENABLED');

/**
 * @deprecated Phase 1: This variable is read but NEVER consulted for
 * containment decisions. Credential intake is unconditionally blocked.
 */
export const BROKER_CREDENTIAL_INTAKE_ENABLED = envBool('BROKER_CREDENTIAL_INTAKE_ENABLED');

/**
 * @deprecated Phase 1: This variable is read but NEVER consulted for
 * containment decisions. Automated trading is unconditionally blocked.
 */
export const AUTOMATED_TRADING_ENABLED = envBool('AUTOMATED_TRADING_ENABLED');

/**
 * Internal service secret for engine/bot internal endpoints.
 * Must be set in production. Missing → all internal endpoints fail closed.
 */
export const INTERNAL_SERVICE_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';

// ── Error codes ──
export const CONTAINMENT_CODES = {
  PHASE1_LIVE_TRADING_DISABLED: 'PHASE1_LIVE_TRADING_DISABLED',
  LIVE_BLOCKED: 'LIVE_TRADING_DISABLED',
  CREDENTIAL_INTAKE_DISABLED: 'CREDENTIAL_INTAKE_DISABLED',
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  INTERNAL_AUTH_REQUIRED: 'INTERNAL_AUTH_REQUIRED',
  INTERNAL_AUTH_INVALID: 'INTERNAL_AUTH_INVALID',
  DEMO_ONLY: 'DEMO_ACCOUNT_REQUIRED',
  BROKER_CONNECTION_FAILED: 'BROKER_CONNECTION_FAILED',
  BROKER_CONFIG_INCOMPLETE: 'BROKER_CONFIG_INCOMPLETE',
  WEBHOOK_DISABLED: 'WEBHOOK_INGRESS_DISABLED',
  CONFIGURATION_REQUIRED: 'CONFIGURATION_REQUIRED',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

// ── Containment response helpers ──

interface ContainmentResponse {
  error: string;
  code: string;
  correlationId: string;
  remediationPhase: 'containment';
}

function containmentBody(code: string, message: string, correlationId: string): ContainmentResponse {
  return {
    error: message,
    code,
    correlationId,
    remediationPhase: 'containment',
  };
}

/**
 * Check if an account is explicitly a demo account.
 * ALL of the following must be true:
 *   - broker === 'demo'
 *   - accountType === 'demo'
 *   - isDemo === true (if the field exists)
 *
 * Null, missing, unknown, conflicting, or non-demo accounts
 * fail closed (return false).
 */
export function isExplicitlyDemo(account: {
  broker: string;
  accountType: string;
  isDemo?: boolean | null;
}): boolean {
  if (!account) return false;
    return account.broker === 'demo'
      && account.accountType === 'demo'
      && account.isDemo === true;
}

/**
 * Check if an account is a live account (non-demo).
 */
export function isLiveAccount(account: {
  broker: string;
  accountType: string;
  isDemo?: boolean | null;
}): boolean {
  return !isExplicitlyDemo(account);
}

/**
 * Enforce live-trading policy. Call this before any order-producing operation.
 *
 * Phase 1: UNCONDITIONAL containment.
 * - Environment variables (LIVE_TRADING_ENABLED, BROKER_CREDENTIAL_INTAKE_ENABLED,
 *   AUTOMATED_TRADING_ENABLED) CANNOT override this.
 * - Only explicitly demo accounts (broker=demo, accountType=demo, isDemo=true)
 *   are permitted.
 * - Null/undefined account → fail closed (CONFIGURATION_REQUIRED).
 * - Any non-demo account → fail closed (PHASE1_LIVE_TRADING_DISABLED).
 *
 * Returns null if the operation is permitted.
 * Returns a NextResponse if the operation must be blocked.
 */
export function enforceLiveTradingPolicy(
  account: { broker: string; accountType: string; isDemo?: boolean | null } | null | undefined,
  operation: string,
): { blocked: true; response: Response } | { blocked: false } {
  // If no account at all → fail closed (CONFIGURATION_REQUIRED)
  if (!account) {
    const correlationId = uuidv4();
    logSecurityEvent({
      eventType: 'POLICY_BLOCK',
      correlationId,
      reason: `Live trading policy check called with null/undefined account for operation: ${operation}`,
    });
    return {
      blocked: true,
      response: new Response(
        JSON.stringify(containmentBody(
          CONTAINMENT_CODES.CONFIGURATION_REQUIRED,
          `No account configuration found. ${operation} was not executed.`,
          correlationId,
        )),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    };
  }

  // Demo accounts are always allowed
  if (isExplicitlyDemo(account)) return { blocked: false };

  // Phase 1: ALL non-demo operations are unconditionally blocked.
  // No environment variable can override this during Phase 1.
  const correlationId = uuidv4();
  console.warn(
    `[CONTAINMENT] Phase 1: Live ${operation} blocked. code=${CONTAINMENT_CODES.PHASE1_LIVE_TRADING_DISABLED} ` +
    `cid=${correlationId} broker=${account.broker} type=${account.accountType}` +
    ` (LIVE_TRADING_ENABLED=${LIVE_TRADING_ENABLED}, BROKER_CREDENTIAL_INTAKE_ENABLED=${BROKER_CREDENTIAL_INTAKE_ENABLED})`
  );
  return {
    blocked: true,
    response: new Response(
      JSON.stringify(containmentBody(
        CONTAINMENT_CODES.PHASE1_LIVE_TRADING_DISABLED,
        `Phase 1 containment: live trading is not permitted. ${operation} was not executed. No funds were affected.`,
        correlationId,
      )),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      },
    ),
  };
}

// ── Genuine timing-safe comparison ──

/**
 * Constant-time string comparison using SHA-256 digests.
 * UTF-8 encodes each value, hashes with SHA-256 to produce fixed 32-byte
 * digests, then compares those digests with node:crypto.timingSafeEqual.
 *
 * This is safe for different-length strings because we compare the
 * fixed-length hash digests, not the raw strings.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  try {
    const encoder = new TextEncoder();
    const digestA = createHash('sha256').update(encoder.encode(a)).digest();
    const digestB = createHash('sha256').update(encoder.encode(b)).digest();
    return nodeTimingSafeEqual(digestA, digestB);
  } catch {
    return false;
  }
}

/**
 * @deprecated Use constantTimeEqual instead (synchronous, fixed-length SHA-256 based).
 */
export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  return constantTimeEqual(a, b);
}

/**
 * Validate internal service authentication.
 * Returns null if valid, or a 401/503 Response if not.
 * Fail closed: missing secret → 503, invalid secret → 401.
 */
export function enforceInternalAuth(req: Request): Response | null {
  if (!INTERNAL_SERVICE_SECRET) {
    const correlationId = uuidv4();
    logSecurityEvent({
      eventType: 'INTERNAL_AUTH_FAILURE',
      correlationId,
      reason: 'INTERNAL_SERVICE_SECRET not configured — failing closed',
    });
    return new Response(
      JSON.stringify({
        error: 'Internal service authentication not configured.',
        code: CONTAINMENT_CODES.INTERNAL_AUTH_REQUIRED,
        correlationId,
        remediationPhase: 'containment',
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const provided = req.headers.get('x-internal-service-secret') || '';
  if (!constantTimeEqual(provided, INTERNAL_SERVICE_SECRET)) {
    const correlationId = uuidv4();
    logSecurityEvent({
      eventType: 'INTERNAL_AUTH_FAILURE',
      correlationId,
      reason: 'Invalid or missing internal service credential',
    });
    return new Response(
      JSON.stringify({
        error: 'Invalid or missing internal service credential.',
        code: CONTAINMENT_CODES.INTERNAL_AUTH_INVALID,
        correlationId,
        remediationPhase: 'containment',
      }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    );
  }

  return null;
}

// ── Phase 1 credential intake enforcement ──

/**
 * Check if credential intake is blocked during Phase 1.
 * Phase 1: ALWAYS blocked for non-demo accounts, regardless of env vars.
 */
export function enforcePhase1CredentialIntake(
  broker: string,
  accountType: string,
  isDemo?: boolean | null | undefined,
): { blocked: false } | { blocked: true; response: Response } {
  // Only allow when ALL three conditions are met: broker==='demo' AND accountType==='demo' AND isDemo===true
  const isExplicitlyDemoAccount = broker === 'demo' && accountType === 'demo' && isDemo === true;
  if (isExplicitlyDemoAccount) return { blocked: false };

  // Fail closed: block everything else (including broker='demo' with isDemo not true)
  const correlationId = uuidv4();
  logSecurityEvent({
    eventType: 'CREDENTIAL_INTAKE_BLOCKED',
    correlationId,
    reason: `Phase 1: Credential intake blocked (fail closed). broker=${broker} type=${accountType} isDemo=${isDemo}`,
  });
  return {
    blocked: true,
    response: new Response(
      JSON.stringify({
        error: 'Phase 1 containment: broker credential intake is not permitted.',
        code: CONTAINMENT_CODES.PHASE1_LIVE_TRADING_DISABLED,
        correlationId,
        remediationPhase: 'containment',
      }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    ),
  };
}

// ── Safe DTO: strip credentials from account objects ──

export function safeAccountDTO(account: Record<string, unknown>): Record<string, unknown> {
  const { apiKey, apiSecret, passphrase, ...safe } = account;
  return safe;
}

/**
 * Map an array of accounts to safe DTOs.
 */
export function safeAccountDTOs(accounts: Record<string, unknown>[]): Record<string, unknown>[] {
  return accounts.map(safeAccountDTO);
}

// ── Demo provenance marker ──

export const DEMO_PROVENANCE = {
  environment: 'demo',
  isSynthetic: true,
  source: 'fovi-demo-generator',
} as const;

export const DEMO_PROVENANCE_HEADER = {
  'x-environment': 'demo',
  'x-synthetic': 'true',
  'x-data-source': 'fovi-demo-generator',
  'x-demo': 'true',
} as const;

/**
 * Create a demo-tagged JSON response.
 * Merges data with DEMO_PROVENANCE and includes provenance headers.
 */
export function demoResponse(
  data: Record<string, unknown>,
  _req?: Request,
  statusCode?: number,
): NextResponse {
  const merged = { ...data, ...DEMO_PROVENANCE };
  const headers: Record<string, string> = {
    'x-environment': 'demo',
    'x-synthetic': 'true',
    'x-data-source': 'fovi-demo-generator',
    'x-demo': 'true',
  };
  if (statusCode) {
    return NextResponse.json(merged, { status: statusCode, headers });
  }
  return NextResponse.json(merged, { headers });
}

// ── Structured security event logging ──

/**
 * Log security events as structured JSON to console.warn.
 * All fields containing 'secret', 'key', 'token', or 'password'
 * (case-insensitive check on field name) will have their values redacted.
 */
export function logSecurityEvent(params: {
  eventType: string;
  correlationId?: string;
  route?: string;
  userId?: string;
  identifier?: string;
  result?: string;
  reason?: string;
  [key: string]: unknown;
}): void {
  const redactedParams: Record<string, unknown> = { timestamp: new Date().toISOString() };

  for (const [key, value] of Object.entries(params)) {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey.includes('secret') ||
      lowerKey.includes('key') ||
      lowerKey.includes('token') ||
      lowerKey.includes('password')
    ) {
      redactedParams[key] = '[REDACTED]';
    } else {
      redactedParams[key] = value;
    }
  }

  console.warn(JSON.stringify({ type: 'SECURITY_EVENT', ...redactedParams }));
}
