// ============================================================
// telemetry.ts — Structured telemetry for broker-execution
//
// SAFETY CONSTRAINT (mirrors trading-policy.ts logSecurityEvent):
//   No credentials EVER appear in telemetry events.
//   redactForTelemetry() recursively strips known sensitive
//   fields (apiKey, apiSecret, passphrase, token, refreshToken,
//   password, secret) from any object before emission.
//
//   This mirrors:
//     - logSecurityEvent() in trading-policy.ts which redacts
//       fields containing 'secret', 'key', 'token', 'password'
//     - safeAccountDTO() which strips apiKey, apiSecret, passphrase
//
//   All events include: timestamp, correlationId, tenantId
//   Output: console-based structured JSON (log aggregation ready)
// ============================================================

import type {
  AuditAction,
  ExecutionState,
  ReconciliationDiscrepancy,
} from '../types';

// ── Sensitive field names for redaction ──

/**
 * Field names that must NEVER appear in telemetry output.
 * Case-insensitive substring match on the field name.
 * Mirrors the pattern in logSecurityEvent() (trading-policy.ts)
 * which checks for: secret, key, token, password.
 *
 * Extended here to include broker-specific credential fields
 * that safeAccountDTO() strips: apiKey, apiSecret, passphrase.
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

// ── Recursive redaction ──

/**
 * Recursively redact known sensitive fields from an object.
 * Produces a NEW object — the input is never mutated.
 *
 * Redaction rules (mirrors trading-policy.ts patterns):
 *   - Fields whose names contain (case-insensitive) any of:
 *     apiKey, apiSecret, passphrase, token, refreshToken,
 *     password, secret
 *   - Are replaced with '[REDACTED]'
 *   - Applied recursively to nested objects and arrays
 *
 * This is the telemetry equivalent of safeAccountDTO() in
 * trading-policy.ts, which strips apiKey, apiSecret, passphrase
 * from account objects. redactForTelemetry goes further by:
 *   - Operating on arbitrary objects (not just account DTOs)
 *   - Recursing into nested structures
 *   - Handling arrays
 */
