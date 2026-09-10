// ============================================================
// execution-provider.ts — Full execution flow orchestrator
//
// CONTAINMENT CONSTRAINT:
//   The ExecutionProvider orchestrates the full execution flow
//   from command receipt through the complete gate chain.
//
//   FLOW:
//     1. Receive command
//     2. Validate command structure (dry-run)
//     3. Policy gate (evaluateExecutionPolicy)
//        → enforceLiveTradingPolicy() is the FIRST check
//        → If ANY gate fails → BLOCKED, STOP
//     4. Idempotency gate (evaluateIdempotency)
//        → If duplicate and not allowed → BLOCKED, STOP
//     5. State machine transition
//        → VALIDATING → APPROVED (if all gates pass)
//        → VALIDATING → BLOCKED (if any gate fails)
//     6. STOP — Execution is disabled in Phase 1
//        Even if all gates pass, execution is NOT submitted
//        to any broker adapter. This is a hard Phase 1
//        containment constraint.
//
//   The ExecutionProvider MUST import and respect
//   enforceLiveTradingPolicy() from trading-policy.ts.
//   There is NO way to bypass this. Even validateCommand()
//   checks authorization but NEVER submits.
//
//   Phase 1 behavior:
//     - submitCommand() will ALWAYS be blocked by the policy
//       gate for any non-demo account
//     - Even for demo accounts, execution stops at step 6
//       (execution is disabled)
//     - No broker adapter is ever called
//     - No funds are ever affected
// ============================================================

import { enforceLiveTradingPolicy, logSecurityEvent } from '@/lib/trading-policy';
import type {
  ExecutionCommand,
  ExecutionState,
} from '@/lib/broker-execution/types';
import {
  ExecutionState as ExecutionStateEnum,
} from '@/lib/broker-execution/types';
import type { ExecutionStateRecord } from '@/lib/broker-execution/types/state-machine';
import type { KillSwitch } from '@/lib/broker-execution/types/kill-switches';
import {
  evaluateExecutionPolicy,
  validateCommandForDryRun,
  type PolicyDecision,
  type PolicyEvaluationContext,
} from './policy-gate';
import { evaluateKillSwitches } from '@/lib/broker-execution/kill-switches/kill-switch-manager';
import {
  evaluateIdempotency,
  recordIdempotency,
  updateIdempotencyState,
} from './idempotency-gate';
import {
  ExecutionStateMachine,
  executionStateMachine,
  InvalidTransitionError,
  TerminalStateError,
} from './state-machine';
import { v4 as uuidv4 } from 'uuid';

// ── Execution result ──

/**
 * Result of submitting a command through the execution provider.
 *
 * - commandId: The stable UUID of the command
 * - state: The current execution state
 * - decision: The policy gate decision (if evaluated)
 * - idempotencyResult: The idempotency gate result (if evaluated)
 * - stateRecord: The full state machine record (if created)
 * - blocked: true if the command was blocked at any gate
 * - reason: Human-readable explanation of the outcome
 */
export interface ExecutionResult {
  /** The command ID */
  commandId: string;
  /** Current execution state */
  state: ExecutionState;
  /** Policy gate decision (if evaluated) */
  policyDecision: PolicyDecision | null;
  /** Idempotency evaluation result (if evaluated) */
  idempotencyBlocked: boolean;
  /** Full state machine record (if created) */
  stateRecord: ExecutionStateRecord | null;
  /** Whether the command was blocked */
  blocked: boolean;
  /** Human-readable explanation */
  reason: string;
}

// ── Validation result ──

/**
 * Result of dry-run validation (never submits).
 */
export interface ValidationResult {
  /** Whether the command is structurally valid */
  isValid: boolean;
  /** Validation errors (blocking) */
  errors: string[];
  /** Validation warnings (non-blocking) */
  warnings: string[];
  /** Whether the caller is authorized */
  isAuthorized: boolean;
  /** Authorization reason (if not authorized) */
  authorizationReason: string | null;
}

// ── ExecutionProvider class ──

