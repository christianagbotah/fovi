// ============================================================
// reconciliation-store.ts — Reconciliation result store
// (CORRECTION ROUND, defects 4, 7)
//
// This module is now a thin layer over
// persistence/reconciliation-repository.ts. ReconciliationResult
// (PostgreSQL) is the AUTHORITATIVE store — results survive
// restarts and are visible to all instances. The previous
// in-memory store is REMOVED.
//
// SECURITY CONTRACT:
//   - Ownership is mandatory and proven from server-side records:
//     every read/write resolves the connection from PostgreSQL
//     with tenant ownership. The accountId must correspond to the
//     connection (connectionId is NOT an optional authorization
//     mechanism).
//   - Reconciliation is READ-ONLY with respect to broker state.
//   - Fail-closed: DB failures throw ServiceUnavailableError.
// ============================================================

import {
  ReconciliationRepository,
  verifyAccountCorrespondence,
  type ReconciliationOutcome,
} from '../persistence/reconciliation-repository';
import { resolveOwnedConnection } from '../security/ownership';

// ── Stored result type (stable API surface) ──

export type StoredReconciliationResult = ReconciliationOutcome;

export interface DiscrepancyListOptions {
  limit?: number;
}

// ── Store ──

/**
 * Reconciliation result store backed by ReconciliationResult
 * (PostgreSQL). Fail-closed and ownership-enforcing.
 */
export class ReconciliationStore {
  /**
   * Persist a reconciliation outcome for an OWNED connection.
   */
  async saveResult(params: {
    authenticatedUserId: string;
    connectionId: string;
    accountId: string;
    outcome: Omit<ReconciliationOutcome, 'reconciliationId' | 'reconciledAt'>;
  }): Promise<StoredReconciliationResult> {
    return ReconciliationRepository.saveResult({
      authenticatedUserId: params.authenticatedUserId,
      connectionId: params.connectionId,
      outcome: params.outcome,
    });
  }

  /**
   * Get reconciliation history for an account+connection pair.
   * Ownership is proven from PostgreSQL records; the accountId
   * must correspond to the connection.
   */
  async getHistory(
    authenticatedUserId: string,
    connectionId: string,
    accountId: string,
    limit = 10,
  ): Promise<StoredReconciliationResult[]> {
    return ReconciliationRepository.getHistory(
      authenticatedUserId,
      connectionId,
      accountId,
      limit,
    );
  }

  /** Get the latest result for an owned account+connection pair. */
  async getLatestResult(
    authenticatedUserId: string,
    connectionId: string,
    accountId: string,
  ): Promise<StoredReconciliationResult | null> {
    return ReconciliationRepository.getLatestResult(
      authenticatedUserId,
      connectionId,
      accountId,
    );
  }

  /**
   * List discrepancies across an owned connection's history
   * (mismatched reconciliations only).
   */
  async listDiscrepancies(
    authenticatedUserId: string,
    connectionId: string,
    accountId: string,
    options?: DiscrepancyListOptions,
  ): Promise<Array<Record<string, unknown>>> {
    // Verify ownership + correspondence first (fail-closed).
    const owned = await resolveOwnedConnection(connectionId, authenticatedUserId);
    if (!owned.ok) {
      throw new Error(owned.message);
    }
    verifyAccountCorrespondence(owned.connection, accountId);

    const history = await this.getHistory(
      authenticatedUserId,
      connectionId,
      accountId,
      options?.limit ?? 10,
    );
    const discrepancies: Array<Record<string, unknown>> = [];
    for (const result of history) {
      if (result.mismatchCount > 0) {
        for (const d of result.discrepancies) {
          discrepancies.push({ reconciliationId: result.reconciliationId, ...d });
        }
      }
    }
    return discrepancies;
  }
}
