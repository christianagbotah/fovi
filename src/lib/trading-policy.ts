// ============================================================
// trading-policy.ts — Central server-side trading policy
// Phase 1: Emergency Containment (Correction Round 1)
// ============================================================

import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { timingSafeEqual as nodeTimingSafeEqual } from 'node:crypto';

// ── Environment controls ──
// Both default to false. Missing, empty, or unrecognized values → false.

function envBool(name: string): boolean {
  const raw = process.env[name];
  if (!raw) return false;
  const lower = raw.trim().toLowerCase();
  return lower === 'true' || lower === '1' || lower === 'yes';
}

/**
 * Master kill-switch for all live-money order placement.
 * When false (default), every order-producing code path must reject
 * live accounts with CONTAINMENT_LIVE_BLOCKED.
 */
export const LIVE_TRADING_ENABLED = envBool('LIVE_TRADING_ENABLED');

/**
 * Separate control for broker credential intake.
 * When false (default), connecting non-demo accounts is blocked.
 */
export const BROKER_CREDENTIAL_INTAKE_ENABLED = envBool('BROKER_CREDENTIAL_INTAKE_ENABLED');

/**
 * Separate control for automated trading (bot engine execution).
 * When false (default), the auto-trade engine skips cycle execution.
 */
export const AUTOMATED_TRADING_ENABLED = envBool('AUTOMATED_TRADING_ENABLED');

/**
 * Internal service secret for engine/bot internal endpoints.
 * Must be set in production. Missing → all internal endpoints fail closed.
 */
export const INTERNAL_SERVICE_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';

// ── Error codes ──
export const CONTAINMENT_CODES = {
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
 * ONLY accounts where BOTH broker='demo' AND accountType='demo' are demo.
 */
export function isExplicitlyDemo(account: {
  broker: string;
  accountType: string;
}): boolean {
  return account.broker === 'demo' && account.accountType === 'demo';
}

/**
 * Check if an account is a live account (non-demo).
 */
export function isLiveAccount(account: {
  broker: string;
  accountType: string;
}): boolean {
  return !isExplicitlyDemo(account);
}

/**
 * Enforce live-trading policy. Call this before any order-producing operation.
 *
 * When account is null/undefined → CONFIGURATION_REQUIRED (fail closed).
 * Returns null if the operation is permitted.
 * Returns a NextResponse if the operation must be blocked.
 */
export function enforceLiveTradingPolicy(
  account: { broker: string; accountType: string } | null | undefined,
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

  // Live account: check master switch
  if (!LIVE_TRADING_ENABLED) {
    const correlationId = uuidv4();
    console.warn(
      `[CONTAINMENT] Live ${operation} blocked. code=${CONTAINMENT_CODES.LIVE_BLOCKED} ` +
      `cid=${correlationId} broker=${account.broker} type=${account.accountType}`
    );
    return {
      blocked: true,
      response: new Response(
        JSON.stringify(containmentBody(
          CONTAINMENT_CODES.LIVE_BLOCKED,
          `Live trading is temporarily disabled. ${operation} was not executed. No funds were affected.`,
          correlationId,
        )),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    };
  }

  return { blocked: false };
}

// ── Timing-safe comparison helpers ──

/**
 * Constant-time string comparison (byte-by-byte, no length leak).
 * This is the synchronous version used internally by enforceInternalAuth.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Timing-safe string comparison using node:crypto.timingSafeEqual.
 * Async because we import from node:crypto dynamically for compatibility.
 */
export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  try {
    return nodeTimingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
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
  req?: Request,
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
 * TEMPORARY CONTROL: Log security events as structured JSON to console.warn.
 * This is a stopgap until durable audit logging is implemented.
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
