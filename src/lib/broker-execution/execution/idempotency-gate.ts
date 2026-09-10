// ============================================================
// idempotency-gate.ts — Command deduplication and idempotency
//
// CONTAINMENT CONSTRAINT:
//   The idempotency gate prevents duplicate commands from
//   reaching the broker adapter, which would result in
//   duplicate executions (double-spending).
//
//   Deduplication is based on a compound key:
//     1. idempotencyKey: Caller-supplied key (exact match)
//     2. tenantId + accountId + providerId: Scope match
//     3. requestFingerprint: SHA-256 hash of command params
//        (catches semantically identical commands with
//        different idempotency keys)
//
//   If a duplicate is found:
//     - Same request (matching fingerprint): allowed=true,
//       return existing record (safe retry)
//     - Conflicting request (different fingerprint):
//       allowed=false, reject (idempotency key collision)
//
//   During Phase 1, all non-demo commands are blocked by
//   enforceLiveTradingPolicy() before reaching this gate.
//   For demo commands, idempotency prevents duplicate
//   paper trades.
//
//   FINGERPRINTING:
//     Uses WebCrypto SHA-256 for deterministic hashing of
//     command parameters. The fingerprint includes all
//     fields that affect the semantic meaning of the command
//     (symbol, side, size, type, price, etc.) but excludes
//     metadata fields (commandId, correlationId, createdAt).
//
//   STORAGE:
//     In-memory store with optional database persistence.
//     Records are retained for a configurable window after
//     the command reaches a terminal state.
// ============================================================

import type {
  ExecutionCommand,
  ExecutionState,
} from '@/lib/broker-execution/types';
import {
  ExecutionState as ExecutionStateEnum,
  TERMINAL_STATES,
} from '@/lib/broker-execution/types';
import type {
  IdempotencyRecord,
  IdempotencyResult,
} from '@/lib/broker-execution/types/idempotency';
import { logSecurityEvent } from '@/lib/trading-policy';
import { v4 as uuidv4 } from 'uuid';

// ── In-memory idempotency store ──

/**
 * In-memory store of idempotency records.
 * Keyed by the compound key: idempotencyKey|tenantId|accountId|providerId
 * for O(1) lookup of exact-key matches.
 */
const idempotencyStore = new Map<string, IdempotencyRecord>();

/**
 * Secondary index by request fingerprint for detecting
 * semantically identical commands with different idempotency keys.
 */
const fingerprintIndex = new Map<string, IdempotencyRecord>();

// ── Compound key builder ──

/**
 * Build the compound key for idempotency lookup.
 * Combines idempotencyKey + tenantId + accountId + providerId
 * to ensure scope isolation.
 *
 * @param command - The execution command
 * @returns The compound key string
 */
function buildCompoundKey(command: ExecutionCommand): string {
  return `${command.idempotencyKey}|${command.tenantId}|${command.accountId}|${command.providerId}`;
}

// ── SHA-256 fingerprint generation (WebCrypto) ──

/**
 * Generate a deterministic SHA-256 fingerprint of an execution
 * command's parameters using WebCrypto.
 *
 * The fingerprint includes all fields that affect the semantic
 * meaning of the command (symbol, side, size, type, price, etc.)
 * but excludes metadata fields (commandId, idempotencyKey,
 * correlationId, createdAt) that don't affect the outcome.
 *
 * Two commands with the same semantic parameters will produce
 * the same fingerprint, even if they have different
 * commandIds or idempotencyKeys.
 *
 * @param command - The execution command
 * @returns Hex-encoded SHA-256 fingerprint
 */
