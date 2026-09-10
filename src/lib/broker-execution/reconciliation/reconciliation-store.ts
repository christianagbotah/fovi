// ============================================================
// reconciliation-store.ts — Persistence layer for
// reconciliation results
//
// DESIGN PRINCIPLES:
//   1. AUDITABLE: All reconciliation results are persisted
//      and never deleted. This ensures a complete audit trail.
//   2. TENANT-ISOLATED: All data is scoped by accountId.
//      One tenant cannot access another tenant's reconciliation
//      data.
//   3. RESILIENT: Uses safeDbQuery for all database operations
//      to gracefully handle database unavailability. Falls back
//      to in-memory storage when the database is unavailable.
//   4. PATTERN-CONSISTENT: Follows the same SystemConfig
//      persistence pattern as kill-switch-manager.ts for
//      storing structured data without requiring dedicated
//      Prisma models.
// ============================================================

import { db, safeDbQuery } from '@/lib/db';
import type {
  ReconciliationDiscrepancy,
  ReconciliationResult,
} from '@/lib/broker-execution/types/reconciliation';
import {
  ReconciliationDiscrepancyType as DiscrepancyTypeEnum,
} from '@/lib/broker-execution/types/reconciliation';
import { v4 as uuidv4 } from 'uuid';

// ── Stored reconciliation record ──

/**
 * A reconciliation result with additional metadata for
 * storage and retrieval. Extends ReconciliationResult with
 * IDs and tenant isolation fields.
 */
export interface StoredReconciliationResult extends ReconciliationResult {
  /** Unique reconciliation run identifier */
  reconciliationId: string;
  /** Account ID (tenant isolation) */
  accountId: string;
  /** Broker provider ID */
  providerId: string;
  /** ISO-8601 timestamp when this record was stored */
  storedAt: string;
}

// ── Discrepancy list filter options ──

export interface DiscrepancyListOptions {
  /** Filter by discrepancy type */
  type?: typeof DiscrepancyTypeEnum[keyof typeof DiscrepancyTypeEnum];
  /** Filter by minimum severity */
  minSeverity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  /** Filter by command ID */
  commandId?: string;
  /** Filter by broker order ID */
  brokerOrderId?: string;
  /** Maximum number of discrepancies to return */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Filter by detection time range — start */
  detectedAfter?: string;
  /** Filter by detection time range — end */
  detectedBefore?: string;
}

// ── Severity ordering ──

const SEVERITY_ORDER: Record<string, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

// ── In-memory fallback store ──

/**
 * In-memory store used when the database is unavailable.
 * Keyed by reconciliationId for direct lookup, with
 * secondary indexes for accountId-based queries.
 */
const memoryStore = new Map<string, StoredReconciliationResult>();

/**
 * Secondary index: accountId → list of reconciliation IDs
 * (ordered by storedAt descending — newest first)
 */
const accountIndex = new Map<string, string[]>();

// ── Database key prefix ──

/**
 * SystemConfig key prefix for reconciliation results.
 * Each reconciliation is stored with key:
 *   `recon_result:{accountId}:{reconciliationId}`
 */
const KEY_PREFIX = 'recon_result:';

// ── ReconciliationStore class ──

/**
 * Persistence store for reconciliation results.
 *
 * Uses the SystemConfig table for persistence (same pattern
 * as kill-switch-manager.ts). When the database is unavailable,
 * falls back to in-memory storage.
 *
 * All data is tenant-isolated by accountId. One tenant cannot
 * access another tenant's reconciliation data.
 *
 * Usage:
 * ```ts
 * const store = new ReconciliationStore();
 *
 * // Save a result
 * await store.saveResult('account-123', 'provider-456', result);
 *
 * // Get latest result for an account
 * const latest = await store.getLatestResult('account-123');
 *
 * // List discrepancies
 * const discreps = await store.listDiscrepancies('account-123', {
 *   minSeverity: 'HIGH',
 *   limit: 100,
 * });
 * ```
 */
export class ReconciliationStore {
  // ── Save result ──

  /**
   * Persist a reconciliation result.
   *
   * The result is stored both in-memory (for fast access)
   * and in the database (for durability). The in-memory
   * store is the primary read path; the database is the
   * durability guarantee.
   *
   * @param accountId - The account ID (tenant isolation)
   * @param providerId - The broker provider ID
   * @param result - The reconciliation result to persist
   * @returns The stored result with its assigned reconciliationId
   */
  async saveResult(
    accountId: string,
    providerId: string,
    result: ReconciliationResult,
  ): Promise<StoredReconciliationResult> {
    const reconciliationId = uuidv4();
    const now = new Date().toISOString();

    const stored: StoredReconciliationResult = {
      ...result,
      reconciliationId,
      accountId,
      providerId,
      storedAt: now,
    };

    // 1. Store in memory
    memoryStore.set(reconciliationId, stored);

    // 2. Update account index
    const existing = accountIndex.get(accountId) ?? [];
    existing.unshift(reconciliationId); // Newest first
    accountIndex.set(accountId, existing);

    // 3. Persist to database
    await this.persistToDatabase(stored);

    return stored;
  }

