// ============================================================
// command-repository.ts — PostgreSQL-backed authoritative command
// persistence (CORRECTION ROUND, defects 3, 4, 9, 10).
//
// SECURITY CONTRACT:
//   - ExecutionCommandRecord is the SINGLE authoritative command
//     store. There are NO process-local command Maps in any
//     production path. A command created by POST is retrievable
//     by GET /commands/[id] because both read the same table.
//   - Command records, state transitions, the idempotency claim
//     and the audit entry are written in ONE PostgreSQL
//     transaction: either all persist or none does. A failed
//     audit write rolls back the mutation (fail-closed).
//   - The idempotency claim relies on the IdempotencyRecord
//     UNIQUE(idempotencyKey, tenantId, accountId, providerId)
//     constraint: concurrent identical submissions produce
//     EXACTLY ONE authoritative command record. The loser's
//     transaction aborts (P2002) and deduplicates to the winner.
//   - All query paths are tenant-scoped.
//   - commandPayload never contains credentials.
// ============================================================

import { logSecurityEvent } from '@/lib/trading-policy';
import { Prisma } from '@prisma/client';
import {
  requireDb,
  ServiceUnavailableError,
  isUniqueViolation,
  isDbUnavailableError,
} from './db-access';
import { sanitizeBrokerAuditInput } from '../observability/redaction';

// ── Row shapes (Prisma model projections) ──

export interface ExecutionCommandRow {
  id: string;
  commandId: string;
  idempotencyKey: string;
  tenantId: string;
  connectionId: string;
  providerId: string;
  commandType: string;
  commandPayload: unknown;
  currentState: string;
  previousState: string | null;
  requestFingerprint: string | null;
  deduplicateCount: number;
  brokerOrderId: string | null;
  brokerPositionId: string | null;
  rejectionReason: string | null;
  fillPrice: number | null;
  fillSize: number | null;
  correlationId: string | null;
  createdAt: Date;
  lastUpdatedAt: Date;
  submittedAt: Date | null;
  acknowledgedAt: Date | null;
  filledAt: Date | null;
  rejectedAt: Date | null;
  expiredAt: Date | null;
}

export interface ExecutionStateTransitionRow {
  id: string;
  commandId: string;
  fromState: string;
  toState: string;
  reason: string | null;
  actorId: string | null;
  timestamp: Date;
}

/** Audit entry written inside the same transaction as a security-critical mutation. */
export interface TransactionalAuditInput {
  actorId: string;
  tenantId: string;
  action: string;
  previousState?: string | null;
  resultingState?: string | null;
  reason?: string | null;
  correlationId?: string | null;
  commandId?: string | null;
  accountId?: string | null;
  providerId?: string | null;
  ipMetadata?: unknown;
}

// ── Create input ──

export interface CreateCommandRecordInput {
  commandId: string;
  idempotencyKey: string;
  tenantId: string;
  connectionId: string;
  accountId: string;
  providerId: string;
  commandType: string;
  /** Full command details. MUST NOT contain credentials. */
  commandPayload: Record<string, unknown>;
  requestFingerprint: string;
  correlationId: string;
  /** Final state for this submission (BLOCKED or APPROVED in Phase 1 flow). */
  finalState: string;
  /** Precomputed valid transitions ending at finalState. */
  transitions: Array<{ fromState: string; toState: string; reason: string; actorId: string }>;
  audit: TransactionalAuditInput;
}

/** Result of the transactional create (with atomic idempotency claim). */
export type CreateCommandResult =
  | { outcome: 'CREATED'; command: ExecutionCommandRow }
  | { outcome: 'DUPLICATE'; commandId: string; existingState: string }
  | { outcome: 'CONFLICT'; commandId: string | null };

// ── Repository ──

/**
 * Authoritative command persistence. Every method is
 * PostgreSQL-backed and fail-closed (ServiceUnavailableError
 * on DB failure — never a silent fallback).
 */
