// ============================================================
// policy-gate.ts — Central execution policy gate
//
// CONTAINMENT CONSTRAINT:
//   This is the GATEKEEPER of the broker-execution boundary.
//   Every execution command MUST pass through this gate before
//   reaching the state machine or broker adapter.
//
//   EVALUATION ORDER (fail-fast, first failure stops):
//     1. enforceLiveTradingPolicy() — UNCONDITIONAL containment
//        from trading-policy.ts. This is the FIRST check. No
//        bypass. No override. No env var. No admin privilege.
//     2. Environment gate — execution must be enabled
//     3. Tenant gate — tenant must have execution permission
//     4. Account gate — account must be explicitly demo in Phase 1
//     5. Provider gate — provider must be registered and active
//     6. Mode gate — account mode must permit the command type
//     7. Connection state gate — broker must be connected
//     8. Feature flag gate — required feature flags must be on
//     9. Authorization gate — caller must be authorized
//    10. Health gate — broker connection must be healthy
//    11. Kill switch gate — no active kill switch for scope
//
//   DEFAULT: DENY. No execution is allowed unless ALL gates pass.
//   Even if all gates 2–11 pass, if gate 1 (enforceLiveTradingPolicy)
//   throws or returns blocked:true, the decision is DENY.
//
//   NO BYPASS: There is no admin override, env var override, or
//   any mechanism to skip the policy gate. This is a hard
//   architectural constraint for Phase 1.
// ============================================================

import { enforceLiveTradingPolicy, CONTAINMENT_CODES, logSecurityEvent } from '@/lib/trading-policy';
import type {
  ExecutionCommand,
  ExecutionState,
} from '@/lib/broker-execution/types';
import {
  ExecutionState as ExecutionStateEnum,
} from '@/lib/broker-execution/types';
import type { KillSwitch } from '@/lib/broker-execution/types/kill-switches';
import { KillSwitchState as KillSwitchStateEnum } from '@/lib/broker-execution/types/kill-switches';
import type { BrokerConnectionState } from '@/lib/broker-execution/types/broker-adapter';
import { BrokerConnectionState as BrokerConnectionStateEnum } from '@/lib/broker-execution/types/broker-adapter';
import { v4 as uuidv4 } from 'uuid';

// ── Policy decision result ──

/**
 * The outcome of evaluating an execution command against all policy gates.
 *
 * - allowed: true ONLY if every gate in the evaluation chain passes.
 *   Default is false (deny-by-default).
 *
 * - reason: Human-readable explanation of why the command was
 *   allowed or denied. For denials, includes which gate failed.
 *
 * - containmentCode: Machine-readable code from CONTAINMENT_CODES
 *   (trading-policy.ts) or a policy-gate-specific code. Used for
 *   metrics, alerting, and client error responses.
 *
 * - evaluatedGates: Ordered list of gate names that were evaluated.
 *   Stops at the first failing gate. If all pass, contains all
 *   gate names. Useful for debugging and audit.
 */
export interface PolicyDecision {
  /** Whether the command is allowed to proceed */
  allowed: boolean;
  /** Human-readable reason for the decision */
  reason: string;
  /** Machine-readable containment/policy code */
  containmentCode: string;
  /** Ordered list of evaluated gate names */
  evaluatedGates: string[];
}

// ── Policy evaluation context ──

/**
 * Full context required by the policy gate to make a decision.
 * Every field must be populated by the caller before invoking
 * evaluateExecutionPolicy(). Missing/null fields cause the
 * corresponding gate to fail (fail-closed).
 */