  // ── Get result by ID ──

  /**
   * Get a stored reconciliation result by its ID.
   *
   * Checks in-memory store first, then falls back to database.
   *
   * @param reconciliationId - The reconciliation run ID
   * @returns The stored result, or null if not found
   */
  async getResult(reconciliationId: string): Promise<StoredReconciliationResult | null> {
    // Check in-memory first
    const cached = memoryStore.get(reconciliationId);
    if (cached) return cached;

    // Fall back to database — scan all recon_result keys to find this ID
    // (SystemConfig keys include accountId, so we search by suffix)
    const dbResult = await this.loadFromDatabaseById(reconciliationId);
    return dbResult;
  }

  // ── Get latest result for account ──

  /**
   * Get the most recent reconciliation result for an account.
   *
   * Returns null if no reconciliation has been run for
   * this account.
   *
   * @param accountId - The account ID
   * @returns The latest stored result, or null
   */
  async getLatestResult(accountId: string): Promise<StoredReconciliationResult | null> {
    // Check in-memory index
    const ids = accountIndex.get(accountId);
    if (ids && ids.length > 0) {
      const latest = memoryStore.get(ids[0]);
      if (latest) return latest;
    }

    // Fall back to database scan
    const results = await this.loadAllForAccount(accountId);
    if (results.length === 0) return null;

    // Sort by storedAt descending, return first
    results.sort((a, b) => b.storedAt.localeCompare(a.storedAt));
    return results[0];
  }

  // ── List discrepancies ──

  /**
   * List discrepancies for an account with filtering.
   *
   * Scans all stored reconciliation results for the account
   * and returns discrepancies matching the filter options.
   *
   * @param accountId - The account ID (tenant isolation)
   * @param options - Filter and pagination options
   * @returns Filtered list of discrepancies
   */
  async listDiscrepancies(
    accountId: string,
    options: DiscrepancyListOptions = {},
  ): Promise<ReconciliationDiscrepancy[]> {
    // Load all results for this account
    const results = await this.loadAllForAccount(accountId);

    // Collect all discrepancies from all results
    let allDiscrepancies: ReconciliationDiscrepancy[] = [];
    for (const result of results) {
      allDiscrepancies.push(...result.discrepancies);
    }

    // Sort by detection time descending (newest first)
    allDiscrepancies.sort((a, b) => b.detectedAt.localeCompare(a.detectedAt));

    // Apply filters
    allDiscrepancies = allDiscrepancies.filter((d) => {
      // Type filter
      if (options.type && d.type !== options.type) return false;

      // Severity filter
      if (options.minSeverity) {
        const dSeverity = SEVERITY_ORDER[d.severity] ?? 0;
        const minSeverity = SEVERITY_ORDER[options.minSeverity] ?? 0;
        if (dSeverity < minSeverity) return false;
      }

      // Command ID filter
      if (options.commandId && d.commandId !== options.commandId) return false;

      // Broker order ID filter
      if (options.brokerOrderId && d.brokerOrderId !== options.brokerOrderId) return false;

      // Detection time range filters
      if (options.detectedAfter && d.detectedAt < options.detectedAfter) return false;
      if (options.detectedBefore && d.detectedAt > options.detectedBefore) return false;

      return true;
    });

    // Apply pagination
    const offset = options.offset ?? 0;
    const limit = options.limit ?? allDiscrepancies.length;
    allDiscrepancies = allDiscrepancies.slice(offset, offset + limit);

    return allDiscrepancies;
  }

  // ── Get reconciliation history for account ──

  /**
   * Get the full reconciliation history for an account.
   * Returns results ordered by storedAt descending (newest first).
   *
   * @param accountId - The account ID
   * @param limit - Maximum number of results to return
   * @returns Ordered list of stored results
   */
  async getHistory(
    accountId: string,
    limit: number = 50,
  ): Promise<StoredReconciliationResult[]> {
    const results = await this.loadAllForAccount(accountId);
    results.sort((a, b) => b.storedAt.localeCompare(a.storedAt));
    return results.slice(0, limit);
  }

  // ══════════════════════════════════════════════════════════
  //  PRIVATE: Database persistence
  // ══════════════════════════════════════════════════════════

  /**
   * Persist a stored result to the SystemConfig table.
   */
  private async persistToDatabase(stored: StoredReconciliationResult): Promise<void> {
    const key = reconciliationKey(stored.accountId, stored.reconciliationId);
    const json = JSON.stringify(stored);

    await safeDbQuery(async () => {
      if (!db) return;
      await db.systemConfig.upsert({
        where: { key },
        create: {
          key,
          config: json,
        },
        update: {
          config: json,
        },
      });
    });
  }

