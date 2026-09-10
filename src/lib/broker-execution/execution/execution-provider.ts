// ============================================================
// execution-provider.ts — THE central command orchestration
// boundary (CORRECTION ROUND, defects 1, 3, 4, 9, 10)
//
// CONTAINMENT CONSTRAINT:
//   The ExecutionProvider is the ONE central orchestration boundary
//   for all command submission in the broker-execution framework.
//   API routes do NOT call enforceLiveTradingPolicy() directly and
//   do NOT construct policy contexts from caller-supplied values —
//   they resolve the connection/account from PostgreSQL, prove
//   ownership server-side, build the policy context from trusted
//   DB/canonical-registry records, and hand the command to THIS
//   boundary.
//
//   FLOW (submitCommand):
//     1. Receive command (tenant/account/provider context already
//        derived server-side by the route from trusted records)
//     2. Validate command structure (dry-run, pure)
//     3. enforceLiveTradingPolicy() — UNCONDITIONAL first
//        containment check (also re-checked inside the policy
//        gate as gate 1 — defense in depth)
//     4. Kill-switch evaluation — AUTHORITATIVE PostgreSQL query.
//        If the store is unreachable this fails CLOSED: the
//        submission is rejected as unavailable (never "assume no
//        kill switch").
//     5. Full policy gate chain (11 gates)
//     6. Atomic persistence: command record + state transitions +
//        idempotency claim + audit entry in ONE PostgreSQL
//        transaction. Concurrent identical submissions produce
//        exactly one authoritative record (unique-constraint
//        serialized).
//     7. STOP — execution is disabled in Phase 1. NO broker
//        adapter execution method is EVER called. No command
//        leaves the persistence boundary toward a broker.
//
//   Phase 1 behavior:
//     - The routes construct contexts with executionEnabled=false
//       (a hard constant, not env-trust) — every submission ends
//       BLOCKED at the environment gate after passing the
//       unconditional containment check.
//     - Even for demo connections, execution stops after the
//       state machine records the outcome. No funds are affected.
// ============================================================

import { enforceLiveTradingPolicy, logSecurityEvent } from '@/lib/trading-policy';
import type { ExecutionCommand, ExecutionState } from '@/lib/broker-execution/types';
import { ExecutionState as ExecutionStateEnum } from '@/lib/broker-execution/types';
import { isValidTransition } from '@/lib/broker-execution/types/state-machine';
import type { KillSwitch } from '@/lib/broker-execution/types/kill-switches';
import {
  evaluateExecutionPolicy,
  validateCommandForDryRun,
  type PolicyDecision,
  type PolicyEvaluationContext,
} from './policy-gate';
import { evaluateKillSwitches, KillSwitchEvaluationUnavailableError } from '@/lib/broker-execution/kill-switches/kill-switch-manager';
import { generateRequestFingerprint } from './idempotency-gate';
import {
  CommandRepository,
  toCommandDTO,
  type ExecutionCommandRow,
} from '../persistence/command-repository';
import { ServiceUnavailableError } from '../persistence/db-access';
import { v4 as uuidv4 } from 'uuid';

// ── Execution result ──

/**
 * Result of submitting a command through the execution provider.
 *
 * - outcome: what happened at the boundary
 *   - BLOCKED: a gate denied the command (persisted as BLOCKED)
 *   - APPROVED: all gates passed; execution stopped (Phase 1)
 *   - DUPLICATE: safe retry — deduplicated to the existing record
 *   - CONFLICT: same idempotency key with a different fingerprint
 *   - UNAVAILABLE: fail-closed (e.g. kill-switch store or the
 *     authoritative command store unreachable) — the route maps
 *     this to 503
 */
export interface ExecutionResult {
  /** The command ID (of the authoritative record) */
  commandId: string;
  /** Current execution state of the authoritative record */
  state: ExecutionState;
  /** Policy gate decision (if evaluated) */
  policyDecision: PolicyDecision | null;
  /** Outcome classification */
  outcome: 'BLOCKED' | 'APPROVED' | 'DUPLICATE' | 'CONFLICT' | 'UNAVAILABLE';
  /** Whether the command was blocked by containment */
  blocked: boolean;
  /** Whether fail-closed unavailability caused the rejection */
  unavailable: boolean;
  /** Human-readable explanation */
  reason: string;
  /** The persisted command record (safe DTO), when available */
  record: Record<string, unknown> | null;
}

