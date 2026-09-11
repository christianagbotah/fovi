// ============================================================
// reconciliation.ts — State reconciliation between command
// records and broker-side order/position state
//
// CONTAINMENT CONSTRAINT:
//   Reconciliation is a read-only diagnostic operation. It
//   compares the execution boundary's command state against
//   the broker's actual order/position state to detect
//   discrepancies.
//
//   Reconciliation does NOT modify trading state. Detected
//   discrepancies are logged to the audit trail and flagged
//   for manual or automated resolution. During Phase 1,
//   reconciliation only runs against demo accounts (enforced
//   by enforceLiveTradingPolicy in trading-policy.ts).
//
//   The RECONCILING state in state-machine.ts is entered
//   when a command in FAILED or UNKNOWN state needs its
//   broker-side state verified.
// ============================================================

// ── Reconciliation status ──

/**
 * Status of a reconciliation run.
 */
export const ReconciliationStatus = {
  IDLE: 'IDLE',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  PARTIAL: 'PARTIAL',
} as const;

export type ReconciliationStatus =
  (typeof ReconciliationStatus)[keyof typeof ReconciliationStatus];

// ── Discrepancy types ──

/**
 * Classification of discrepancies detected during reconciliation.
 *
 * These represent all the ways the execution boundary's state
 * can diverge from the broker's actual state:
 *   - MISSING_COMMAND: Broker has an order we didn't submit
 *   - MISSING_BROKER_ORDER: We have a submitted command but
 *     the broker has no corresponding order
 *   - STATE_MISMATCH: Our command state disagrees with the
 *     broker's order state
 *   - FILL_MISMATCH: Fill quantity or price disagrees
 *   - POSITION_MISMATCH: Position state disagrees
 *   - DUPLICATE_FILL: Broker reported a fill we already processed
 *   - OUT_OF_ORDER: Events arrived in unexpected sequence
 *   - STALE_STATE: Our state hasn't been updated within
 *     the expected window
 */
export const ReconciliationDiscrepancyType = {
  MISSING_COMMAND: 'MISSING_COMMAND',
  MISSING_BROKER_ORDER: 'MISSING_BROKER_ORDER',
  STATE_MISMATCH: 'STATE_MISMATCH',
  FILL_MISMATCH: 'FILL_MISMATCH',
  POSITION_MISMATCH: 'POSITION_MISMATCH',
  DUPLICATE_FILL: 'DUPLICATE_FILL',
  OUT_OF_ORDER: 'OUT_OF_ORDER',
  STALE_STATE: 'STALE_STATE',
} as const;

export type ReconciliationDiscrepancyType =
  (typeof ReconciliationDiscrepancyType)[keyof typeof ReconciliationDiscrepancyType];

// ── Discrepancy severity ──

/**
 * Severity levels for reconciliation discrepancies.
 * CRITICAL discrepancies may trigger automatic kill switches.
 */
export type DiscrepancySeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

// ── Discrepancy record ──

/**
 * A single discrepancy detected during reconciliation.
 * Includes enough context to diagnose and resolve the issue
 * without exposing credentials or sensitive data.
 */
export interface ReconciliationDiscrepancy {
  /** Type of discrepancy */
  type: ReconciliationDiscrepancyType;
  /** Our command ID, if applicable */
  commandId: string | null;
  /** Broker's order ID, if applicable */
  brokerOrderId: string | null;
  /** Human-readable description of the discrepancy */
  description: string;
  /** Severity level */
  severity: DiscrepancySeverity;
  /** ISO-8601 timestamp when the discrepancy was detected */
  detectedAt: string;
}

// ── Reconciliation result ──

/**
 * Complete result of a reconciliation run.
 * Summarizes the comparison between command records and
 * broker-side state, including all detected discrepancies
 * and aggregate statistics.
 */
export interface ReconciliationResult {
  /** Overall status of the reconciliation run */
  status: ReconciliationStatus;
  /** All discrepancies detected (may be empty if states agree) */
  discrepancies: ReconciliationDiscrepancy[];
  /** ISO-8601 timestamp when reconciliation completed */
  reconciledAt: string | null;
  /** Wall-clock duration of the reconciliation run in milliseconds */
  durationMs: number;
  /** Number of commands evaluated */
  commandCount: number;
  /** Number of broker-side orders evaluated */
  brokerOrderCount: number;
  /** Number of commands that matched broker state exactly */
  matchCount: number;
  /** Number of commands with discrepancies */
  mismatchCount: number;
}