  /**
   * Load a single result from the database by its exact key.
   */
  private async loadFromDatabaseByKey(key: string): Promise<StoredReconciliationResult | null> {
    const config = await safeDbQuery(async () => {
      if (!db) return null;
      return db.systemConfig.findUnique({
        where: { key },
      });
    });

    if (!config?.config) return null;

    try {
      const parsed = JSON.parse(config.config) as StoredReconciliationResult;
      // Hydrate in-memory store
      memoryStore.set(parsed.reconciliationId, parsed);
      // Update account index
      const ids = accountIndex.get(parsed.accountId) ?? [];
      if (!ids.includes(parsed.reconciliationId)) {
        ids.unshift(parsed.reconciliationId);
        accountIndex.set(parsed.accountId, ids);
      }
      return parsed;
    } catch (e) {
      console.warn('[ReconciliationStore] Failed to parse stored result:', e);
      return null;
    }
  }

  /**
   * Load a single result from the database by reconciliationId.
   * Scans all keys matching `recon_result:*:{reconciliationId}`.
   */
  private async loadFromDatabaseById(reconciliationId: string): Promise<StoredReconciliationResult | null> {
    // Search database for any key ending with this reconciliationId
    const suffix = `:${reconciliationId}`;
    const configs = await safeDbQuery(async () => {
      if (!db) return [];
      return db.systemConfig.findMany({
        where: {
          key: { startsWith: KEY_PREFIX },
        },
        take: 1000, // Bound the scan
      });
    });

    if (!configs) return null;

    for (const config of configs) {
      if (config.key.endsWith(suffix)) {
        try {
          const parsed = JSON.parse(config.config) as StoredReconciliationResult;
          if (parsed.reconciliationId === reconciliationId) {
            // Hydrate in-memory store
            memoryStore.set(parsed.reconciliationId, parsed);
            const ids = accountIndex.get(parsed.accountId) ?? [];
            if (!ids.includes(parsed.reconciliationId)) {
              ids.unshift(parsed.reconciliationId);
              accountIndex.set(parsed.accountId, ids);
            }
            return parsed;
          }
        } catch (e) {
          console.warn('[ReconciliationStore] Failed to parse stored result:', e);
        }
      }
    }

    return null;
  }

  /**
   * Load all stored results for an account from the database.
   */
  private async loadAllForAccount(accountId: string): Promise<StoredReconciliationResult[]> {
    const results: StoredReconciliationResult[] = [];

    // 1. Collect from in-memory store (using account index)
    const ids = accountIndex.get(accountId) ?? [];
    for (const id of ids) {
      const cached = memoryStore.get(id);
      if (cached) results.push(cached);
    }

    // 2. Scan database for any results not in memory
    const prefix = `${KEY_PREFIX}${accountId}:`;
    const dbConfigs = await safeDbQuery(async () => {
      if (!db) return [];
      return db.systemConfig.findMany({
        where: {
          key: { startsWith: prefix },
        },
        orderBy: { updatedAt: 'desc' },
      });
    });

    if (dbConfigs) {
      for (const config of dbConfigs) {
        try {
          const parsed = JSON.parse(config.config) as StoredReconciliationResult;

          // Skip if already in results (avoid duplicates)
          if (results.some((r) => r.reconciliationId === parsed.reconciliationId)) {
            continue;
          }

          // Hydrate in-memory store
          memoryStore.set(parsed.reconciliationId, parsed);
          const accountIds = accountIndex.get(accountId) ?? [];
          if (!accountIds.includes(parsed.reconciliationId)) {
            accountIds.unshift(parsed.reconciliationId);
            accountIndex.set(accountId, accountIds);
          }

          results.push(parsed);
        } catch (e) {
          console.warn('[ReconciliationStore] Failed to parse stored result:', e);
        }
      }
    }

    return results;
  }

  // ══════════════════════════════════════════════════════════
  //  PUBLIC: Maintenance
  // ══════════════════════════════════════════════════════════

  /**
   * Clear the in-memory cache.
   * Does NOT delete persisted data.
   * Useful for testing or forced re-hydration.
   */
  clearCache(): void {
    memoryStore.clear();
    accountIndex.clear();
  }

  /**
   * Get the number of results currently in the in-memory cache.
   */
  cacheSize(): number {
    return memoryStore.size;
  }
}

// ── Key helpers ──

/**
 * Build the SystemConfig key for a reconciliation result.
 * Format: `recon_result:{accountId}:{reconciliationId}`
 */
function reconciliationKey(accountId: string, reconciliationId: string): string {
  return `${KEY_PREFIX}${accountId}:${reconciliationId}`;
}