// ── Validation result ──

/**
 * Result of dry-run validation (never submits, never persists).
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

// ── ExecutionProvider ──

/**
 * Orchestrates the full execution flow for broker commands.
 * This is the single central command orchestration boundary.
 *
 * IMPORTANT: During Phase 1, no command reaches a broker adapter.
 * Even if all gates pass, the flow stops after persistence of the
 * APPROVED state. This is a hard architectural constraint.
 */
export class ExecutionProvider {
  // ── Submit command (full flow) ──

  /**
   * Submit an execution command through the central orchestration
   * boundary.
   *
   * The caller (API route) MUST have:
   *   - authenticated the caller;
   *   - resolved the account/connection from PostgreSQL;
   *   - proven ownership from server-side records;
   *   - derived broker/provider/demo/account context from trusted
   *     DB/canonical-registry records;
   *   - constructed the policy context server-side.
   *
   * This method:
   *   1. Validates command structure
   *   2. enforceLiveTradingPolicy() — unconditional first check
   *   3. Evaluates kill switches (fail-closed on store failure)
   *   4. Evaluates the full 11-gate policy chain
   *   5. Persists command + transitions + idempotency + audit
   *      atomically
   *   6. STOPS — no adapter call in Phase 1
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
      reason: 'Command submitted to central execution boundary',
    });

    // ── Step 1: Validate command structure ──
    const validation = validateCommandForDryRun(command);
    if (!validation.isValid) {
      return this.persistBlocked(command, context, null, {
        policyDecision: null,
        reason: `Command validation failed: ${validation.errors.join('; ')}`,
        actorId: context.actorId ?? 'execution-provider',
      });
    }

    // ── Step 2: enforceLiveTradingPolicy() — UNCONDITIONAL first check ──
    // Belt-and-suspenders: the policy gate also calls it as gate 1,
    // but this direct call guarantees the containment can never be
    // bypassed by reordering the gate chain. Fail-closed if it throws.
    try {
      const directPolicyCheck = enforceLiveTradingPolicy(
        context.account,
        command.commandType,
      );
      if (directPolicyCheck.blocked) {
        return this.persistBlocked(command, context, null, {
          policyDecision: {
            allowed: false,
            reason: 'enforceLiveTradingPolicy() unconditionally blocked execution.',
            containmentCode: 'PHASE1_LIVE_TRADING_DISABLED',
            evaluatedGates: ['trading-policy'],
          },
          reason:
            'Trading policy blocked execution (Phase 1 containment). ' +
            `Command ${command.commandId} was denied.`,
          actorId: context.actorId ?? 'execution-provider',
        });
      }
    } catch (error) {
      return this.persistBlocked(command, context, null, {
        policyDecision: {
          allowed: false,
          reason: 'enforceLiveTradingPolicy() threw an exception.',
          containmentCode: 'PHASE1_LIVE_TRADING_DISABLED',
          evaluatedGates: ['trading-policy'],
        },
        reason: `Trading policy threw (fail-closed). Command ${command.commandId} was denied.`,
        actorId: context.actorId ?? 'execution-provider',
        logDetail: error instanceof Error ? error.message : String(error),
      });
    }

    // ── Step 3: Kill-switch evaluation (fail-closed) ──
    // Authoritative PostgreSQL query. If the store is unreachable,
    // the submission fails CLOSED — we NEVER assume no kill switch.
    let killSwitchStatus: KillSwitch | null;
    try {
      killSwitchStatus = await evaluateKillSwitches(command);
    } catch (error) {
      if (error instanceof KillSwitchEvaluationUnavailableError || error instanceof ServiceUnavailableError) {
        logSecurityEvent({
          eventType: 'EXECUTION_PROVIDER_KILL_SWITCH_UNAVAILABLE',
          commandId: command.commandId,
          correlationId,
          reason: 'Kill-switch store unreachable — submission fail-closed',
        });
        return {
          commandId: command.commandId,
          state: ExecutionStateEnum.BLOCKED,
          policyDecision: null,
          outcome: 'UNAVAILABLE',
          blocked: true,
          unavailable: true,
          reason:
            'Fail-closed: kill-switch state could not be authoritatively evaluated. ' +
            'Command submission is unavailable.',
          record: null,
        };
      }
      throw error;
    }

    // ── Step 4: Full policy gate chain ──
    const effectiveContext: PolicyEvaluationContext = {
      ...context,
      killSwitchStatus,
    };
    const policyDecision = evaluateExecutionPolicy(command, effectiveContext);

    if (!policyDecision.allowed) {
      return this.persistBlocked(command, context, killSwitchStatus, {
        policyDecision,
        reason: policyDecision.reason,
        actorId: context.actorId ?? 'execution-provider',
      });
    }

    // ── Step 5: Atomic persistence (command + transitions +
    // idempotency claim + audit in ONE transaction) ──
    const requestFingerprint = await generateRequestFingerprint(command);
    const actorId = context.actorId ?? 'execution-provider';

    // Validate the transition chain against the state machine rules
    // (defense-in-depth: invalid chains are never persisted).
    assertValidTransitionChain([
      { fromState: ExecutionStateEnum.CREATED, toState: ExecutionStateEnum.VALIDATING },
      { fromState: ExecutionStateEnum.VALIDATING, toState: ExecutionStateEnum.APPROVED },
    ]);

    try {
      const createResult = await CommandRepository.createWithIdempotencyAndAudit({
        commandId: command.commandId,
        idempotencyKey: command.idempotencyKey,
        tenantId: command.tenantId,
        connectionId: context.connectionId ?? command.accountId,
        accountId: command.accountId,
        providerId: command.providerId,
        commandType: command.commandType,
        commandPayload: this.sanitizePayload(command),
        requestFingerprint,
        correlationId,
        finalState: ExecutionStateEnum.APPROVED,
        transitions: [
          {
            fromState: ExecutionStateEnum.CREATED,
            toState: ExecutionStateEnum.VALIDATING,
            reason: 'Policy evaluation started',
            actorId,
          },
          {
            fromState: ExecutionStateEnum.VALIDATING,
            toState: ExecutionStateEnum.APPROVED,
            reason: `All policy gates passed: ${policyDecision.evaluatedGates.join(', ')}`,
            actorId,
          },
        ],
        audit: {
          actorId,
          tenantId: command.tenantId,
          accountId: command.accountId,
          providerId: command.providerId,
          action: 'COMMAND_SUBMIT',
          previousState: ExecutionStateEnum.VALIDATING,
          resultingState: ExecutionStateEnum.APPROVED,
          reason: `Command approved by all gates; execution stopped (Phase 1). ${policyDecision.reason}`,
          correlationId,
          commandId: command.commandId,
          ipMetadata: context.ipMetadata ?? null,
        },
      });

      // Safe-retry bookkeeping: atomically increment the dedup count.
      if (createResult.outcome === 'DUPLICATE') {
        await this.bumpDeduplicateCount(command);
      }

      return this.mapCreateResult(createResult, policyDecision, ExecutionStateEnum.APPROVED);
    } catch (error) {
      if (error instanceof ServiceUnavailableError) {
        logSecurityEvent({
          eventType: 'EXECUTION_PROVIDER_PERSISTENCE_UNAVAILABLE',
          commandId: command.commandId,
          correlationId,
          reason: 'Authoritative command store unreachable — submission fail-closed',
        });
        return {
          commandId: command.commandId,
          state: ExecutionStateEnum.BLOCKED,
          policyDecision,
          outcome: 'UNAVAILABLE',
          blocked: true,
          unavailable: true,
          reason:
            'Fail-closed: the authoritative command store is unavailable. ' +
            'Command submission is not persisted and not executed.',
          record: null,
        };
      }
      throw error;
    }
  }

  // ── Validate command (dry-run, never submits, never persists) ──

  /**
   * Validate an execution command without submitting it.
   *
   * This performs:
   *   - Structural validation (field presence and format)
   *   - Authorization check (caller must be identified)
   *
   * It does NOT:
   *   - Evaluate the policy gate
   *   - Check idempotency
   *   - Persist ANY record (no command, no transition, no audit)
   *   - Submit to any broker adapter
   *
   * This is safe to call from any context without side effects.
   */
  validateCommand(command: ExecutionCommand): ValidationResult {
    const validation = validateCommandForDryRun(command);
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

  // ── Get command status (read-only, tenant-scoped) ──

  /**
   * Get the current status of a command by its ID, restricted to
   * the requesting tenant. This is a read-only PostgreSQL query
   * against the authoritative command store — the same store
   * POST /commands writes, so a command created by POST is always
   * retrievable here.
   */
  async getCommandStatus(
    commandId: string,
    tenantId: string,
  ): Promise<{ state: ExecutionState; record: Record<string, unknown> | null } | null> {
    const row = await CommandRepository.findByCommandIdAndTenant(commandId, tenantId);
    if (!row) return null;
    return {
      state: row.currentState as ExecutionState,
      record: toCommandDTO(row),
    };
  }

  // ── Internals ──

  /**
   * Persist a BLOCKED outcome (validation failure, containment
   * denial, or gate failure) with its transitions, idempotency
   * claim and audit entry — atomically.
   */
  private async persistBlocked(
    command: ExecutionCommand,
    context: PolicyEvaluationContext,
    killSwitchStatus: KillSwitch | null,
    params: {
      policyDecision: PolicyDecision | null;
      reason: string;
      actorId: string;
      logDetail?: string;
    },
  ): Promise<ExecutionResult> {
    const requestFingerprint = await generateRequestFingerprint(command);

    // Validate the transition chain against the state machine rules
    // (defense-in-depth: invalid chains are never persisted).
    assertValidTransitionChain([
      { fromState: ExecutionStateEnum.CREATED, toState: ExecutionStateEnum.VALIDATING },
      { fromState: ExecutionStateEnum.VALIDATING, toState: ExecutionStateEnum.BLOCKED },
    ]);

    // Policy decision when null (validation failure path): synthesize.
    const policyDecision =
      params.policyDecision ??
      {
        allowed: false,
        reason: params.reason,
        containmentCode: 'COMMAND_VALIDATION_FAILED',
        evaluatedGates: ['validation'],
      };

    try {
      const createResult = await CommandRepository.createWithIdempotencyAndAudit({
        commandId: command.commandId,
        idempotencyKey: command.idempotencyKey,
        tenantId: command.tenantId,
        connectionId: context.connectionId ?? command.accountId,
        accountId: command.accountId,
        providerId: command.providerId,
        commandType: command.commandType,
        commandPayload: this.sanitizePayload(command),
        requestFingerprint,
        correlationId: command.correlationId,
        finalState: ExecutionStateEnum.BLOCKED,
        transitions: [
          {
            fromState: ExecutionStateEnum.CREATED,
            toState: ExecutionStateEnum.VALIDATING,
            reason: 'Policy evaluation started',
            actorId: params.actorId,
          },
          {
            fromState: ExecutionStateEnum.VALIDATING,
            toState: ExecutionStateEnum.BLOCKED,
            reason: params.reason,
            actorId: params.actorId,
          },
        ],
        audit: {
          actorId: params.actorId,
          tenantId: command.tenantId,
          accountId: command.accountId,
          providerId: command.providerId,
          action: 'COMMAND_BLOCKED',
          previousState: ExecutionStateEnum.VALIDATING,
          resultingState: ExecutionStateEnum.BLOCKED,
          reason: params.logDetail ?? params.reason,
          correlationId: command.correlationId,
          commandId: command.commandId,
          ipMetadata: context.ipMetadata ?? null,
        },
      });

      // Safe-retry bookkeeping: atomically increment the dedup count.
      if (createResult.outcome === 'DUPLICATE') {
        await this.bumpDeduplicateCount(command);
      }

      logSecurityEvent({
        eventType: 'EXECUTION_PROVIDER_BLOCKED',
        commandId: command.commandId,
        correlationId: command.correlationId,
        containmentCode: policyDecision.containmentCode,
        killSwitchId: killSwitchStatus?.id,
        reason: params.reason,
      });

      return this.mapCreateResult(createResult, policyDecision, ExecutionStateEnum.BLOCKED);
    } catch (error) {
      if (error instanceof ServiceUnavailableError) {
        logSecurityEvent({
          eventType: 'EXECUTION_PROVIDER_PERSISTENCE_UNAVAILABLE',
          commandId: command.commandId,
          correlationId: command.correlationId,
          reason: 'Authoritative command store unreachable — blocked outcome not persisted (fail-closed)',
        });
        return {
          commandId: command.commandId,
          state: ExecutionStateEnum.BLOCKED,
          policyDecision,
          outcome: 'UNAVAILABLE',
          blocked: true,
          unavailable: true,
          reason:
            'Fail-closed: the authoritative command store is unavailable. ' +
            'The command is neither persisted nor executed.',
          record: null,
        };
      }
      throw error;
    }
  }

  /**
   * Atomically increment the deduplicate count for a safe retry.
   * Best-effort: the dedupe verdict itself comes from the existing
   * authoritative record; a failed count increment is logged but does
   * not change the dedupe outcome.
   */
  private async bumpDeduplicateCount(command: ExecutionCommand): Promise<void> {
    try {
      await CommandRepository.incrementDeduplicateCount(
        command.idempotencyKey,
        command.tenantId,
        command.accountId,
        command.providerId,
      );
    } catch (error) {
      logSecurityEvent({
        eventType: 'IDEMPOTENCY_DEDUP_COUNT_INCREMENT_FAILED',
        commandId: command.commandId,
        correlationId: command.correlationId,
        reason: error instanceof Error ? error.message : 'unknown error',
      });
    }
  }

  /** Map a repository create outcome to an ExecutionResult. */
  private mapCreateResult(
    createResult: { outcome: 'CREATED'; command: ExecutionCommandRow } | { outcome: 'DUPLICATE'; commandId: string; existingState: string } | { outcome: 'CONFLICT'; commandId: string | null },
    policyDecision: PolicyDecision,
    finalState: ExecutionState,
  ): ExecutionResult {
    if (createResult.outcome === 'CREATED') {
      const isBlocked = finalState === ExecutionStateEnum.BLOCKED;
      return {
        commandId: createResult.command.commandId,
        state: finalState,
        policyDecision,
        outcome: isBlocked ? 'BLOCKED' : 'APPROVED',
        blocked: isBlocked,
        unavailable: false,
        reason: isBlocked
          ? `Command ${createResult.command.commandId} was blocked by the execution boundary and persisted in BLOCKED state. No broker action was taken.`
          : `All gates passed but execution is disabled in Phase 1. Command ${createResult.command.commandId} is persisted in APPROVED state. No broker action was taken. No funds were affected.`,
        record: toCommandDTO(createResult.command),
      };
    }

    if (createResult.outcome === 'DUPLICATE') {
      return {
        commandId: createResult.commandId,
        state: createResult.existingState as ExecutionState,
        policyDecision,
        outcome: 'DUPLICATE',
        blocked: createResult.existingState === ExecutionStateEnum.BLOCKED,
        unavailable: false,
        reason: `Safe retry — command already processed with the same idempotency key and fingerprint. State: ${createResult.existingState}`,
        record: null,
      };
    }

    return {
      commandId: createResult.commandId ?? '',
      state: ExecutionStateEnum.BLOCKED,
      policyDecision,
      outcome: 'CONFLICT',
      blocked: true,
      unavailable: false,
      reason:
        'Idempotency conflict: this idempotency key is already claimed by a command with a different request fingerprint.',
      record: null,
    };
  }

  /**
   * Build the persisted command payload. Commands NEVER contain
   * credentials; this projection also drops nothing extra — the
   * payload is the full command for audit purposes.
   */
  private sanitizePayload(command: ExecutionCommand): Record<string, unknown> {
    return JSON.parse(JSON.stringify(command)) as Record<string, unknown>;
  }
}

// ── Singleton instance ──

/**
 * Validate a transition chain against the ALLOWED_TRANSITIONS map.
 * Defense-in-depth: an invalid chain throws instead of persisting.
 */
function assertValidTransitionChain(
  chain: Array<{ fromState: string; toState: string }>,
): void {
  for (const link of chain) {
    if (!isValidTransition(link.fromState as ExecutionState, link.toState as ExecutionState)) {
      throw new Error(
        `Invalid state transition ${link.fromState} → ${link.toState}: rejected by the execution state machine.`,
      );
    }
  }
}

/**
 * Default singleton instance of the ExecutionProvider.
 * All command submission flows through this single boundary.
 */
export const executionProvider = new ExecutionProvider();