export interface PolicyEvaluationContext {
  /** Current broker connection state */
  connectionState: BrokerConnectionState;
  /** Account mode (e.g., 'demo', 'live') */
  accountMode: string;
  /** Whether the account is explicitly demo */
  isDemo: boolean;
  /** Feature flags relevant to execution */
  featureFlags: Record<string, boolean>;
  /** Kill switch status for the command's scope (null if none active) */
  killSwitchStatus: KillSwitch | null;
  /** Broker health status (isHealthy, latency, error rate) */
  healthStatus: {
    isHealthy: boolean;
    latencyMs: number;
    errorRate: number;
  } | null;
  /** Tenant-level permissions */
  tenantPermissions: {
    canExecute: boolean;
    canTrade: boolean;
    isSuspended: boolean;
  };
  /** Authorization result for the caller */
  authorizationResult: {
    isAuthorized: boolean;
    reason?: string;
  };
  /** Account information for enforceLiveTradingPolicy() */
  account: {
    broker: string;
    accountType: string;
    isDemo?: boolean | null;
  } | null;
  /** Whether execution is enabled in the current environment */
  executionEnabled: boolean;
  /** Whether the provider is registered and active */
  providerActive: boolean;
  /**
   * CORRECTION ROUND: server-side provenance for the submission.
   * actorId: the authenticated user (from the verified proxy identity).
   * connectionId: the PostgreSQL BrokerConnection id this command
   * targets (required for the ExecutionCommandRecord FK).
   * ipMetadata: sanitized network metadata for audit records.
   * These fields are populated by the API boundary from trusted
   * records — never from caller-supplied values.
   */
  actorId?: string;
  connectionId?: string;
  ipMetadata?: unknown;
}

// ── Gate-specific containment codes ──

/**
 * Containment codes specific to the policy gate.
 * These supplement the codes in trading-policy.ts CONTAINMENT_CODES.
 */
export const POLICY_GATE_CODES = {
  ENVIRONMENT_EXECUTION_DISABLED: 'ENVIRONMENT_EXECUTION_DISABLED',
  TENANT_NOT_AUTHORIZED: 'TENANT_NOT_AUTHORIZED',
  TENANT_SUSPENDED: 'TENANT_SUSPENDED',
  TENANT_CANNOT_EXECUTE: 'TENANT_CANNOT_EXECUTE',
  TENANT_CANNOT_TRADE: 'TENANT_CANNOT_TRADE',
  ACCOUNT_NOT_DEMO: 'ACCOUNT_NOT_DEMO',
  PROVIDER_NOT_ACTIVE: 'PROVIDER_NOT_ACTIVE',
  ACCOUNT_MODE_INVALID: 'ACCOUNT_MODE_INVALID',
  CONNECTION_NOT_READY: 'CONNECTION_NOT_READY',
  FEATURE_FLAG_DISABLED: 'FEATURE_FLAG_DISABLED',
  AUTHORIZATION_FAILED: 'AUTHORIZATION_FAILED',
  BROKER_UNHEALTHY: 'BROKER_UNHEALTHY',
  KILL_SWITCH_ACTIVE: 'KILL_SWITCH_ACTIVE',
  KILL_SWITCH_TRIGGERED: 'KILL_SWITCH_TRIGGERED',
  ALL_GATES_PASSED: 'ALL_GATES_PASSED',
} as const;

// ── Gate names (for evaluatedGates trail) ──

const GATE_NAMES = {
  TRADING_POLICY: 'trading-policy',
  ENVIRONMENT: 'environment',
  TENANT: 'tenant',
  ACCOUNT: 'account',
  PROVIDER: 'provider',
  MODE: 'mode',
  CONNECTION: 'connection',
  FEATURE_FLAGS: 'feature-flags',
  AUTHORIZATION: 'authorization',
  HEALTH: 'health',
  KILL_SWITCHES: 'kill-switches',
} as const;

// ── Required feature flags for execution ──

/**
 * Feature flags that MUST be true for any execution command
 * to be allowed. If any are missing or false, the gate fails.
 */
const REQUIRED_FEATURE_FLAGS = [
  'brokerExecution',
  'commandSubmission',
] as const;

// ── Connected states that permit execution ──

const EXECUTION_READY_STATES: ReadonlySet<BrokerConnectionState> = new Set([
  BrokerConnectionStateEnum.CONNECTED,
  BrokerConnectionStateEnum.DEGRADED, // Degraded still allows execution (with latency)
]);

// ── Main evaluation function ──