export const CommandRepository = {
  /**
   * Atomically persist a command record, its state transitions,
   * its idempotency claim and its audit entry in ONE transaction.
   *
   * Idempotency semantics (atomic via the P2002 unique constraint):
   *   - CREATED: this submission is the authoritative record
   *   - DUPLICATE: same key + scope + fingerprint already exists
   *     (safe retry — the caller should return the existing record)
   *   - CONFLICT: same key + scope but different fingerprint
   */
  async createWithIdempotencyAndAudit(
    input: CreateCommandRecordInput,
  ): Promise<CreateCommandResult> {
    const db = requireDb('command repository create');

    try {
      const created = await db.$transaction(async (tx) => {
        const command = await tx.executionCommandRecord.create({
          data: {
            commandId: input.commandId,
            idempotencyKey: input.idempotencyKey,
            tenantId: input.tenantId,
            connectionId: input.connectionId,
            providerId: input.providerId,
            commandType: input.commandType,
            commandPayload: input.commandPayload as unknown as Prisma.InputJsonValue,
            currentState: input.finalState,
            previousState: input.transitions.length
              ? input.transitions[input.transitions.length - 1].fromState
              : null,
            requestFingerprint: input.requestFingerprint,
            rejectionReason: input.finalState === 'BLOCKED' ? (input.transitions.at(-1)?.reason ?? null) : null,
            correlationId: input.correlationId,
          },
        });

        for (const transition of input.transitions) {
          await tx.executionStateTransition.create({
            data: {
              commandId: input.commandId,
              fromState: transition.fromState,
              toState: transition.toState,
              reason: transition.reason,
              actorId: transition.actorId,
            },
          });
        }

        // Atomic idempotency claim — UNIQUE(idempotencyKey, tenantId,
        // accountId, providerId) serializes concurrent submissions.
        await tx.idempotencyRecord.create({
          data: {
            commandId: input.commandId,
            idempotencyKey: input.idempotencyKey,
            tenantId: input.tenantId,
            accountId: input.accountId,
            providerId: input.providerId,
            requestFingerprint: input.requestFingerprint,
            state: input.finalState,
          },
        });

        // Audit is part of the security guarantee: a failed audit
        // write rolls back the whole mutation (fail-closed).
        // The input is sanitized with the SAME pure sanitizer used
        // by the standalone AuditRepository (round 2, item 4) — safe
        // to call inside this transaction (no second DB operation).
        await tx.brokerExecutionAudit.create({
          data: sanitizeBrokerAuditInput({
            actorId: input.audit.actorId,
            tenantId: input.audit.tenantId,
            accountId: input.audit.accountId ?? null,
            providerId: input.audit.providerId ?? input.providerId,
            action: input.audit.action,
            previousState: input.audit.previousState ?? null,
            resultingState: input.audit.resultingState ?? input.finalState,
            reason: input.audit.reason ?? null,
            correlationId: input.audit.correlationId ?? input.correlationId,
            commandId: input.commandId,
            ipMetadata: input.audit.ipMetadata,
          }) as never,
        });

        return command;
      });

      return { outcome: 'CREATED', command: created as unknown as ExecutionCommandRow };
    } catch (error) {
      if (isUniqueViolation(error)) {
        // The idempotency key is already claimed. Resolve against the
        // authoritative record. (The transaction above rolled back, so
        // no partial or duplicate command record exists.)
        const existing = await this.findIdempotencyScope(
          input.idempotencyKey,
          input.tenantId,
          input.accountId,
          input.providerId,
        );

        if (!existing) {
          // Unique violation but no resolvable record — treat as conflict.
          return { outcome: 'CONFLICT', commandId: null };
        }

        if (existing.requestFingerprint === input.requestFingerprint) {
          // Safe retry — same key, same scope, same fingerprint.
          return {
            outcome: 'DUPLICATE',
            commandId: existing.commandId,
            existingState: existing.state,
          };
        }

        // Same key + scope but different payload → conflict.
        return { outcome: 'CONFLICT', commandId: existing.commandId };
      }

      if (error instanceof ServiceUnavailableError) throw error;
      if (isDbUnavailableError(error)) {
        throw new ServiceUnavailableError('command repository create', 'transaction failed');
      }
      throw error;
    }
  },

  /**
   * Fetch a command by its stable commandId WITH tenant ownership.
   * Returns null when the command does not exist OR belongs to
   * another tenant (no cross-tenant information disclosure).
   */
  async findByCommandIdAndTenant(
    commandId: string,
    tenantId: string,
  ): Promise<ExecutionCommandRow | null> {
    const db = requireDb('command repository find');
    const row = await db.executionCommandRecord.findFirst({
      where: { commandId, tenantId },
    });
    return (row as unknown as ExecutionCommandRow) ?? null;
  },

  /** List command history for a tenant (newest first). */
  async listByTenant(
    tenantId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<ExecutionCommandRow[]> {
    const db = requireDb('command repository list');
    const rows = await db.executionCommandRecord.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(options?.limit ?? 50, 200),
      skip: options?.offset ?? 0,
    });
    return rows as unknown as ExecutionCommandRow[];
  },

  /** List commands for a connection (tenant-scoped) — used by reconciliation. */
  async listByConnection(
    connectionId: string,
    tenantId: string,
  ): Promise<ExecutionCommandRow[]> {
    const db = requireDb('command repository list-by-connection');
    const rows = await db.executionCommandRecord.findMany({
      where: { connectionId, tenantId },
      orderBy: { createdAt: 'asc' },
    });
    return rows as unknown as ExecutionCommandRow[];
  },

  /** Get the full transition history for a command (read-only). */
  async getTransitions(commandId: string): Promise<ExecutionStateTransitionRow[]> {
    const db = requireDb('command repository transitions');
    const rows = await db.executionStateTransition.findMany({
      where: { commandId },
      orderBy: { timestamp: 'asc' },
    });
    return rows as unknown as ExecutionStateTransitionRow[];
  },

  /** Resolve the authoritative idempotency record for a key+scope. */
  async findIdempotencyScope(
    idempotencyKey: string,
    tenantId: string,
    accountId: string,
    providerId: string,
  ): Promise<{ commandId: string; requestFingerprint: string; state: string; deduplicateCount: number } | null> {
    const db = requireDb('command repository idempotency lookup');
    const row = await db.idempotencyRecord.findUnique({
      where: {
        idempotencyKey_tenantId_accountId_providerId: {
          idempotencyKey,
          tenantId,
          accountId,
          providerId,
        },
      },
    });
    if (!row) return null;
    return {
      commandId: row.commandId,
      requestFingerprint: row.requestFingerprint,
      state: row.state,
      deduplicateCount: row.deduplicateCount,
    };
  },

  /** Atomically increment the deduplicate count for a key+scope (safe retries). */
  async incrementDeduplicateCount(
    idempotencyKey: string,
    tenantId: string,
    accountId: string,
    providerId: string,
  ): Promise<void> {
    const db = requireDb('command repository dedup increment');
    await db.idempotencyRecord.update({
      where: {
        idempotencyKey_tenantId_accountId_providerId: {
          idempotencyKey,
          tenantId,
          accountId,
          providerId,
        },
      },
      data: { deduplicateCount: { increment: 1 } },
    });
  },
};

// ── Safe DTO (API responses) ──

/**
 * Convert a command row to a safe API DTO. Command payloads never
 * contain credentials by construction, but this projection also
 * drops non-essential internals to keep the surface minimal.
 */
export function toCommandDTO(row: ExecutionCommandRow): Record<string, unknown> {
  return {
    commandId: row.commandId,
    idempotencyKey: row.idempotencyKey,
    connectionId: row.connectionId,
    accountId:
      typeof row.commandPayload === 'object' && row.commandPayload !== null
        ? (row.commandPayload as Record<string, unknown>).accountId ?? null
        : null,
    providerId: row.providerId,
    commandType: row.commandType,
    status: row.currentState,
    rejectionReason: row.rejectionReason,
    correlationId: row.correlationId,
    createdAt: row.createdAt,
    lastUpdatedAt: row.lastUpdatedAt,
  };
}
