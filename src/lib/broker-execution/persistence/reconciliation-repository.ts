// ============================================================
// reconciliation-repository.ts — PostgreSQL-backed reconciliation
// result persistence (CORRECTION ROUND, defects 4, 7).
//
// SECURITY CONTRACT:
//   - ReconciliationResult is the authoritative store for
//     reconciliation outcomes. The previous in-memory store is
//     REMOVED — results survive restarts and are visible to all
//     instances.
//   - All reads are tenant-scoped through the owning connection
//     (connectionId → BrokerConnection → tenantId).
//   - Reconciliation remains READ-ONLY with respect to broker
//     state: this repository only persists diagnostic results.
//   - Fail-closed: DB failures throw ServiceUnavailableError.
// ============================================================

import { Prisma } from '@prisma/client';
import { requireDb, ServiceUnavailableError } from './db-access';
import { resolveOwnedConnection, type BrokerConnectionRow } from '../security/ownership';

// ── Row shape ──

export interface ReconciliationResultRow {
  id: string;
  accountId: string;
  providerId: string;
  connectionId: string;
  status: string;
  commandCount: number;
  brokerOrderCount: number;
  matchCount: number;
  mismatchCount: number;
  discrepancies: unknown;
  durationMs: number | null;
  startedAt: Date;
  completedAt: Date | null;
}

// ── Domain result shape (stable API for the route/reconciler) ──

export interface ReconciliationOutcome {
  reconciliationId: string;
  accountId: string;
  providerId: string;
  connectionId: string;
  status: 'IDLE' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'PARTIAL';
  commandCount: number;
  brokerOrderCount: number;
  matchCount: number;
  mismatchCount: number;
  discrepancies: Array<Record<string, unknown>>;
  durationMs: number | null;
  reconciledAt: string | null;
}

// ── Repository ──

export const ReconciliationRepository = {
  /**
   * Persist a reconciliation result for an OWNED connection.
   * The connection is resolved from PostgreSQL with ownership
   * proof — reconciliation results can never be written for
   * another tenant's connection.
   */
  async saveResult(params: {
    authenticatedUserId: string;
    connectionId: string;
    outcome: Omit<ReconciliationOutcome, 'reconciliationId' | 'reconciledAt'>;
  }): Promise<ReconciliationOutcome> {
    const owned = await resolveOwnedConnection(params.connectionId, params.authenticatedUserId);
    if (!owned.ok) {
      throw new Error(owned.message);
    }
    const connection = owned.connection;

    const db = requireDb('reconciliation repository save');
    const row = await db.reconciliationResult.create({
      data: {
        accountId: params.outcome.accountId,
        providerId: params.outcome.providerId,
        connectionId: connection.id,
        status: params.outcome.status,
        commandCount: params.outcome.commandCount,
        brokerOrderCount: params.outcome.brokerOrderCount,
        matchCount: params.outcome.matchCount,
        mismatchCount: params.outcome.mismatchCount,
        discrepancies: params.outcome.discrepancies as unknown as Prisma.InputJsonValue,
        durationMs: params.outcome.durationMs,
      },
    });

    return rowToOutcome(row as unknown as ReconciliationResultRow);
  },

  /**
   * List reconciliation history for an OWNED connection+account pair.
   * Ownership is proven from PostgreSQL records; the accountId must
   * correspond to the connection (mismatch is rejected).
   */
  async getHistory(
    authenticatedUserId: string,
    connectionId: string,
    accountId: string,
    limit = 10,
  ): Promise<ReconciliationOutcome[]> {
    const owned = await resolveOwnedConnection(connectionId, authenticatedUserId);
    if (!owned.ok) {
      throw new Error(owned.message);
    }
    verifyAccountCorrespondence(owned.connection, accountId);

    const db = requireDb('reconciliation repository history');
    const rows = await db.reconciliationResult.findMany({
      where: { connectionId: owned.connection.id, accountId },
      orderBy: { startedAt: 'desc' },
      take: Math.min(limit, 100),
    });
    return (rows as unknown as ReconciliationResultRow[]).map(rowToOutcome);
  },

  /** Get the latest result for an owned connection+account pair. */
  async getLatestResult(
    authenticatedUserId: string,
    connectionId: string,
    accountId: string,
  ): Promise<ReconciliationOutcome | null> {
    const history = await this.getHistory(authenticatedUserId, connectionId, accountId, 1);
    return history[0] ?? null;
  },
};

// ── Helpers ──

/**
 * Verify that the accountId corresponds to the connection record.
 * The connection's accountId (or its own id when no broker-side
 * account is set) must match. Mismatch → rejected (defect 7).
 */
export function verifyAccountCorrespondence(
  connection: BrokerConnectionRow,
  accountId: string,
): void {
  const expected = connection.accountId ?? connection.id;
  if (accountId !== expected) {
    throw new Error('accountId does not correspond to the supplied connection.');
  }
}

function rowToOutcome(row: ReconciliationResultRow): ReconciliationOutcome {
  return {
    reconciliationId: row.id,
    accountId: row.accountId,
    providerId: row.providerId,
    connectionId: row.connectionId,
    status: row.status as ReconciliationOutcome['status'],
    commandCount: row.commandCount,
    brokerOrderCount: row.brokerOrderCount,
    matchCount: row.matchCount,
    mismatchCount: row.mismatchCount,
    discrepancies: Array.isArray(row.discrepancies)
      ? (row.discrepancies as Array<Record<string, unknown>>)
      : [],
    durationMs: row.durationMs,
    reconciledAt: row.completedAt ? row.completedAt.toISOString() : null,
  };
}