/**
 * Evaluate an execution command against ALL policy gates.
 *
 * This is the single entry point for the execution policy gate.
 * Every command must pass through this function. The evaluation
 * is fail-fast: the first failing gate stops evaluation and
 * returns a DENY decision.
 *
 * GATE 1 (enforceLiveTradingPolicy) is ALWAYS evaluated first.
 * This is a hard architectural constraint. Even if all other
 * gates would pass, if gate 1 blocks, the decision is DENY.
 * There is NO bypass, NO override, NO admin privilege that
 * can skip this gate.
 *
 * @param command - The execution command to evaluate
 * @param context - Full policy evaluation context
 * @returns PolicyDecision with allowed, reason, containmentCode, evaluatedGates
 *
 * @example
 * ```ts
 * const decision = evaluateExecutionPolicy(command, context);
 * if (!decision.allowed) {
 *   // Command is BLOCKED. Record the denial reason.
 *   console.warn(`Policy gate denied: ${decision.containmentCode} - ${decision.reason}`);
 *   // Transition command to BLOCKED state
 * } else {
 *   // All gates passed. Command may proceed to state machine.
 * }
 * ```
 */
export function evaluateExecutionPolicy(
  command: ExecutionCommand,
  context: PolicyEvaluationContext,
): PolicyDecision {
  const evaluatedGates: string[] = [];
  const correlationId = command.correlationId;

  // ──────────────────────────────────────────────
  // GATE 1: enforceLiveTradingPolicy() — FIRST, ALWAYS
  // This is the unconditional containment from trading-policy.ts.
  // No bypass. No override. No env var. No admin privilege.
  // ──────────────────────────────────────────────
  evaluatedGates.push(GATE_NAMES.TRADING_POLICY);

  try {
    const policyResult = enforceLiveTradingPolicy(
      context.account,
      command.commandType,
    );

    if (policyResult.blocked) {
      logSecurityEvent({
        eventType: 'POLICY_GATE_BLOCK',
        correlationId,
        gate: GATE_NAMES.TRADING_POLICY,
        commandId: command.commandId,
        commandType: command.commandType,
        reason: `enforceLiveTradingPolicy blocked execution`,
      });

      return {
        allowed: false,
        reason: `Trading policy gate blocked: live trading is not permitted for this account. Command ${command.commandId} (${command.commandType}) was denied.`,
        containmentCode: CONTAINMENT_CODES.PHASE1_LIVE_TRADING_DISABLED,
        evaluatedGates,
      };
    }
  } catch (error) {
    // If enforceLiveTradingPolicy() throws, it's a DENY.
    // This should never happen (it returns, doesn't throw), but
    // we handle it defensively: fail-closed.
    logSecurityEvent({
      eventType: 'POLICY_GATE_EXCEPTION',
      correlationId,
      gate: GATE_NAMES.TRADING_POLICY,
      commandId: command.commandId,
      reason: `enforceLiveTradingPolicy threw: ${error instanceof Error ? error.message : String(error)}`,
    });

    return {
      allowed: false,
      reason: `Trading policy gate threw an exception. Command ${command.commandId} was denied (fail-closed).`,
      containmentCode: CONTAINMENT_CODES.PHASE1_LIVE_TRADING_DISABLED,
      evaluatedGates,
    };
  }

  // ──────────────────────────────────────────────
  // GATE 2: Environment gate
  // Execution must be enabled in the current environment.
  // ──────────────────────────────────────────────
  evaluatedGates.push(GATE_NAMES.ENVIRONMENT);

  if (!context.executionEnabled) {
    return {
      allowed: false,
      reason: `Environment gate failed: execution is disabled in this environment. Command ${command.commandId} was denied.`,
      containmentCode: POLICY_GATE_CODES.ENVIRONMENT_EXECUTION_DISABLED,
      evaluatedGates,
    };
  }

  // ──────────────────────────────────────────────
  // GATE 3: Tenant gate
  // Tenant must have execution permission and not be suspended.
  // ──────────────────────────────────────────────
  evaluatedGates.push(GATE_NAMES.TENANT);

  if (context.tenantPermissions.isSuspended) {
    return {
      allowed: false,
      reason: `Tenant gate failed: tenant is suspended. Command ${command.commandId} was denied.`,
      containmentCode: POLICY_GATE_CODES.TENANT_SUSPENDED,
      evaluatedGates,
    };
  }

  if (!context.tenantPermissions.canExecute) {
    return {
      allowed: false,
      reason: `Tenant gate failed: tenant does not have execution permission. Command ${command.commandId} was denied.`,
      containmentCode: POLICY_GATE_CODES.TENANT_CANNOT_EXECUTE,
      evaluatedGates,
    };
  }

  if (!context.tenantPermissions.canTrade) {
    return {
      allowed: false,
      reason: `Tenant gate failed: tenant does not have trading permission. Command ${command.commandId} was denied.`,
      containmentCode: POLICY_GATE_CODES.TENANT_CANNOT_TRADE,
      evaluatedGates,
    };
  }

  // ──────────────────────────────────────────────
  // GATE 4: Account gate
  // In Phase 1, account must be explicitly demo.
  // ──────────────────────────────────────────────
  evaluatedGates.push(GATE_NAMES.ACCOUNT);

  if (!context.isDemo) {
    return {
      allowed: false,
      reason: `Account gate failed: account is not demo. Phase 1 containment requires all execution to be on demo accounts only. Command ${command.commandId} was denied.`,
      containmentCode: POLICY_GATE_CODES.ACCOUNT_NOT_DEMO,
      evaluatedGates,
    };
  }

  // ──────────────────────────────────────────────
  // GATE 5: Provider gate
  // Provider must be registered and active.
  // ──────────────────────────────────────────────
  evaluatedGates.push(GATE_NAMES.PROVIDER);

  if (!context.providerActive) {
    return {
      allowed: false,
      reason: `Provider gate failed: provider ${command.providerId} is not registered or not active. Command ${command.commandId} was denied.`,
      containmentCode: POLICY_GATE_CODES.PROVIDER_NOT_ACTIVE,
      evaluatedGates,
    };
  }

  // ──────────────────────────────────────────────
  // GATE 6: Mode gate
  // Account mode must permit the command type.
  // ──────────────────────────────────────────────
  evaluatedGates.push(GATE_NAMES.MODE);

  if (context.accountMode !== 'demo' && context.accountMode !== 'paper') {
    return {
      allowed: false,
      reason: `Mode gate failed: account mode '${context.accountMode}' does not permit execution in Phase 1. Only 'demo' or 'paper' modes are allowed. Command ${command.commandId} was denied.`,
      containmentCode: POLICY_GATE_CODES.ACCOUNT_MODE_INVALID,
      evaluatedGates,
    };
  }

  // ──────────────────────────────────────────────
  // GATE 7: Connection state gate
  // Broker must be in a connected or degraded state.
  // ──────────────────────────────────────────────
  evaluatedGates.push(GATE_NAMES.CONNECTION);

  if (!EXECUTION_READY_STATES.has(context.connectionState)) {
    return {
      allowed: false,
      reason: `Connection state gate failed: broker connection is '${context.connectionState}', which does not permit execution. Must be CONNECTED or DEGRADED. Command ${command.commandId} was denied.`,
      containmentCode: POLICY_GATE_CODES.CONNECTION_NOT_READY,
      evaluatedGates,
    };
  }

  // ──────────────────────────────────────────────
  // GATE 8: Feature flag gate
  // Required feature flags must be enabled.
  // ──────────────────────────────────────────────
  evaluatedGates.push(GATE_NAMES.FEATURE_FLAGS);

  for (const flag of REQUIRED_FEATURE_FLAGS) {
    if (!context.featureFlags[flag]) {
      return {
        allowed: false,
        reason: `Feature flag gate failed: required flag '${flag}' is not enabled. Command ${command.commandId} was denied.`,
        containmentCode: POLICY_GATE_CODES.FEATURE_FLAG_DISABLED,
        evaluatedGates,
      };
    }
  }

  // ──────────────────────────────────────────────
  // GATE 9: Authorization gate
  // Caller must be authorized.
  // ──────────────────────────────────────────────
  evaluatedGates.push(GATE_NAMES.AUTHORIZATION);

  if (!context.authorizationResult.isAuthorized) {
    return {
      allowed: false,
      reason: `Authorization gate failed: caller is not authorized. ${context.authorizationResult.reason || 'No reason provided.'} Command ${command.commandId} was denied.`,
      containmentCode: POLICY_GATE_CODES.AUTHORIZATION_FAILED,
      evaluatedGates,
    };
  }

  // ──────────────────────────────────────────────
  // GATE 10: Health gate
  // Broker connection must be healthy.
  // ──────────────────────────────────────────────
  evaluatedGates.push(GATE_NAMES.HEALTH);

  if (!context.healthStatus || !context.healthStatus.isHealthy) {
    return {
      allowed: false,
      reason: `Health gate failed: broker connection is not healthy. ${context.healthStatus ? `errorRate=${context.healthStatus.errorRate}, latencyMs=${context.healthStatus.latencyMs}` : 'No health status available.'} Command ${command.commandId} was denied.`,
      containmentCode: POLICY_GATE_CODES.BROKER_UNHEALTHY,
      evaluatedGates,
    };
  }

  // ──────────────────────────────────────────────
  // GATE 11: Kill switch gate
  // No active kill switch for the command's scope.
  // ──────────────────────────────────────────────
  evaluatedGates.push(GATE_NAMES.KILL_SWITCHES);

  if (context.killSwitchStatus !== null) {
    const isTriggered = context.killSwitchStatus.state === KillSwitchStateEnum.TRIGGERED;
    return {
      allowed: false,
      reason: `Kill switch gate failed: kill switch '${context.killSwitchStatus.id}' is ${context.killSwitchStatus.state} for scope ${context.killSwitchStatus.scope}:${context.killSwitchStatus.scopeId}. ${context.killSwitchStatus.reason || ''} Command ${command.commandId} was denied.`,
      containmentCode: isTriggered
        ? POLICY_GATE_CODES.KILL_SWITCH_TRIGGERED
        : POLICY_GATE_CODES.KILL_SWITCH_ACTIVE,
      evaluatedGates,
    };
  }

  // ──────────────────────────────────────────────
  // ALL GATES PASSED
  // ──────────────────────────────────────────────
  logSecurityEvent({
    eventType: 'POLICY_GATE_PASS',
    correlationId,
    commandId: command.commandId,
    commandType: command.commandType,
    reason: 'All policy gates passed',
  });

  return {
    allowed: true,
    reason: `All ${evaluatedGates.length} policy gates passed for command ${command.commandId} (${command.commandType}).`,
    containmentCode: POLICY_GATE_CODES.ALL_GATES_PASSED,
    evaluatedGates,
  };
}

