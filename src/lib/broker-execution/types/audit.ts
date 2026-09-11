// ============================================================
// audit.ts — Audit trail types for the broker-execution boundary
//
// REDACTION SAFETY CONSTRAINT:
//   AuditRecord MUST NOT contain any credential fields
//   (apiKey, apiSecret, passphrase, token, password, etc.).
//   This is enforced structurally — these fields simply do not
//   exist on the AuditRecord type. Even if a credential
//   accidentally leaks into the log context, the audit
//   serializer must strip it before persistence.
//
//   This design mirrors the safeAccountDTO() pattern in
//   trading-policy.ts, which strips apiKey, apiSecret, and
//   passphrase from account objects before returning them
//   to the client. The audit trail applies the same principle
//   at the logging layer.
//
//   The ipMetadata field is optional and should be populated
//   only for actions that originate from external requests
//   (not for internal/system-initiated actions).
// ============================================================

import type { ExecutionState } from './state-machine';

// ── Audit action enumeration ──

/**
 * All auditable actions within the broker-execution boundary.
 * Each action corresponds to a significant state change or
 * decision point in the execution pipeline.
 */
export const AuditAction = {
  /** Broker connection established */
  CONNECT: 'CONNECT',
  /** Broker connection closed */
  DISCONNECT: 'DISCONNECT',
  /** Command submitted to the execution boundary */
  COMMAND_SUBMIT: 'COMMAND_SUBMIT',
  /** Command validation completed (may pass or fail) */
  COMMAND_VALIDATE: 'COMMAND_VALIDATE',
  /** Command blocked by policy, kill switch, or capability check */
  COMMAND_BLOCK: 'COMMAND_BLOCK',
  /** Command approved for execution */
  COMMAND_APPROVE: 'COMMAND_APPROVE',
  /** Kill switch activated (manual or automatic trigger) */
  KILL_SWITCH_ACTIVATE: 'KILL_SWITCH_ACTIVATE',
  /** Kill switch deactivated */
  KILL_SWITCH_DEACTIVATE: 'KILL_SWITCH_DEACTIVATE',
  /** Reconciliation run completed */
  RECONCILE: 'RECONCILE',
  /** Broker credential rotated (Phase 2+ only) */
  CREDENTIAL_ROTATE: 'CREDENTIAL_ROTATE',
  /** Broker credential revoked */
  CREDENTIAL_REVOKE: 'CREDENTIAL_REVOKE',
  /** Trading policy decision (enforceLiveTradingPolicy result) */
  POLICY_DECISION: 'POLICY_DECISION',
  /** Capability query (discover() or capability check) */
  CAPABILITY_QUERY: 'CAPABILITY_QUERY',
} as const;

export type AuditAction =
  (typeof AuditAction)[keyof typeof AuditAction];

// ── IP metadata ──

/**
 * Network-level metadata for audit records originating
 * from external requests. Populated from request headers
 * by the execution boundary's request handler.
 *
 * Intentionally minimal — no user-agent, no referrer,
 * no geo-location. Just enough for security analysis
 * (rate limiting, anomaly detection).
 */
export interface IpMetadata {
  /** Client IP address (from X-Forwarded-For or socket) */
  ip: string;
  /** Forwarding proxy chain (if behind CDN/load balancer) */
  forwardedFor?: string;
}

// ── Audit record ──

/**
 * An immutable audit record for a broker-execution boundary action.
 *
 * REDACTION SAFETY:
 *   This type MUST NOT contain credential fields (apiKey, apiSecret,
 *   passphrase, token, password, secret, etc.). These fields are
 *   structurally excluded from the type definition. The audit
 *   serializer must additionally strip any credential-like fields
 *   that accidentally appear in the reason or other string fields.
 *
 *   This mirrors the safeAccountDTO() pattern in trading-policy.ts
 *   which strips apiKey, apiSecret, and passphrase from account
 *   objects before returning them to the client.
 *
 * IMMUTABILITY:
 *   Audit records must not be modified after creation. This
 *   ensures the audit trail is tamper-evident for compliance
 *   and incident investigation.
 */
export interface AuditRecord {
  /** Unique audit record identifier */
  id: string;
  /** ID of the actor performing the action (user ID or 'system') */
  actorId: string;
  /** Tenant/user ID scope */
  tenantId: string;
  /** Trading account ID, if applicable */
  accountId: string | null;
  /** Broker provider ID, if applicable */
  providerId: string | null;
  /** The action being audited */
  action: AuditAction;
  /** State before the action (e.g., command's previous ExecutionState) */
  previousState: ExecutionState | null;
  /** State after the action (e.g., command's new ExecutionState) */
  resultingState: ExecutionState | null;
  /** Human-readable reason for the action */
  reason: string | null;
  /** Correlation ID for cross-referencing with commands */
  correlationId: string | null;
  /** Command ID, if this audit record relates to a specific command */
  commandId: string | null;
  /** ISO-8601 timestamp of the action */
  timestamp: string;
  /** Network metadata (only for external request-triggered actions) */
  ipMetadata: IpMetadata | null;
}
