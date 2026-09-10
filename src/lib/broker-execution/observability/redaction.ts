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