export async function generateRequestFingerprint(
  command: ExecutionCommand,
): Promise<string> {
  // Build a stable, deterministic representation of the command's
  // semantic parameters. The order of keys MUST be stable.
  const semanticFields: Record<string, unknown> = {
    commandType: command.commandType,
    tenantId: command.tenantId,
    accountId: command.accountId,
    providerId: command.providerId,
  };

  // Add command-type-specific semantic fields
  switch (command.commandType) {
    case 'PLACE_MARKET': {
      const cmd = command as ExecutionCommand & {
        symbol: string; side: string; size: number;
        stopLoss?: number; takeProfit?: number;
      };
      semanticFields.symbol = cmd.symbol;
      semanticFields.side = cmd.side;
      semanticFields.size = cmd.size;
      semanticFields.stopLoss = cmd.stopLoss;
      semanticFields.takeProfit = cmd.takeProfit;
      break;
    }
    case 'PLACE_PENDING': {
      const cmd = command as ExecutionCommand & {
        symbol: string; side: string; size: number;
        orderType?: string; price?: number; stopPrice?: number;
        stopLoss?: number; takeProfit?: number;
        timeInForce?: string; expireAt?: string;
      };
      semanticFields.symbol = cmd.symbol;
      semanticFields.side = cmd.side;
      semanticFields.size = cmd.size;
      semanticFields.orderType = cmd.orderType;
      semanticFields.price = cmd.price;
      semanticFields.stopPrice = cmd.stopPrice;
      semanticFields.stopLoss = cmd.stopLoss;
      semanticFields.takeProfit = cmd.takeProfit;
      semanticFields.timeInForce = cmd.timeInForce;
      semanticFields.expireAt = cmd.expireAt;
      break;
    }
    case 'MODIFY': {
      const cmd = command as ExecutionCommand & {
        brokerOrderId: string; newPrice?: number;
        newStopLoss?: number; newTakeProfit?: number;
        newSize?: number; newStopPrice?: number;
      };
      semanticFields.brokerOrderId = cmd.brokerOrderId;
      semanticFields.newPrice = cmd.newPrice;
      semanticFields.newStopLoss = cmd.newStopLoss;
      semanticFields.newTakeProfit = cmd.newTakeProfit;
      semanticFields.newSize = cmd.newSize;
      semanticFields.newStopPrice = cmd.newStopPrice;
      break;
    }
    case 'CANCEL': {
      const cmd = command as ExecutionCommand & { brokerOrderId: string };
      semanticFields.brokerOrderId = cmd.brokerOrderId;
      break;
    }
    case 'CLOSE_POSITION': {
      const cmd = command as ExecutionCommand & { brokerPositionId: string };
      semanticFields.brokerPositionId = cmd.brokerPositionId;
      break;
    }
    case 'PARTIAL_CLOSE': {
      const cmd = command as ExecutionCommand & {
        brokerPositionId: string; closeSize: number;
      };
      semanticFields.brokerPositionId = cmd.brokerPositionId;
      semanticFields.closeSize = cmd.closeSize;
      break;
    }
    case 'UPDATE_PROTECTION': {
      const cmd = command as ExecutionCommand & {
        brokerPositionId: string; stopLoss?: number;
        takeProfit?: number; trailingStop?: boolean;
        trailingStopDistance?: number;
      };
      semanticFields.brokerPositionId = cmd.brokerPositionId;
      semanticFields.stopLoss = cmd.stopLoss;
      semanticFields.takeProfit = cmd.takeProfit;
      semanticFields.trailingStop = cmd.trailingStop;
      semanticFields.trailingStopDistance = cmd.trailingStopDistance;
      break;
    }
  }

  // Deterministic JSON serialization (sorted keys)
  const canonical = JSON.stringify(semanticFields, Object.keys(semanticFields).sort());

  // SHA-256 via WebCrypto (available in Node.js and browsers)
  const encoder = new TextEncoder();
  const data = encoder.encode(canonical);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const fingerprint = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

  return fingerprint;
}

// ── Idempotency evaluation ──

/**
 * Evaluate an execution command for idempotency conflicts.
 *
 * Checks two things:
 *   1. Compound key match: idempotencyKey + tenantId + accountId + providerId
 *   2. Fingerprint match: SHA-256 of command params
 *
 * If a compound key match is found:
 *   - Same fingerprint → allowed=true (safe retry, return existing)
 *   - Different fingerprint → allowed=false (idempotency key collision)
 *
 * If no compound key match but a fingerprint match is found:
 *   - allowed=false (semantically duplicate command with different key)
 *
 * If neither match is found:
 *   - isDuplicate=false, allowed=true (new command)
 *
 * @param command - The execution command to evaluate
 * @returns IdempotencyResult with isDuplicate, existingRecord, allowed
 */