/**
 * Orchestrates the full execution flow for broker commands.
 *
 * This is the top-level entry point for all command submission
 * in the broker-execution boundary. It coordinates:
 *   - Command validation (structure check)
 *   - Policy gate evaluation (enforceLiveTradingPolicy + all gates)
 *   - Idempotency gate evaluation (deduplication)
 *   - State machine transitions (lifecycle management)
 *
 * IMPORTANT: During Phase 1, execution is ALWAYS blocked.
 * No command reaches the broker adapter. Even if all gates
 * pass, the flow stops after state machine approval.
 * This is a hard architectural constraint.
 *
 * Usage:
 * ```ts
 * const provider = new ExecutionProvider();
 * const result = await provider.submitCommand(command, context);
 * if (result.blocked) {
 *   // Command was blocked — inspect result.reason
 * } else {
 *   // All gates passed but execution is disabled (Phase 1)
 *   // Command is in APPROVED state, waiting for Phase 2
 * }
 * ```
 */
export class ExecutionProvider {
  private stateMachine: ExecutionStateMachine;

  constructor(stateMachine?: ExecutionStateMachine) {
    this.stateMachine = stateMachine ?? executionStateMachine;
  }

  // ── Submit command (full flow) ──

  /**
   * Submit an execution command through the full execution flow.
   *
   * Flow:
   *   1. Validate command structure
   *   2. Policy gate (enforceLiveTradingPolicy is FIRST check)
   *   3. Idempotency gate
   *   4. State machine transitions
   *   5. STOP — execution disabled in Phase 1
   *
   * This method will ALWAYS result in a blocked or stopped
   * command during Phase 1:
   *   - Non-demo accounts: blocked by enforceLiveTradingPolicy()
   *   - Demo accounts: all gates may pass, but execution is
   *     disabled (step 5), so the command stays in APPROVED
   *     state and is never submitted to the broker adapter.
   *
   * @param command - The execution command to submit
   * @param context - Policy evaluation context
   * @returns ExecutionResult with the outcome
   */
  async submitCommand(
    command: ExecutionCommand,
    context: PolicyEvaluationContext,
  ): Promise<ExecutionResult> {
    const correlationId = command.correlationId;

    logSecurityEvent({
      eventType: 'EXECUTION_PROVIDER_SUBMIT',
      commandId: command.commandId,
      commandType: command.commandType,
      correlationId,
      reason: 'Command submitted to execution provider',
    });

    // ── Step 1: Validate command structure ──
    const validation = validateCommandForDryRun(command);
    if (!validation.isValid) {
      logSecurityEvent({
        eventType: 'EXECUTION_PROVIDER_VALIDATION_FAILED',
        commandId: command.commandId,
        correlationId,
        reason: `Command validation failed: ${validation.errors.join('; ')}`,
      });

      // Create record and block immediately
      const record = this.stateMachine.createRecord(command);
      const blockedRecord = this.stateMachine.getBlockTransition(
        command,
        `Command validation failed: ${validation.errors.join('; ')}`,
      );

      return {
        commandId: command.commandId,
        state: ExecutionStateEnum.BLOCKED,
        policyDecision: null,
        idempotencyBlocked: false,
        stateRecord: blockedRecord,
        blocked: true,
        reason: `Command validation failed: ${validation.errors.join('; ')}`,
      };
    }

    // ── Step 2: Policy gate (enforceLiveTradingPolicy is FIRST) ──
    //
    // NOTE: We ALSO call enforceLiveTradingPolicy() directly here
    // as a belt-and-suspenders measure. The policy gate already
    // calls it as its first gate, but we call it again to ensure
    // that even if someone modifies the policy gate evaluation
    // order, the containment is never bypassed.
    //
    // This double-check is intentional and NOT redundant — it
    // provides defense-in-depth for the most critical containment
    // constraint.
    try {
      const directPolicyCheck = enforceLiveTradingPolicy(
        context.account,
        command.commandType,
      );
      if (directPolicyCheck.blocked) {
        // Even before the policy gate evaluates, enforceLiveTradingPolicy
        // blocks this command. Create record and block.
        const record = this.stateMachine.createRecord(command);
        const blockedRecord = this.stateMachine.getBlockTransition(
          command,
          `enforceLiveTradingPolicy() blocked: ${directPolicyCheck.blocked ? 'live trading not permitted' : 'unknown'}`,
        );

        return {
          commandId: command.commandId,
          state: ExecutionStateEnum.BLOCKED,
          policyDecision: {
            allowed: false,
            reason: `enforceLiveTradingPolicy() unconditionally blocked execution`,
            containmentCode: 'PHASE1_LIVE_TRADING_DISABLED',
            evaluatedGates: ['trading-policy'],
          },
          idempotencyBlocked: false,
          stateRecord: blockedRecord,
          blocked: true,
          reason: `Trading policy blocked execution (Phase 1 containment). Command ${command.commandId} was denied.`,
        };
      }
    } catch (error) {
      // If enforceLiveTradingPolicy() throws, fail-closed
      const record = this.stateMachine.createRecord(command);
      const blockedRecord = this.stateMachine.getBlockTransition(
        command,
        `enforceLiveTradingPolicy() threw: ${error instanceof Error ? error.message : String(error)}`,
      );

      return {
        commandId: command.commandId,
        state: ExecutionStateEnum.BLOCKED,
        policyDecision: {
          allowed: false,
          reason: `enforceLiveTradingPolicy() threw an exception`,
          containmentCode: 'PHASE1_LIVE_TRADING_DISABLED',
          evaluatedGates: ['trading-policy'],
        },
        idempotencyBlocked: false,
        stateRecord: blockedRecord,
        blocked: true,
        reason: `Trading policy threw (fail-closed). Command ${command.commandId} was denied.`,
      };
    }

    // Now evaluate the full policy gate chain
    const policyDecision = evaluateExecutionPolicy(command, context);

    if (!policyDecision.allowed) {
      // Policy gate denied — block the command
      const record = this.stateMachine.createRecord(command);
      const blockedRecord = this.stateMachine.getBlockTransition(
        command,
        `Policy gate denied: ${policyDecision.containmentCode} - ${policyDecision.reason}`,
      );

      logSecurityEvent({
        eventType: 'EXECUTION_PROVIDER_POLICY_BLOCKED',
        commandId: command.commandId,
        correlationId,
        containmentCode: policyDecision.containmentCode,
        evaluatedGates: policyDecision.evaluatedGates,
        reason: policyDecision.reason,
      });

      return {
        commandId: command.commandId,
        state: ExecutionStateEnum.BLOCKED,
        policyDecision,
        idempotencyBlocked: false,
        stateRecord: blockedRecord,
        blocked: true,
        reason: policyDecision.reason,
      };
    }

    // ── Step 3: Idempotency gate ──
    const idempotencyResult = await evaluateIdempotency(command);

    if (idempotencyResult.isDuplicate && !idempotencyResult.allowed) {
      // Conflicting duplicate — block the command
      const record = this.stateMachine.createRecord(command);
      const blockedRecord = this.stateMachine.getBlockTransition(
        command,
        `Idempotency gate denied: duplicate command with conflicting parameters. Existing command: ${idempotencyResult.existingRecord?.commandId}`,
      );

      logSecurityEvent({
        eventType: 'EXECUTION_PROVIDER_IDEMPOTENCY_BLOCKED',
        commandId: command.commandId,
        correlationId,
        existingCommandId: idempotencyResult.existingRecord?.commandId,
        reason: 'Idempotency gate blocked conflicting duplicate',
      });

      return {
        commandId: command.commandId,
        state: ExecutionStateEnum.BLOCKED,
        policyDecision,
        idempotencyBlocked: true,
        stateRecord: blockedRecord,
        blocked: true,
        reason: `Idempotency gate denied: conflicting duplicate. Existing command ${idempotencyResult.existingRecord?.commandId} is in progress.`,
      };
    }

    if (idempotencyResult.isDuplicate && idempotencyResult.allowed) {
      // Safe retry — return the existing command's state
      logSecurityEvent({
        eventType: 'EXECUTION_PROVIDER_IDEMPOTENCY_RETRY',
        commandId: command.commandId,
        correlationId,
        existingCommandId: idempotencyResult.existingRecord?.commandId,
        reason: 'Safe retry — returning existing command state',
      });

      const existingRecord = this.stateMachine.getRecord(
        idempotencyResult.existingRecord?.commandId ?? command.commandId,
      );

      return {
        commandId: idempotencyResult.existingRecord?.commandId ?? command.commandId,
        state: idempotencyResult.existingRecord?.state ?? ExecutionStateEnum.BLOCKED,
        policyDecision,
        idempotencyBlocked: false,
        stateRecord: existingRecord,
        blocked: false,
        reason: `Safe retry — command already processed. State: ${idempotencyResult.existingRecord?.state}`,
      };
    }

    // ── Step 4: State machine transitions ──
    // Command is new and all gates passed
    const record = this.stateMachine.createRecord(command);

    // Record idempotency
    await recordIdempotency(command, ExecutionStateEnum.VALIDATING);

    // Transition to VALIDATING (already done by createRecord → getBlockTransition
    // path, but we need explicit VALIDATING → APPROVED)
    const validatingRecord = this.stateMachine.transition(
      record,
      ExecutionStateEnum.VALIDATING,
      'Policy evaluation started',
      'execution-provider',
    );

    // All gates passed — transition to APPROVED
    const approvedRecord = this.stateMachine.transition(
      validatingRecord,
      ExecutionStateEnum.APPROVED,
      `All policy gates passed: ${policyDecision.evaluatedGates.join(', ')}`,
      'execution-provider',
    );

    // Update idempotency state
    await updateIdempotencyState(command, ExecutionStateEnum.APPROVED);

    // ── Step 5: STOP — Execution disabled in Phase 1 ──
    // The command is APPROVED but execution is NOT submitted
    // to any broker adapter. This is a hard Phase 1 constraint.
    // In Phase 2, this is where the command would transition
    // to QUEUED → SUBMITTING → broker adapter call.

    logSecurityEvent({
      eventType: 'EXECUTION_PROVIDER_APPROVED_BUT_STOPPED',
      commandId: command.commandId,
      correlationId,
      reason: 'Command approved by all gates but execution is disabled in Phase 1. Command stays in APPROVED state.',
    });

    return {
      commandId: command.commandId,
      state: ExecutionStateEnum.APPROVED,
      policyDecision,
      idempotencyBlocked: false,
      stateRecord: approvedRecord,
      blocked: false,
      reason: `All gates passed but execution is disabled in Phase 1. Command ${command.commandId} is in APPROVED state. No broker action was taken. No funds were affected.`,
    };
  }

