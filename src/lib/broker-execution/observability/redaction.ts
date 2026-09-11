// ============================================================
// redaction.ts — Pure credential-redaction helper shared by the
// audit trail, the audit repository and telemetry.
//
// Extracted as a standalone module (no imports) so persistence
// and observability layers can share it without circular imports.
//
// SAFETY CONSTRAINT:
//   Recursively redact known sensitive fields from any object.
//   Produces a NEW object — the input is never mutated.
//   Same patterns as redactForTelemetry() in telemetry.ts and
//   logSecurityEvent() in trading-policy.ts.
//
// CORRECTION ROUND 2 (item 4) — sanitizeBrokerAuditInput():
//   A SINGLE pure sanitizer used by EVERY audit persistence path
//   (transactional tx.brokerExecutionAudit.create(...) writes AND
//   the standalone AuditRepository.append()). It redacts nested
//   credentials, normalizes IP metadata, drops malformed forwarded
//   data, and caps field lengths. Being pure and synchronous, it
//   is safe to call INSIDE a transaction without opening any
//   second database operation.
// ============================================================

// ── Sensitive field names for redaction ──

/**
 * Field names that must NEVER appear in audit records or telemetry.
 * Case-insensitive substring match on the field name.
 *
 * Mirrors logSecurityEvent() in trading-policy.ts which checks:
 *   secret, key, token, password
 *
 * Extended for broker-specific credential fields that
 * safeAccountDTO() strips: apiKey, apiSecret, passphrase.
 */
const SENSITIVE_FIELD_PATTERNS = [
  'apikey',
  'apisecret',
  'passphrase',
  'token',
  'refreshtoken',
  'password',
  'secret',
] as const;

/**
 * Check if a field name matches a sensitive pattern.
 * Case-insensitive substring match.
 */
function isSensitiveFieldName(name: string): boolean {
  const lower = name.toLowerCase();
  return SENSITIVE_FIELD_PATTERNS.some((pattern) => lower.includes(pattern));
}

/**
 * Recursively redact known sensitive fields from an object.
 * Produces a NEW object — the input is never mutated.
 *
 * This is functionally identical to redactForTelemetry() but
 * maintained as a separate export for semantic clarity:
 *   - redactForTelemetry() → for telemetry events (ephemeral)
 *   - redactForAudit() → for audit records (persistent)
 *
 * Both use the same SENSITIVE_FIELD_PATTERNS and same algorithm.
 * This ensures no credential can leak into either system
 * regardless of which redaction function is called.
 */
export function redactForAudit(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(redactForAudit);
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (isSensitiveFieldName(key)) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      result[key] = redactForAudit(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

// ============================================================
// sanitizeBrokerAuditInput() — CORRECTION ROUND 2, item 4
// ============================================================

/** Length caps for audit fields (protects against oversized/abusive inputs). */
const AUDIT_FIELD_LENGTH_LIMITS = {
  /** Identifier-ish fields (actor/tenant/account/provider/command ids, states). */
  identifier: 256,
  /** Free-form reason text. */
  reason: 2048,
  /** Audit action name. */
  action: 128,
  /** IP strings. */
  ip: 64,
  /** User-Agent strings. */
  userAgent: 256,
} as const;

/**
 * A syntactically plausible IPv4 address (a.b.c.d, each 0-255).
 * Deliberately STRICT — anything else is dropped, not guessed.
 */
function isPlausibleIpv4(value: string): boolean {
  const parts = value.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^[0-9]{1,3}$/.test(part)) return false;
    const n = Number(part);
    return n >= 0 && n <= 255;
  });
}

/**
 * A syntactically plausible IPv6 address (hex groups separated by
 * ':', optionally containing one '::'). Strict-ish — sufficient to
 * distinguish real addresses from injected garbage.
 */
function isPlausibleIpv6(value: string): boolean {
  if (!/^[0-9a-fA-F:]+$/.test(value)) return false;
  if (value.length > 45) return false;
  const doubleColonCount = (value.match(/::/g) ?? []).length;
  if (doubleColonCount > 1) return false;
  const groups = value.split(':');
  return groups.length >= 2 && groups.length <= 9;
}

/** Normalize a single candidate IP string; null when malformed. */
function normalizeIpString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const candidate = value.trim();
  if (candidate === '') return null;
  if (candidate.length > AUDIT_FIELD_LENGTH_LIMITS.ip) return null;
  if (isPlausibleIpv4(candidate) || isPlausibleIpv6(candidate)) {
    return candidate.toLowerCase();
  }
  return null;
}

/**
 * Normalize x-forwarded-for style chains: only the FIRST entry is
 * ever kept, and only when it parses as a plausible IP. Malformed
 * forwarded data (injection attempts, lists of garbage, headers
 * copied with whitespace tricks) is DROPPED to null — never
 * persisted raw.
 */
function normalizeForwardedFor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const first = value.split(',')[0]?.trim() ?? '';
  return normalizeIpString(first);
}

/** Truncate a string to a cap (appending no content — hard cap). */
function truncate(value: string, cap: number): string {
  return value.length <= cap ? value : value.slice(0, cap);
}

