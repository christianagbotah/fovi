// ============================================================
// idempotency-gate.ts — Command request fingerprinting
// (CORRECTION ROUND, defect 9)
//
// This module now contains ONLY the deterministic request
// fingerprint (a pure function). The previous evaluate-then-record
// in-memory Map flow is REMOVED — it had a check-then-insert race
// (two concurrent requests could both pass the "no record" check
// and both proceed).
//
// The authoritative idempotency implementation is the ATOMIC
// PostgreSQL claim in command-repository.ts
// (createWithIdempotencyAndAudit):
//   - The IdempotencyRecord UNIQUE(idempotencyKey, tenantId,
//     accountId, providerId) constraint serializes submissions at
//     the database: exactly one INSERT succeeds, the loser's
//     transaction aborts (P2002) and deduplicates to the winner.
//   - same key + same scope + same fingerprint → same
//     authoritative command/result (safe retry)
//   - same key + different fingerprint → conflict
//   - DB unavailable → fail closed
//
// FINGERPRINTING:
//   Uses WebCrypto SHA-256 for deterministic hashing of command
//   parameters. The fingerprint includes all fields that affect
//   the semantic meaning of the command (symbol, side, size, type,
//   price, etc.) but excludes metadata fields (commandId,
//   idempotencyKey, correlationId, createdAt).
// ============================================================

import type { ExecutionCommand } from '@/lib/broker-execution/types';

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
 * Two commands with the same semantic parameters will produce the
 * same fingerprint, even if they have different commandIds or
 * idempotencyKeys.
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