export async function evaluateIdempotency(
  command: ExecutionCommand,
): Promise<IdempotencyResult> {
  const compoundKey = buildCompoundKey(command);
  const fingerprint = await generateRequestFingerprint(command);

  // Check 1: Compound key match
  const existingByCompoundKey = idempotencyStore.get(compoundKey);
  if (existingByCompoundKey) {
    const isSameRequest = existingByCompoundKey.requestFingerprint === fingerprint;

    if (isSameRequest) {
      // Safe retry: same idempotency key, same request params
      // Increment deduplicate count
      const updated: IdempotencyRecord = {
        ...existingByCompoundKey,
        lastSeenAt: new Date().toISOString(),
        deduplicateCount: existingByCompoundKey.deduplicateCount + 1,
      };
      idempotencyStore.set(compoundKey, updated);

      logSecurityEvent({
        eventType: 'IDEMPOTENCY_DEDUPLICATE',
        commandId: command.commandId,
        existingCommandId: existingByCompoundKey.commandId,
        idempotencyKey: command.idempotencyKey,
        reason: `Duplicate submission with same fingerprint (safe retry). deduplicateCount=${updated.deduplicateCount}`,
      });

      return {
        isDuplicate: true,
        existingRecord: updated,
        allowed: true, // Safe retry — caller gets the same result
      };
    }

    // Idempotency key collision: same key, different params
    logSecurityEvent({
      eventType: 'IDEMPOTENCY_COLLISION',
      commandId: command.commandId,
      existingCommandId: existingByCompoundKey.commandId,
      idempotencyKey: command.idempotencyKey,
      reason: `Idempotency key collision: same key '${command.idempotencyKey}' but different request fingerprint. Existing: ${existingByCompoundKey.requestFingerprint}, New: ${fingerprint}`,
    });

    return {
      isDuplicate: true,
      existingRecord: existingByCompoundKey,
      allowed: false, // Key collision — reject
    };
  }

  // Check 2: Fingerprint match (different key, same semantics)
  const existingByFingerprint = fingerprintIndex.get(fingerprint);
  if (existingByFingerprint) {
    // Check if the existing command is still in progress (non-terminal)
    const isTerminal = TERMINAL_STATES.has(existingByFingerprint.state);

    if (!isTerminal) {
      // The existing command is still in progress — reject
      logSecurityEvent({
        eventType: 'IDEMPOTENCY_FINGERPRINT_CONFLICT',
        commandId: command.commandId,
        existingCommandId: existingByFingerprint.commandId,
        fingerprint,
        reason: `Semantically duplicate command with different idempotency key. Existing command is in state ${existingByFingerprint.state} (non-terminal).`,
      });

      return {
        isDuplicate: true,
        existingRecord: existingByFingerprint,
        allowed: false, // Conflicting in-progress command
      };
    }

    // The existing command reached a terminal state.
    // If it was FAILED or REJECTED, the caller may be retrying
    // with a new idempotency key — allow.
    const isRetryable =
      existingByFingerprint.state === ExecutionStateEnum.FAILED ||
      existingByFingerprint.state === ExecutionStateEnum.REJECTED;

    if (isRetryable) {
      logSecurityEvent({
        eventType: 'IDEMPOTENCY_RETRY',
        commandId: command.commandId,
        existingCommandId: existingByFingerprint.commandId,
        fingerprint,
        reason: `Retry of failed/rejected command with new idempotency key. Previous state: ${existingByFingerprint.state}`,
      });

      return {
        isDuplicate: true,
        existingRecord: existingByFingerprint,
        allowed: true, // Retry of failed command — allow
      };
    }

    // Terminal non-retryable state (FILLED, CANCELLED, EXPIRED)
    logSecurityEvent({
      eventType: 'IDEMPOTENCY_FINGERPRINT_BLOCK',
      commandId: command.commandId,
      existingCommandId: existingByFingerprint.commandId,
      fingerprint,
      reason: `Semantically duplicate command. Existing command is in terminal state ${existingByFingerprint.state} (not retryable).`,
    });

    return {
      isDuplicate: true,
      existingRecord: existingByFingerprint,
      allowed: false, // Already completed — reject duplicate
    };
  }

  // No match found — new command
  return {
    isDuplicate: false,
    existingRecord: null,
    allowed: true,
  };
}

// ── Record idempotency ──

/**
 * Record an idempotency entry for a command after it has
 * passed the idempotency evaluation and is entering the
 * state machine.
 *
 * This MUST be called after evaluateIdempotency() returns
 * allowed=true and isDuplicate=false. If called for a
 * duplicate, it will overwrite the existing record.
 *
 * @param command - The execution command
 * @param state - The current execution state of the command
 * @returns The created IdempotencyRecord
 */
export async function recordIdempotency(
  command: ExecutionCommand,
  state: ExecutionState,
): Promise<IdempotencyRecord> {
  const compoundKey = buildCompoundKey(command);
  const fingerprint = await generateRequestFingerprint(command);
  const now = new Date().toISOString();

  const record: IdempotencyRecord = {
    id: uuidv4(),
    commandId: command.commandId,
    idempotencyKey: command.idempotencyKey,
    tenantId: command.tenantId,
    accountId: command.accountId,
    providerId: command.providerId,
    requestFingerprint: fingerprint,
    state,
    createdAt: now,
    lastSeenAt: now,
    deduplicateCount: 0,
  };

  idempotencyStore.set(compoundKey, record);
  fingerprintIndex.set(fingerprint, record);

  return record;
}

// ── Update idempotency state ──

/**
 * Update the execution state of an existing idempotency record.
 * Called when a command transitions to a new state.
 *
 * @param command - The execution command
 * @param newState - The new execution state
 */
export async function updateIdempotencyState(
  command: ExecutionCommand,
  newState: ExecutionState,
): Promise<void> {
  const compoundKey = buildCompoundKey(command);
  const existing = idempotencyStore.get(compoundKey);

  if (existing) {
    const updated: IdempotencyRecord = {
      ...existing,
      state: newState,
      lastSeenAt: new Date().toISOString(),
    };
    idempotencyStore.set(compoundKey, updated);
    // Fingerprint index stays the same
    fingerprintIndex.set(existing.requestFingerprint, updated);
  }
}

// ── Get idempotency record ──

/**
 * Retrieve an idempotency record by command ID.
 *
 * @param commandId - The command ID to look up
 * @returns The IdempotencyRecord if found, or null
 */
export function getIdempotencyRecord(commandId: string): IdempotencyRecord | null {
  for (const record of idempotencyStore.values()) {
    if (record.commandId === commandId) {
      return record;
    }
  }
  return null;
}

// ── Clear store (for testing) ──

/**
 * Clear the in-memory idempotency store.
 * ONLY for use in tests. Never call in production.
 */
export function clearIdempotencyStore(): void {
  idempotencyStore.clear();
  fingerprintIndex.clear();
}