  // ── Validate command (dry-run, never submits) ──

  /**
   * Validate an execution command without submitting it.
   *
   * This performs:
   *   - Structural validation (field presence and format)
   *   - Authorization check (caller must be authorized)
   *
   * It does NOT:
   *   - Evaluate the policy gate
   *   - Check idempotency
   *   - Create a state machine record
   *   - Submit to any broker adapter
   *
   * This is safe to call from any context (API route, UI, test)
   * without side effects.
   *
   * @param command - The execution command to validate
   * @returns ValidationResult with isValid, errors, warnings, isAuthorized
   */
  validateCommand(command: ExecutionCommand): ValidationResult {
    const validation = validateCommandForDryRun(command);

    // Authorization check — the caller must be authorized
    // This does NOT submit the command or create any records
    const isAuthorized = !!command.tenantId && !!command.accountId;

    return {
      isValid: validation.isValid,
      errors: validation.errors,
      warnings: validation.warnings,
      isAuthorized,
      authorizationReason: isAuthorized
        ? null
        : 'Missing tenantId or accountId — caller is not identified',
    };
  }

  // ── Get command status (read-only) ──

  /**
   * Get the current status of a command by its ID.
   *
   * This is a read-only query. It does not modify any state
   * or trigger any side effects. It returns:
   *   - The current execution state
   *   - The full state machine record (with transition history)
   *   - The idempotency record (if any)
   *
   * @param commandId - The command ID to query
   * @returns The current status, or null if the command is not found
   */
  getCommandStatus(commandId: string): {
    state: ExecutionState;
    stateRecord: ExecutionStateRecord | null;
    commandId: string;
  } | null {
    const stateRecord = this.stateMachine.getRecord(commandId);

    if (!stateRecord) {
      return null;
    }

    return {
      commandId,
      state: stateRecord.currentState,
      stateRecord,
    };
  }
}

// ── Singleton instance ──

/**
 * Default singleton instance of the ExecutionProvider.
 * Use this for all command submission unless you need
 * a separate instance with a custom state machine (for testing).
 */
export const executionProvider = new ExecutionProvider();