/** Sanitize an unknown scalar to a length-capped string or null. */
function sanitizeScalar(value: unknown, cap: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return truncate(value, cap);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

/**
 * Sanitize the ipMetadata payload of an audit entry.
 *
 * Accepts an object containing network metadata (ip, forwardedIp,
 * userAgent, and similar). Produces a NEW object where:
 *   - `ip` is a single normalized, syntactically validated address
 *     (first entry of x-forwarded-for when a chain was supplied)
 *   - `userAgent` is truncated to 256 characters
 *   - known forwarded-for fields are normalized through the same
 *     single-entry IP validation
 *   - every other string value is still credential-redacted and
 *     length-capped
 *   - malformed/non-object input is DROPPED entirely (null)
 */
function sanitizeIpMetadata(ipMetadata: unknown): Record<string, unknown> | null {
  if (ipMetadata === null || ipMetadata === undefined) return null;
  if (typeof ipMetadata !== 'object' || Array.isArray(ipMetadata)) return null;

  const redacted = redactForAudit(ipMetadata) as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(redacted)) {
    const lower = key.toLowerCase();
    if (
      lower === 'ip' ||
      lower === 'clientip' ||
      lower === 'remoteaddress' ||
      lower === 'remoteaddr' ||
      lower === 'forwardedip'
    ) {
      result[key] = normalizeIpString(value);
      continue;
    }
    if (lower === 'xforwardedfor' || lower === 'forwardedfor' || lower === 'forwarded') {
      result[key] = normalizeForwardedFor(value);
      continue;
    }
    if (lower === 'useragent' || lower === 'ua') {
      const ua = sanitizeScalar(value, AUDIT_FIELD_LENGTH_LIMITS.userAgent);
      result[key] = ua;
      continue;
    }
    // Generic value: keep only JSON-safe scalars, capped.
    if (value === null || value === undefined) {
      result[key] = value === undefined ? null : value;
    } else if (typeof value === 'object') {
      result[key] = redactForAudit(value);
    } else {
      result[key] = sanitizeScalar(value, AUDIT_FIELD_LENGTH_LIMITS.reason);
    }
  }
  return result;
}

/** Input shape accepted by the unified audit sanitizer. */
export interface BrokerAuditInput {
  actorId?: string | null;
  tenantId?: string | null;
  accountId?: string | null;
  providerId?: string | null;
  action?: string | null;
  previousState?: string | null;
  resultingState?: string | null;
  reason?: string | null;
  correlationId?: string | null;
  commandId?: string | null;
  ipMetadata?: unknown;
}

/** Sanitized, persistence-ready audit input (all fields explicit). */
export interface SanitizedBrokerAuditInput {
  actorId: string;
  tenantId: string;
  accountId: string | null;
  providerId: string | null;
  action: string;
  previousState: string | null;
  resultingState: string | null;
  reason: string | null;
  correlationId: string | null;
  commandId: string | null;
  ipMetadata: Record<string, unknown> | null;
}

/**
 * The single unified audit-input sanitizer (correction round 2,
 * item 4).
 *
 * PURE and SYNCHRONOUS: performs no I/O and no DB access, so it is
 * safe to call inside a transaction immediately before
 * `tx.brokerExecutionAudit.create(...)` — it never opens a second
 * database operation and cannot stall or deadlock the transaction.
 *
 * Guarantees:
 *   - Credential-bearing field names (apiKey, apiSecret,
 *     passphrase, token, refreshToken, password, secret...) are
 *     recursively redacted from `reason`/`ipMetadata` values —
 *     including NESTED objects.
 *   - IP metadata is normalized: a single validated address,
 *     malformed forwarded chains dropped, UA truncated.
 *   - Every string field is capped to a fixed maximum length.
 *   - Non-scalar garbage is dropped (null) rather than coerced.
 *   - The INPUT is never mutated; a new object is returned.
 *
 * EVERY audit persistence path — transactional
 * (command/connection/credential/kill-switch/reconciliation) and
 * standalone (AuditRepository.append) — MUST pass its input
 * through this function. Tests assert the transactional and
 * standalone paths use the SAME sanitizer output shape.
 */
export function sanitizeBrokerAuditInput(input: BrokerAuditInput): SanitizedBrokerAuditInput {
  const source = (input ?? {}) as BrokerAuditInput;
  return {
    actorId: sanitizeScalar(source.actorId, AUDIT_FIELD_LENGTH_LIMITS.identifier) ?? '',
    tenantId: sanitizeScalar(source.tenantId, AUDIT_FIELD_LENGTH_LIMITS.identifier) ?? '',
    accountId: sanitizeScalar(source.accountId, AUDIT_FIELD_LENGTH_LIMITS.identifier),
    providerId: sanitizeScalar(source.providerId, AUDIT_FIELD_LENGTH_LIMITS.identifier),
    action: sanitizeScalar(source.action, AUDIT_FIELD_LENGTH_LIMITS.action) ?? '',
    previousState: sanitizeScalar(source.previousState, AUDIT_FIELD_LENGTH_LIMITS.identifier),
    resultingState: sanitizeScalar(source.resultingState, AUDIT_FIELD_LENGTH_LIMITS.identifier),
    reason: sanitizeScalar(source.reason, AUDIT_FIELD_LENGTH_LIMITS.reason),
    correlationId: sanitizeScalar(source.correlationId, AUDIT_FIELD_LENGTH_LIMITS.identifier),
    commandId: sanitizeScalar(source.commandId, AUDIT_FIELD_LENGTH_LIMITS.identifier),
    ipMetadata: sanitizeIpMetadata(source.ipMetadata),
  };
}