export function redactForTelemetry(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;

  // Primitives pass through unchanged
  if (typeof obj !== 'object') return obj;

  // Arrays: redact each element
  if (Array.isArray(obj)) {
    return obj.map(redactForTelemetry);
  }

  // Objects: redact sensitive fields, recurse on others
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (isSensitiveFieldName(key)) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      result[key] = redactForTelemetry(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

// ── Telemetry event types ──

/**
 * Base fields present on every telemetry event.
 * CRITICAL: No credential fields exist here.
 * tenantId identifies the tenant; credentials are NEVER included.
 */
interface TelemetryEventBase {
  /** ISO-8601 timestamp */
  timestamp: string;
  /** Correlation ID for cross-referencing */
  correlationId: string;
  /** Tenant/user ID scope */
  tenantId: string;
}

// ── Connection events ──

export interface ConnectionTelemetryEvent extends TelemetryEventBase {
  kind: 'connection';
  /** connect | disconnect | reconnect */
  action: 'connect' | 'disconnect' | 'reconnect';
  /** Broker provider ID */
  providerId: string;
  /** Account ID (if applicable) */
  accountId?: string;
  /** Connection state after the action */
  state: string;
  /** Error details if the action failed */
  error?: string;
}

// ── Quote freshness ──

export interface QuoteFreshnessTelemetryEvent extends TelemetryEventBase {
  kind: 'quote_freshness';
  /** Broker provider ID */
  providerId: string;
  /** Trading symbol */
  symbol: string;
  /** Age of the quote in milliseconds */
  ageMs: number;
  /** Whether the quote is considered stale */
  isStale: boolean;
}

// ── Adapter errors ──

export interface AdapterErrorTelemetryEvent extends TelemetryEventBase {
  kind: 'adapter_error';
  /** Broker provider ID */
  providerId: string;
  /** Normalized error code */
  errorCode: string;
  /** Normalized error message (redacted) */
  errorMessage: string;
  /** Whether the error is transient */
  isTransient: boolean;
  /** Whether the error is a rate limit */
  isRateLimit: boolean;
  /** Whether the error is an auth failure */
  isAuthFailure: boolean;
}

// ── Validation failures ──

export interface ValidationFailureTelemetryEvent extends TelemetryEventBase {
  kind: 'validation_failure';
  /** Command ID that failed validation */
  commandId: string;
  /** Validation errors */
  errors: string[];
  /** Validation warnings */
  warnings: string[];
}

// ── Blocked commands ──

export interface BlockedCommandTelemetryEvent extends TelemetryEventBase {
  kind: 'command_blocked';
  /** Command ID that was blocked */
  commandId: string;
  /** Reason the command was blocked */
  reason: string;
  /** Containment code (from CONTAINMENT_CODES pattern) */
  code?: string;
  /** Gate that blocked the command */
  gate?: string;
}

// ── Idempotency hits ──

export interface IdempotencyHitTelemetryEvent extends TelemetryEventBase {
  kind: 'idempotency_hit';
  /** Command ID that was a duplicate */
  commandId: string;
  /** Idempotency key that matched */
  idempotencyKey: string;
  /** Whether the duplicate was allowed (retry of failed command) */
  allowed: boolean;
}

// ── Reconciliation discrepancies ──

export interface ReconciliationDiscrepancyTelemetryEvent extends TelemetryEventBase {
  kind: 'reconciliation_discrepancy';
  /** Discrepancy type */
  discrepancyType: string;
  /** Command ID (if applicable) */
  commandId: string | null;
  /** Broker order ID (if applicable) */
  brokerOrderId: string | null;
  /** Human-readable description */
  description: string;
  /** Severity level */
  severity: string;
}

// ── Gate decisions ──

export interface GateDecisionTelemetryEvent extends TelemetryEventBase {
  kind: 'gate_decision';
  /** Command ID being evaluated */
  commandId: string;
  /** Name of the policy gate (e.g., 'live_trading_policy', 'kill_switch', 'capability') */
  gateName: string;
  /** Decision: 'approved' | 'blocked' */
  decision: 'approved' | 'blocked';
  /** Reason for the decision */
  reason?: string;
}

// ── Latency measurements ──

export interface LatencyTelemetryEvent extends TelemetryEventBase {
  kind: 'latency';
  /** Label identifying the measured operation */
  label: string;
  /** Measured duration in milliseconds */
  durationMs: number;
  /** Whether the operation succeeded */
  success: boolean;
}

// ── Kill-switch activation ──

export interface KillSwitchTelemetryEvent extends TelemetryEventBase {
  kind: 'kill_switch';
  /** Kill switch ID */
  killSwitchId: string;
  /** 'activated' | 'deactivated' */
  action: 'activated' | 'deactivated';
  /** Kill switch scope */
  scope: string;
  /** Scope identifier */
  scopeId: string;
  /** Reason for the action */
  reason?: string;
  /** Actor who triggered the action */
  activatedBy?: string;
}

// ── Union of all telemetry event types ──

export type TelemetryEvent =
  | ConnectionTelemetryEvent
  | QuoteFreshnessTelemetryEvent
  | AdapterErrorTelemetryEvent
  | ValidationFailureTelemetryEvent
  | BlockedCommandTelemetryEvent
  | IdempotencyHitTelemetryEvent
  | ReconciliationDiscrepancyTelemetryEvent
  | GateDecisionTelemetryEvent
  | LatencyTelemetryEvent
  | KillSwitchTelemetryEvent;

// ── Telemetry emission ──

/**
 * Emit a structured telemetry event as JSON to console.info.
 *
 * SAFETY:
 *   - The event is redacted via redactForTelemetry() before emission
 *   - No credentials can appear in the output
 *   - Mirrors logSecurityEvent() pattern from trading-policy.ts
 *     which uses console.warn(JSON.stringify(...)) for structured output
 *
 * Output format:
 *   { "type": "TELEMETRY", "kind": "...", "timestamp": "...", ... }
 *
 * Suitable for log aggregation (Datadog, CloudWatch, ELK, etc.)
 */
export function emitTelemetry(event: TelemetryEvent): void {
  const redacted = redactForTelemetry(event) as TelemetryEvent;
  console.info(JSON.stringify({ type: 'TELEMETRY', ...redacted }));
}

// ── Latency measurement wrapper ──

/**
 * Wrap a function and measure its execution time.
 * Emits a latency telemetry event automatically.
 *
 * @param label - Label identifying the measured operation
 * @param fn - The function to measure
 * @param context - Additional context (correlationId, tenantId)
 * @returns The result of fn()
 *
 * The latency event is emitted AFTER the function completes
 * (whether it succeeds or throws). If fn() throws, the
 * latency event has success: false and the error is re-thrown.
 */
export async function measureLatency<T>(
  label: string,
  fn: () => Promise<T>,
  context: { correlationId: string; tenantId: string },
): Promise<T> {
  const start = performance.now();
  let success = true;
  try {
    return await fn();
  } catch (error) {
    success = false;
    throw error;
  } finally {
    const durationMs = performance.now() - start;
    emitTelemetry({
      kind: 'latency',
      timestamp: new Date().toISOString(),
      correlationId: context.correlationId,
      tenantId: context.tenantId,
      label,
      durationMs,
      success,
    });
  }
}

/**
 * Synchronous variant of measureLatency.
 */
export function measureLatencySync<T>(
  label: string,
  fn: () => T,
  context: { correlationId: string; tenantId: string },
): T {
  const start = performance.now();
  let success = true;
  try {
    return fn();
  } catch (error) {
    success = false;
    throw error;
  } finally {
    const durationMs = performance.now() - start;
    emitTelemetry({
      kind: 'latency',
      timestamp: new Date().toISOString(),
      correlationId: context.correlationId,
      tenantId: context.tenantId,
      label,
      durationMs,
      success,
    });
  }
}

// ── Quote freshness tracking ──

/** Staleness threshold in milliseconds (default: 5 seconds) */
const DEFAULT_STALE_THRESHOLD_MS = 5_000;

/**
 * Record quote freshness as a telemetry event.
 * Tracks how stale a quote is relative to the current time.
 *
 * @param providerId - Broker provider that supplied the quote
 * @param symbol - Trading symbol (e.g., 'EUR/USD')
 * @param age - Age of the quote in milliseconds
 * @param context - Telemetry context (correlationId, tenantId)
 * @param staleThresholdMs - Threshold above which a quote is considered stale
 */
export function recordQuoteFreshness(
  providerId: string,
  symbol: string,
  ageMs: number,
  context: { correlationId: string; tenantId: string },
  staleThresholdMs: number = DEFAULT_STALE_THRESHOLD_MS,
): void {
  emitTelemetry({
    kind: 'quote_freshness',
    timestamp: new Date().toISOString(),
    correlationId: context.correlationId,
    tenantId: context.tenantId,
    providerId,
    symbol,
    ageMs,
    isStale: ageMs > staleThresholdMs,
  });
}

// ── Gate decision recording ──

/**
 * Record a policy gate decision as a telemetry event.
 * Called by the execution boundary's policy gate evaluation.
 *
 * @param commandId - The command being evaluated
 * @param gateName - Name of the gate (e.g., 'live_trading_policy', 'kill_switch', 'capability')
 * @param decision - The gate's decision
 * @param context - Telemetry context
 */
export function recordGateDecision(
  commandId: string,
  gateName: string,
  decision: 'approved' | 'blocked',
  context: { correlationId: string; tenantId: string; reason?: string },
): void {
  emitTelemetry({
    kind: 'gate_decision',
    timestamp: new Date().toISOString(),
    correlationId: context.correlationId,
    tenantId: context.tenantId,
    commandId,
    gateName,
    decision,
    reason: context.reason,
  });
}

// ── Idempotency hit recording ──

/**
 * Record an idempotency duplicate detection as a telemetry event.
 * Called when the idempotency gate detects a duplicate command.
 *
 * @param commandId - The duplicate command's ID
 * @param idempotencyKey - The idempotency key that matched
 * @param allowed - Whether the duplicate was allowed (retry of failed command)
 * @param context - Telemetry context
 */
export function recordIdempotencyHit(
  commandId: string,
  idempotencyKey: string,
  allowed: boolean,
  context: { correlationId: string; tenantId: string },
): void {
  emitTelemetry({
    kind: 'idempotency_hit',
    timestamp: new Date().toISOString(),
    correlationId: context.correlationId,
    tenantId: context.tenantId,
    commandId,
    idempotencyKey,
    allowed,
  });
}

// ── Reconciliation discrepancy recording ──

/**
 * Record a reconciliation discrepancy as a telemetry event.
 * Called by the reconciler when it detects a state mismatch.
 *
 * @param discrepancy - The reconciliation discrepancy
 * @param context - Telemetry context
 */
export function recordReconciliationDiscrepancy(
  discrepancy: ReconciliationDiscrepancy,
  context: { correlationId: string; tenantId: string },
): void {
  emitTelemetry({
    kind: 'reconciliation_discrepancy',
    timestamp: new Date().toISOString(),
    correlationId: context.correlationId,
    tenantId: context.tenantId,
    discrepancyType: discrepancy.type,
    commandId: discrepancy.commandId,
    brokerOrderId: discrepancy.brokerOrderId,
    description: discrepancy.description,
    severity: discrepancy.severity,
  });
}