// ── Dry-run validation ──

/**
 * Validate an execution command for structure and completeness
 * without submitting it or evaluating policy gates.
 *
 * This function checks that all required fields are present
 * and well-formed. It NEVER submits the command to the state
 * machine or broker adapter. It is safe to call from any
 * context (API route, UI, test) without side effects.
 *
 * @param command - The execution command to validate
 * @returns CommandValidationResult with isValid, errors, warnings
 */
export function validateCommandForDryRun(command: ExecutionCommand): {
  isValid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // ── Base command fields ──
  if (!command.commandId || command.commandId.trim() === '') {
    errors.push('commandId is required and must be non-empty');
  }
  if (!command.idempotencyKey || command.idempotencyKey.trim() === '') {
    errors.push('idempotencyKey is required and must be non-empty');
  }
  if (!command.tenantId || command.tenantId.trim() === '') {
    errors.push('tenantId is required and must be non-empty');
  }
  if (!command.accountId || command.accountId.trim() === '') {
    errors.push('accountId is required and must be non-empty');
  }
  if (!command.providerId || command.providerId.trim() === '') {
    errors.push('providerId is required and must be non-empty');
  }
  if (!command.correlationId || command.correlationId.trim() === '') {
    errors.push('correlationId is required and must be non-empty');
  }
  if (!command.createdAt || command.createdAt.trim() === '') {
    errors.push('createdAt is required and must be a valid ISO-8601 timestamp');
  }
  if (!command.commandType || command.commandType.trim() === '') {
    errors.push('commandType is required and must be a valid CommandType');
  }

  // ── Command-type-specific validation ──
  switch (command.commandType) {
    case 'PLACE_MARKET': {
      const cmd = command as ExecutionCommand & { symbol?: string; side?: string; size?: number };
      if (!cmd.symbol || cmd.symbol.trim() === '') {
        errors.push('symbol is required for PLACE_MARKET commands');
      }
      if (!cmd.side || (cmd.side !== 'BUY' && cmd.side !== 'SELL')) {
        errors.push('side must be BUY or SELL for PLACE_MARKET commands');
      }
      if (typeof cmd.size !== 'number' || cmd.size <= 0) {
        errors.push('size must be a positive number for PLACE_MARKET commands');
      }
      break;
    }
    case 'PLACE_PENDING': {
      const cmd = command as ExecutionCommand & { symbol?: string; side?: string; size?: number; orderType?: string };
      if (!cmd.symbol || cmd.symbol.trim() === '') {
        errors.push('symbol is required for PLACE_PENDING commands');
      }
      if (!cmd.side || (cmd.side !== 'BUY' && cmd.side !== 'SELL')) {
        errors.push('side must be BUY or SELL for PLACE_PENDING commands');
      }
      if (typeof cmd.size !== 'number' || cmd.size <= 0) {
        errors.push('size must be a positive number for PLACE_PENDING commands');
      }
      break;
    }
    case 'MODIFY': {
      const cmd = command as ExecutionCommand & { brokerOrderId?: string };
      if (!cmd.brokerOrderId || cmd.brokerOrderId.trim() === '') {
        errors.push('brokerOrderId is required for MODIFY commands');
      }
      break;
    }
    case 'CANCEL': {
      const cmd = command as ExecutionCommand & { brokerOrderId?: string };
      if (!cmd.brokerOrderId || cmd.brokerOrderId.trim() === '') {
        errors.push('brokerOrderId is required for CANCEL commands');
      }
      break;
    }
    case 'CLOSE_POSITION': {
      const cmd = command as ExecutionCommand & { brokerPositionId?: string };
      if (!cmd.brokerPositionId || cmd.brokerPositionId.trim() === '') {
        errors.push('brokerPositionId is required for CLOSE_POSITION commands');
      }
      break;
    }
    case 'PARTIAL_CLOSE': {
      const cmd = command as ExecutionCommand & { brokerPositionId?: string; closeSize?: number };
      if (!cmd.brokerPositionId || cmd.brokerPositionId.trim() === '') {
        errors.push('brokerPositionId is required for PARTIAL_CLOSE commands');
      }
      if (typeof cmd.closeSize !== 'number' || cmd.closeSize <= 0) {
        errors.push('closeSize must be a positive number for PARTIAL_CLOSE commands');
      }
      break;
    }
    case 'UPDATE_PROTECTION': {
      const cmd = command as ExecutionCommand & { brokerPositionId?: string };
      if (!cmd.brokerPositionId || cmd.brokerPositionId.trim() === '') {
        errors.push('brokerPositionId is required for UPDATE_PROTECTION commands');
      }
      break;
    }
    // No default case needed — the switch is exhaustive over
    // the CommandType union. If a new command type is added,
    // TypeScript will flag this switch as non-exhaustive.
  }

  // ── Timestamp format validation ──
  if (command.createdAt) {
    const parsed = Date.parse(command.createdAt);
    if (isNaN(parsed)) {
      errors.push('createdAt must be a valid ISO-8601 timestamp');
    }
  }

  // ── Idempotency key format warning ──
  if (command.idempotencyKey && command.idempotencyKey.length < 8) {
    warnings.push('idempotencyKey is short — consider using a UUID for better collision resistance');
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}
