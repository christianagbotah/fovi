// ============================================================
// state-machine.ts — Execution state machine for command lifecycle
//
// CONTAINMENT CONSTRAINT:
//   The BLOCKED state is a non-terminal state from which no
//   execution transition is possible. Commands enter BLOCKED
//   when:
//     - enforceLiveTradingPolicy() returns blocked:true
//     - A kill switch is active for the command's scope
//     - Capability check fails (provider doesn't support the
//       command type)
//   The only exit from BLOCKED is back to VALIDATING if the
//   blocking condition is resolved (e.g., kill switch
//   deactivated, Phase 2 enables live trading).
//   During Phase 1, commands for non-demo accounts will
//   always transition CREATED → VALIDATING → BLOCKED and
//   remain there indefinitely.
// ============================================================

// ── Execution states ──

/**
 * Lifecycle states for an execution command.
 *
 * Flow:
 *   CREATED → VALIDATING → BLOCKED | APPROVED
 *   APPROVED → QUEUED → SUBMITTING → ACKNOWLEDGED
 *   ACKNOWLEDGED → PARTIALLY_FILLED → FILLED
 *   ACKNOWLEDGED → FILLED
 *   ACKNOWLEDGED → REJECTED
 *   Any non-terminal → CANCELLED | EXPIRED | FAILED
 *   FAILED → RECONCILING → (resolved or terminal)
 *
 * Terminal states: FILLED, REJECTED, CANCELLED, EXPIRED
 * Recovery states: RECONCILING (from FAILED or UNKNOWN)
 * Containment state: BLOCKED (holds command indefinitely)
 */
export const ExecutionState = {
  CREATED: 'CREATED',
  VALIDATING: 'VALIDATING',
  BLOCKED: 'BLOCKED',
  APPROVED: 'APPROVED',
  QUEUED: 'QUEUED',
  SUBMITTING: 'SUBMITTING',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  PARTIALLY_FILLED: 'PARTIALLY_FILLED',
  FILLED: 'FILLED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
  UNKNOWN: 'UNKNOWN',
  RECONCILING: 'RECONCILING',
  FAILED: 'FAILED',
} as const;

export type ExecutionState =
  (typeof ExecutionState)[keyof typeof ExecutionState];

// ── Allowed transitions map ──

/**
 * Defines the valid state transitions for the execution state machine.
 * Each key is a source state; its value is the set of states
 * that can be reached from that source in one transition.
 *
 * BLOCKED can only transition to VALIDATING (re-evaluation after
 * blocking condition resolves). During Phase 1, this transition
 * will never succeed for non-demo accounts because
 * enforceLiveTradingPolicy() unconditionally blocks them.
 */
export const ALLOWED_TRANSITIONS: ReadonlyMap<ExecutionState, ReadonlySet<ExecutionState>> = new Map([
  [ExecutionState.CREATED, new Set([ExecutionState.VALIDATING])],
  [ExecutionState.VALIDATING, new Set([ExecutionState.BLOCKED, ExecutionState.APPROVED, ExecutionState.FAILED])],
  [ExecutionState.BLOCKED, new Set([ExecutionState.VALIDATING])],
  [ExecutionState.APPROVED, new Set([ExecutionState.QUEUED, ExecutionState.CANCELLED, ExecutionState.FAILED])],
  [ExecutionState.QUEUED, new Set([ExecutionState.SUBMITTING, ExecutionState.CANCELLED, ExecutionState.EXPIRED, ExecutionState.FAILED])],
  [ExecutionState.SUBMITTING, new Set([ExecutionState.ACKNOWLEDGED, ExecutionState.REJECTED, ExecutionState.FAILED])],
  [ExecutionState.ACKNOWLEDGED, new Set([
    ExecutionState.PARTIALLY_FILLED,
    ExecutionState.FILLED,
    ExecutionState.REJECTED,
    ExecutionState.CANCELLED,
    ExecutionState.EXPIRED,
    ExecutionState.FAILED,
  ])],
  [ExecutionState.PARTIALLY_FILLED, new Set([
    ExecutionState.FILLED,
    ExecutionState.CANCELLED,
    ExecutionState.EXPIRED,
    ExecutionState.FAILED,
  ])],
  [ExecutionState.FAILED, new Set([ExecutionState.RECONCILING])],
  [ExecutionState.UNKNOWN, new Set([ExecutionState.RECONCILING])],
  [ExecutionState.RECONCILING, new Set([
    ExecutionState.FILLED,
    ExecutionState.PARTIALLY_FILLED,
    ExecutionState.REJECTED,
    ExecutionState.CANCELLED,
    ExecutionState.FAILED,
  ])],
  // Terminal states have no outgoing transitions
  [ExecutionState.FILLED, new Set()],
  [ExecutionState.REJECTED, new Set()],
  [ExecutionState.CANCELLED, new Set()],
  [ExecutionState.EXPIRED, new Set()],
]);

// ── Terminal states set ──

/**
 * States from which no further transitions are possible.
 * Once a command reaches a terminal state, its record is
 * immutable (for audit integrity).
 */
export const TERMINAL_STATES: ReadonlySet<ExecutionState> = new Set([
  ExecutionState.FILLED,
  ExecutionState.REJECTED,
  ExecutionState.CANCELLED,
  ExecutionState.EXPIRED,
]);

// ── Helper functions ──

/**
 * Check if a state is terminal (no further transitions possible).
 */
export function isTerminalState(state: ExecutionState): boolean {
  return TERMINAL_STATES.has(state);
}

/**
 * Check if a transition from `from` to `to` is valid according
 * to the ALLOWED_TRANSITIONS map.
 *
 * Returns false for:
 *   - Transitions from terminal states
 *   - Transitions not in the allowed set
 *   - Same-state "transitions" (no-ops are not transitions)
 */
export function isValidTransition(from: ExecutionState, to: ExecutionState): boolean {
  if (from === to) return false;
  const allowed = ALLOWED_TRANSITIONS.get(from);
  if (!allowed) return false;
  return allowed.has(to);
}

// ── State transition record ──

/**
 * Record of a single state transition in a command's lifecycle.
 * Stored in the ExecutionStateRecord for full audit trail.
 */
export interface StateTransition {
  /** Source state */
  from: ExecutionState;
  /** Destination state */
  to: ExecutionState;
  /** ISO-8601 timestamp of the transition */
  timestamp: string;
  /** Human-readable reason for the transition */
  reason: string;
  /** ID of the actor (user, system, kill switch) that caused the transition */
  actorId: string;
}

// ── Execution state record ──

/**
 * Complete state machine record for an execution command.
 * Maintained by the execution boundary for the full lifecycle
 * of a command from CREATED to a terminal state.
 *
 * The transitions array provides an immutable audit trail.
 * Once a command reaches a terminal state, this record
 * must not be modified.
 */
export interface ExecutionStateRecord {
  /** The command ID (stable UUID from BaseCommand.commandId) */
  commandId: string;
  /** Current state of the command */
  currentState: ExecutionState;
  /** Previous state (null if command is in CREATED) */
  previousState: ExecutionState | null;
  /** Ordered list of all state transitions */
  transitions: StateTransition[];
  /** ISO-8601 timestamp of the most recent transition */
  lastTransitionAt: string;
  /** Correlation ID for tracing (from BaseCommand.correlationId) */
  correlationId: string;
}
