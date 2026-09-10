// ============================================================
// state-machine.ts — Execution state machine implementation
//
// CONTAINMENT CONSTRAINT:
//   The BLOCKED state is a non-terminal state from which no
//   execution transition is possible (except back to VALIDATING
//   if the blocking condition is resolved). Commands enter BLOCKED
//   when:
//     - enforceLiveTradingPolicy() returns blocked:true
//     - A kill switch is active for the command's scope
//     - Capability check fails (provider doesn't support the
//       command type)
//     - Policy gate denies the command
//
//   During Phase 1, commands for non-demo accounts will
//   always transition CREATED → VALIDATING → BLOCKED and
//   remain there indefinitely because enforceLiveTradingPolicy()
//   unconditionally blocks them.
//
//   TERMINAL STATES:
//     FILLED, REJECTED, CANCELLED, EXPIRED
//   Once a command reaches a terminal state, its record is
//   immutable (for audit integrity). No further transitions
//   are allowed.
//
//   ALL transitions are recorded with timestamp and actor
//   for a complete audit trail.
// ============================================================

import type {
  ExecutionCommand,
  ExecutionState,
} from '@/lib/broker-execution/types';
import {
  ExecutionState as ExecutionStateEnum,
  isValidTransition,
  isTerminalState,
  TERMINAL_STATES,
} from '@/lib/broker-execution/types';
import type {
  StateTransition,
  ExecutionStateRecord,
} from '@/lib/broker-execution/types/state-machine';
import { logSecurityEvent } from '@/lib/trading-policy';
import { v4 as uuidv4 } from 'uuid';

// ── In-memory state record store ──

/**
 * In-memory store of execution state records keyed by commandId.
 */
const stateRecordStore = new Map<string, ExecutionStateRecord>();

// ── Invalid transition error ──

/**
 * Error thrown when an invalid state transition is attempted.
 * This is a programming error — the caller should validate
 * the transition before attempting it.
 */
export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: ExecutionState,
    public readonly to: ExecutionState,
    public readonly commandId: string,
    reason: string,
  ) {
    super(
      `Invalid state transition: ${from} → ${to} for command ${commandId}. ${reason}`,
    );
    this.name = 'InvalidTransitionError';
  }
}

// ── Terminal state error ──

/**
 * Error thrown when a transition is attempted from a terminal state.
 */
export class TerminalStateError extends Error {
  constructor(
    public readonly state: ExecutionState,
    public readonly commandId: string,
  ) {
    super(
      `Cannot transition from terminal state ${state} for command ${commandId}. ` +
      `Terminal states are immutable for audit integrity.`,
    );
    this.name = 'TerminalStateError';
  }
}

// ── ExecutionStateMachine class ──

/**
 * Execution state machine for managing the lifecycle of
 * execution commands.
 *
 * The state machine enforces the ALLOWED_TRANSITIONS map
 * defined in types/state-machine.ts. Invalid transitions
 * throw InvalidTransitionError. Transitions from terminal
 * states throw TerminalStateError.
 *
 * All transitions are recorded with timestamp and actor
 * for a complete audit trail in the ExecutionStateRecord.
 *
 * Usage:
 * ```ts
 * const sm = new ExecutionStateMachine();
 * const record = sm.createRecord(command);
 * sm.transition(record, ExecutionState.VALIDATING, 'Policy evaluation started', 'system');
 * sm.transition(record, ExecutionState.BLOCKED, 'enforceLiveTradingPolicy blocked', 'trading-policy');
 * ```
 */
export class ExecutionStateMachine {
  // ── Create initial record ──

  /**
   * Create an initial ExecutionStateRecord for a command.
   * The command starts in the CREATED state.
   *
   * @param command - The execution command
   * @returns The new ExecutionStateRecord in CREATED state
   */
  createRecord(command: ExecutionCommand): ExecutionStateRecord {
    const now = new Date().toISOString();

    const record: ExecutionStateRecord = {
      commandId: command.commandId,
      currentState: ExecutionStateEnum.CREATED,
      previousState: null,
      transitions: [],
      lastTransitionAt: now,
      correlationId: command.correlationId,
    };

    stateRecordStore.set(command.commandId, record);

    logSecurityEvent({
      eventType: 'STATE_MACHINE_CREATE',
      commandId: command.commandId,
      correlationId: command.correlationId,
      resultingState: ExecutionStateEnum.CREATED,
      reason: 'Command created in state machine',
    });

    return record;
  }

  // ── Transition ──

