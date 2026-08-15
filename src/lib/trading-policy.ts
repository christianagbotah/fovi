// ============================================================
// trading-policy.ts — Central server-side trading policy
// Phase 1: Emergency Containment
// ============================================================

import { v4 as uuidv4 } from 'uuid';

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
 * Only accounts where BOTH broker='demo' AND accountType='demo' are demo.
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
 * Returns null if the operation is permitted.
 * Returns a NextResponse if the operation must be blocked.
 */
export function enforceLiveTradingPolicy(
  account: { broker: string; accountType: string } | null | undefined,
  operation: string,
): { blocked: true; response: Response } | { blocked: false } {
  // If no account at all, allow (will fail downstream with proper error)
  if (!account) return { blocked: false };

  // Demo accounts are always allowed
  if (isExplicitlyDemo(account)) return { blocked: false };

  // Live account: check master switch
  if (!LIVE_TRADING_ENABLED) {
    const correlationId = uuidv4();
    // Audit: log the blocked attempt (redacted, no secrets)
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

/**
 * Timing-safe string comparison to prevent timing attacks on secrets.
 */
export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  if (a.length !== b.length) return false;
  if (a.length === 0) return true;
  // Use Node.js built-in timingSafeEqual for compatibility
  const nodeCrypto = await import('node:crypto');
  try {
    return nodeCrypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

/**
 * Validate internal service authentication.
 * Returns null if valid, or a 401/403 Response if not.
 */
export function enforceInternalAuth(req: Request): Response | null {
  if (!INTERNAL_SERVICE_SECRET) {
    return new Response(
      JSON.stringify({
        error: 'Internal service authentication not configured.',
        code: CONTAINMENT_CODES.INTERNAL_AUTH_REQUIRED,
        correlationId: uuidv4(),
        remediationPhase: 'containment',
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const provided = req.headers.get('x-internal-service-secret') || '';
  if (!constantTimeEqual(provided, INTERNAL_SERVICE_SECRET)) {
    return new Response(
      JSON.stringify({
        error: 'Invalid or missing internal service credential.',
        code: CONTAINMENT_CODES.INTERNAL_AUTH_INVALID,
        correlationId: uuidv4(),
        remediationPhase: 'containment',
      }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    );
  }

  return null;
}

/**
 * Constant-time string comparison (works on all Node.js versions).
 * Compares byte-by-byte to avoid timing side-channels.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
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
} as const;
