// ============================================================
// idempotency.ts — Command deduplication and idempotency tracking
//
// CONTAINMENT CONSTRAINT:
//   The idempotency layer sits between command creation and
//   the state machine. It prevents duplicate commands from
//   reaching the adapter, which would result in duplicate
//   executions (double-spending).
//
//   Deduplication is based on:
//     1. idempotencyKey: Caller-supplied key (exact match)
//     2. requestFingerprint: Hash of command parameters
//        (catches semantically identical commands with
//        different idempotency keys)
//
//   During Phase 1, all non-demo commands are blocked before
//   reaching this layer. For demo commands, idempotency
//   prevents duplicate paper trades.
// ============================================================

import type { ExecutionState } from './state-machine';

// ── Idempotency record ──

/**
 * Tracks a command's idempotency key and deduplication state.
 * Stored in the idempotency store (database or in-memory)
 * for the lifetime of the command plus a retention window.
 *
 * Fields:
 *   - idempotencyKey: From BaseCommand.idempotencyKey
 *   - requestFingerprint: Deterministic hash of the command's
 *     parameters (symbol, side, size, etc.) to catch
 *     semantically duplicate commands with different keys
 *   - deduplicateCount: Number of duplicate submissions that
 *     were rejected because of this record
 */
export interface IdempotencyRecord {
  /** Unique record identifier */
  id: string;
  /** The command ID (from BaseCommand.commandId) */
  commandId: string;
  /** The idempotency key (from BaseCommand.idempotencyKey) */
  idempotencyKey: string;
  /** Tenant/user ID (from BaseCommand.tenantId) */
  tenantId: string;
  /** Trading account ID (from BaseCommand.accountId) */
  accountId: string;
  /** Broker provider ID (from BaseCommand.providerId) */
  providerId: string;
  /**
   * Deterministic hash of the command's parameters.
   * Used to detect semantically identical commands that
   * were submitted with different idempotency keys.
   * Generated from a stable serialization of symbol,
   * side, size, type, price, etc.
   */
  requestFingerprint: string;
  /** Current execution state of the command */
  state: ExecutionState;
  /** ISO-8601 timestamp when the record was created */
  createdAt: string;
  /** ISO-8601 timestamp when the record was last accessed */
  lastSeenAt: string;
  /** Number of duplicate submissions rejected by this record */
  deduplicateCount: number;
}

// ── Idempotency evaluation result ──

/**
 * Result of checking a command against the idempotency store.
 *
 * - isDuplicate: true if a matching record exists
 * - existingRecord: The matching record if isDuplicate is true
 * - allowed: true if the command should proceed despite
 *   being a duplicate (e.g., the original command FAILED
 *   and the caller is retrying)
 *
 * A command is NOT allowed to proceed if:
 *   - isDuplicate is true AND
 *   - The existing record's state is non-terminal AND non-failed
 *   (i.e., the original command is still in progress)
 *
 * A command IS allowed to proceed if:
 *   - isDuplicate is false (no match), OR
 *   - The existing record reached a terminal FAILED or REJECTED
 *   state (caller is retrying a failed command)
 */
export interface IdempotencyResult {
  /** Whether a matching record was found in the store */
  isDuplicate: boolean;
  /** The matching record, if isDuplicate is true */
  existingRecord: IdempotencyRecord | null;
  /**
   * Whether the command should be allowed to proceed.
   * False means the command should be rejected as a duplicate.
   */
  allowed: boolean;
}