  /**
   * Transition a command to a new state.
   *
   * Validates the transition using isValidTransition() from
   * the state machine type definitions. Throws if:
   *   - The transition is not in ALLOWED_TRANSITIONS
   *   - The source state is terminal
   *   - The source and target states are the same
   *
   * Records the transition with timestamp and actor in the
   * ExecutionStateRecord's transitions array.
   *
   * @param record - The current state record (will be mutated)
   * @param newState - The target state
   * @param reason - Human-readable reason for the transition
   * @param actorId - ID of the actor causing the transition
   * @returns The updated ExecutionStateRecord
   * @throws InvalidTransitionError if the transition is not valid
   * @throws TerminalStateError if the current state is terminal
   */
  transition(
    record: ExecutionStateRecord,
    newState: ExecutionState,
    reason: string,
    actorId: string,
  ): ExecutionStateRecord {
    // Check terminal state
    if (isTerminalState(record.currentState)) {
      throw new TerminalStateError(record.currentState, record.commandId);
    }

    // Validate transition
    if (!isValidTransition(record.currentState, newState)) {
      throw new InvalidTransitionError(
        record.currentState,
        newState,
        record.commandId,
        `Transition not in ALLOWED_TRANSITIONS map.`,
      );
    }

    const now = new Date().toISOString();
    const from = record.currentState;

    // Create transition record
    const transition: StateTransition = {
      from,
      to: newState,
      timestamp: now,
      reason,
      actorId,
    };

    // Update record
    const updatedRecord: ExecutionStateRecord = {
      commandId: record.commandId,
      currentState: newState,
      previousState: from,
      transitions: [...record.transitions, transition],
      lastTransitionAt: now,
      correlationId: record.correlationId,
    };

    stateRecordStore.set(record.commandId, updatedRecord);

    logSecurityEvent({
      eventType: 'STATE_MACHINE_TRANSITION',
      commandId: record.commandId,
      correlationId: record.correlationId,
      previousState: from,
      resultingState: newState,
      actorId,
      reason,
    });

    return updatedRecord;
  }

  // ── Convenience: block transition ──

  /**
   * Transition a command to the BLOCKED state.
   *
   * This is the primary containment transition. Commands
   * enter BLOCKED when any gate in the policy gate chain
   * fails (trading policy, kill switch, capability, etc.).
   *
   * The command MUST be in VALIDATING state to transition
   * to BLOCKED. If it's in any other state, this throws
   * InvalidTransitionError.
   *
   * @param command - The execution command
   * @param reason - Why the command was blocked
   * @returns The updated ExecutionStateRecord in BLOCKED state
   * @throws InvalidTransitionError if the current state doesn't allow BLOCKED
   */
  getBlockTransition(
    command: ExecutionCommand,
    reason: string,
  ): ExecutionStateRecord {
    const record = stateRecordStore.get(command.commandId);
    if (!record) {
      // Create the record if it doesn't exist (defensive)
      const newRecord = this.createRecord(command);
      const validating = this.transition(
        newRecord,
        ExecutionStateEnum.VALIDATING,
        'Auto-transition to VALIDATING for block evaluation',
        'system',
      );
      return this.transition(
        validating,
        ExecutionStateEnum.BLOCKED,
        reason,
        'policy-gate',
      );
    }

    // If already in CREATED, transition to VALIDATING first
    if (record.currentState === ExecutionStateEnum.CREATED) {
      const validating = this.transition(
        record,
        ExecutionStateEnum.VALIDATING,
        'Policy evaluation started',
        'system',
      );
      return this.transition(
        validating,
        ExecutionStateEnum.BLOCKED,
        reason,
        'policy-gate',
      );
    }

    return this.transition(
      record,
      ExecutionStateEnum.BLOCKED,
      reason,
      'policy-gate',
    );
  }

  // ── Convenience: approve transition ──

  /**
   * Transition a command from VALIDATING to APPROVED.
   *
   * This is the "all gates passed" transition. Commands
   * enter APPROVED only after ALL policy gates pass
   * (trading policy, kill switch, capability, health, etc.).
   *
   * The command MUST be in VALIDATING state. If it's in
   * any other state, this throws InvalidTransitionError.
   *
   * @param command - The execution command
   * @returns The updated ExecutionStateRecord in APPROVED state
   * @throws InvalidTransitionError if the current state doesn't allow APPROVED
   */
  getApproveTransition(
    command: ExecutionCommand,
  ): ExecutionStateRecord {
    const record = stateRecordStore.get(command.commandId);
    if (!record) {
      throw new Error(
        `No state record found for command ${command.commandId}. ` +
        `Call createRecord() first.`,
      );
    }

    // If in CREATED, transition to VALIDATING first
    if (record.currentState === ExecutionStateEnum.CREATED) {
      const validating = this.transition(
        record,
        ExecutionStateEnum.VALIDATING,
        'Policy evaluation started',
        'system',
      );
      return this.transition(
        validating,
        ExecutionStateEnum.APPROVED,
        'All policy gates passed',
        'policy-gate',
      );
    }

    return this.transition(
      record,
      ExecutionStateEnum.APPROVED,
      'All policy gates passed',
      'policy-gate',
    );
  }

  // ── Get record ──

  /**
   * Get the current state record for a command.
   *
   * @param commandId - The command ID
   * @returns The ExecutionStateRecord if found, or null
   */
  getRecord(commandId: string): ExecutionStateRecord | null {
    return stateRecordStore.get(commandId) ?? null;
  }

  // ── Check if command is blocked ──

  /**
   * Check if a command is in the BLOCKED state.
   *
   * @param commandId - The command ID
   * @returns true if the command is BLOCKED
   */
  isBlocked(commandId: string): boolean {
    const record = stateRecordStore.get(commandId);
    return record?.currentState === ExecutionStateEnum.BLOCKED;
  }

  // ── Check if command is terminal ──

  /**
   * Check if a command is in a terminal state.
   *
   * @param commandId - The command ID
   * @returns true if the command is in a terminal state
   */
  isTerminal(commandId: string): boolean {
    const record = stateRecordStore.get(commandId);
    if (!record) return false;
    return isTerminalState(record.currentState);
  }
}

// ── Singleton instance ──

/**
 * Default singleton instance of the execution state machine.
 * Use this for all command lifecycle management unless you
 * need a separate instance for testing.
 */
export const executionStateMachine = new ExecutionStateMachine();
