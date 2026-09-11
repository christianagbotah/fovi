// ============================================================
// kill-switches.ts — Emergency stop and circuit breaker types
//
// CONTAINMENT CONSTRAINT:
//   Kill switches are the highest-priority execution gate.
//   When a kill switch is ACTIVE for a given scope:
//     - All commands in that scope transition to BLOCKED
//       (state-machine.ts)
//     - No execution methods on the BrokerAdapter are called
//     - The BLOCKED state persists until the kill switch is
//       explicitly deactivated
//   Kill switches override all other gates:
//     - Even if enforceLiveTradingPolicy() would allow the
//       operation (demo account), an active kill switch
//       blocks it
//     - Even if capabilities are present, an active kill
//       switch blocks execution
//   The emergencyReadOnly flag, when true, suppresses even
//   read-only operations (quotes, positions, orders) for
//   the affected scope.
// ============================================================

import type { ExecutionCommand } from './commands';

// ── Kill switch scope ──

/**
 * Scope of a kill switch, from broadest to narrowest:
 *   GLOBAL   — blocks all execution across all tenants/accounts
 *   TENANT   — blocks execution for a specific tenant/user
 *   ACCOUNT  — blocks execution for a specific trading account
 *   PROVIDER — blocks execution for a specific broker provider
 *
 * Broader scopes take precedence. If both GLOBAL and TENANT
 * switches are active, GLOBAL is reported as the blocking reason.
 */
export const KillSwitchScope = {
  GLOBAL: 'GLOBAL',
  TENANT: 'TENANT',
  ACCOUNT: 'ACCOUNT',
  PROVIDER: 'PROVIDER',
} as const;

export type KillSwitchScope =
  (typeof KillSwitchScope)[keyof typeof KillSwitchScope];

// ── Kill switch state ──

/**
 * Lifecycle states of a kill switch.
 *
 * ACTIVE: Currently blocking execution.
 * INACTIVE: Not blocking. Can be activated.
 * TRIGGERED: Automatically activated by a trigger condition
 *   (e.g., max drawdown exceeded, error rate threshold).
 *   Functionally equivalent to ACTIVE but distinguishes
 *   manual activation from automatic trigger.
 */
export const KillSwitchState = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  TRIGGERED: 'TRIGGERED',
} as const;

export type KillSwitchState =
  (typeof KillSwitchState)[keyof typeof KillSwitchState];

// ── Kill switch ──

/**
 * A kill switch instance that can block execution within its scope.
 *
 * When state is ACTIVE or TRIGGERED:
 *   - All execution commands in scope are BLOCKED
 *   - If emergencyReadOnly is true, even read-only operations
 *     (quotes, positions, orders) are suppressed
 *   - The kill switch must be explicitly deactivated before
 *     execution can resume
 *
 * Kill switches are evaluated by the execution boundary BEFORE
 * any command enters the VALIDATING state. This ensures they
 * are the first gate in the execution pipeline.
 */
export interface KillSwitch {
  /** Unique kill switch identifier */
  id: string;
  /** Scope of the kill switch */
  scope: KillSwitchScope;
  /**
   * Identifier within the scope:
   *   - GLOBAL: 'global' (constant)
   *   - TENANT: userId
   *   - ACCOUNT: accountId
   *   - PROVIDER: providerId
   */
  scopeId: string;
  /** Current state of the kill switch */
  state: KillSwitchState;
  /** ISO-8601 timestamp when the switch was activated (null if INACTIVE) */
  activatedAt: string | null;
  /** ISO-8601 timestamp when the switch was deactivated (null if still active) */
  deactivatedAt: string | null;
  /** ID of the user or system that activated the switch */
  activatedBy: string | null;
  /** Human-readable reason for activation */
  reason: string | null;
  /**
   * When true, suppresses even read-only operations (quotes,
   * positions, orders) for the affected scope. This is the
   * most aggressive containment level.
   */
  emergencyReadOnly: boolean;
}

// ── Kill switch manager interface ──

/**
 * Interface for managing kill switches across all scopes.
 *
 * The execution boundary calls evaluate() before processing
 * any command. If a kill switch is active for the command's
 * scope, the command transitions to BLOCKED.
 *
 * Implementation must be thread-safe and support concurrent
 * activate/deactivate operations without race conditions.
 */
export interface KillSwitchManager {
  /**
   * Evaluate whether a command should be blocked by any
   * active kill switch. Checks GLOBAL → TENANT → ACCOUNT →
   * PROVIDER scopes in precedence order.
   *
   * Returns the blocking kill switch if any, or null if
   * the command is not blocked.
   */
  evaluate(command: ExecutionCommand): KillSwitch | null;

  /**
   * Activate a kill switch for the given scope.
   * If already active, updates the reason and activatedBy.
   * Logs the activation to the audit trail (audit.ts).
   *
   * @throws if the caller is not authorized to activate
   *   kill switches (enforced by getUserIdSync)
   */
  activate(params: {
    scope: KillSwitchScope;
    scopeId: string;
    activatedBy: string;
    reason: string;
    emergencyReadOnly?: boolean;
  }): Promise<KillSwitch>;

  /**
   * Deactivate a kill switch.
   * If already inactive, this is a no-op.
   * Logs the deactivation to the audit trail (audit.ts).
   *
   * @throws if the caller is not authorized to deactivate
   *   kill switches
   */
  deactivate(params: {
    killSwitchId: string;
    deactivatedBy: string;
    reason: string;
  }): Promise<KillSwitch>;

  /**
   * Get the current status of a specific kill switch.
   */
  getStatus(killSwitchId: string): Promise<KillSwitch | null>;

  /**
   * List all kill switches, optionally filtered by scope.
   */
  getAll(filter?: { scope?: KillSwitchScope; scopeId?: string }): Promise<KillSwitch[]>;
}
