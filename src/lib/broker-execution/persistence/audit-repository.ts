// ============================================================
// audit-repository.ts — PostgreSQL-backed append-only audit trail
// (CORRECTION ROUND, defect 10).
//
// SECURITY CONTRACT:
//   - BrokerExecutionAudit is the persistent, append-only audit
//     repository. The previous in-memory array + Object.freeze()
//     implementation is REMOVED — Object.freeze is not durability.
//   - There is NO update and NO delete path for audit entries.
//     Only create and read operations exist in this module.
//   - Security-critical mutations (command submission, kill-switch
//     activation/deactivation, credential writes) write their audit
//     entry INSIDE the same transaction as the mutation itself
//     (see command-repository / kill-switch-repository /
//     connection-repository) — a failed audit write rolls back the
//     mutation instead of returning false success.
//   - Credential fields and network metadata are sanitized
//     (redactForAudit) before persistence.
//   - Query paths enforce tenant isolation: non-admin queries are
//     scoped to the requesting tenant; cross-tenant queries are
//     allowed ONLY with an explicitly verified admin context.
// ============================================================

import { logSecurityEvent } from '@/lib/trading-policy';
import { requireDb, ServiceUnavailableError } from './db-access';
import { redactForAudit, sanitizeBrokerAuditInput } from '../observability/redaction';

// ── Row shape ──

export interface BrokerExecutionAuditRow {
  id: string;
  actorId: string;
  tenantId: string;
  accountId: string | null;
  providerId: string | null;
  action: string;
  previousState: string | null;
  resultingState: string | null;
  reason: string | null;
  correlationId: string | null;
  commandId: string | null;
  ipMetadata: unknown;
  timestamp: Date;
}

// ── Input types (aligned with the domain AuditEventInput) ──

export interface AuditCreateInput {
  actorId: string;
  tenantId: string;
  accountId?: string | null;
  providerId?: string | null;
  action: string;
  previousState?: string | null;
  resultingState?: string | null;
  reason?: string | null;
  correlationId?: string | null;
  commandId?: string | null;
  ipMetadata?: unknown;
}

export interface AuditQueryFilters {
  tenantId?: string;
  actorId?: string;
  action?: string;
  commandId?: string;
  correlationId?: string;
  limit?: number;
  offset?: number;
}

/** Authentication/authorization context for audit queries. */
export interface AuditAuthContext {
  /** The requesting (verified) user id. */
  userId: string;
  /** The requesting user's verified role ('admin' enables cross-tenant queries). */
  role: string | null;
  /** Explicit admin flag derived from the verified role. */
  isAdmin: boolean;
}

// ── Repository ──

/**
 * Append-only audit persistence. Fail-closed: DB failures throw
 * ServiceUnavailableError — callers must never report success for
 * a mutation whose audit write failed.
 */
export const AuditRepository = {
  /**
   * Append an audit entry.
   *
   * CORRECTION ROUND 2 (item 4): this STANDALONE path and every
   * TRANSACTIONAL path (tx.brokerExecutionAudit.create in the
   * command/connection/credential/kill-switch/reconciliation
   * repositories) run their input through the SAME pure
   * `sanitizeBrokerAuditInput()` — recursive credential redaction,
   * IP normalization, malformed-forwarded-data dropping and
   * length caps. No audit write anywhere in this codebase bypasses
   * that sanitizer.
   *
   * This is a CREATE-ONLY operation: no update/delete exists.
   */
  async append(input: AuditCreateInput): Promise<BrokerExecutionAuditRow> {
    const db = requireDb('audit repository append');

    // Sanitize the full record before it touches persistence — the
    // SAME sanitizer used inside transactional audit writes.
    const sanitized = sanitizeBrokerAuditInput({
      actorId: input.actorId,
      tenantId: input.tenantId,
      accountId: input.accountId ?? null,
      providerId: input.providerId ?? null,
      action: input.action,
      previousState: input.previousState ?? null,
      resultingState: input.resultingState ?? null,
      reason: input.reason ?? null,
      correlationId: input.correlationId ?? null,
      commandId: input.commandId ?? null,
      ipMetadata: input.ipMetadata,
    });

    const row = await db.brokerExecutionAudit.create({
      data: {
        actorId: sanitized.actorId,
        tenantId: sanitized.tenantId,
        accountId: sanitized.accountId,
        providerId: sanitized.providerId,
        action: sanitized.action,
        previousState: sanitized.previousState,
        resultingState: sanitized.resultingState,
        reason: sanitized.reason,
        correlationId: sanitized.correlationId,
        commandId: sanitized.commandId,
        ipMetadata: sanitized.ipMetadata as never,
      },
    });
    return row as unknown as BrokerExecutionAuditRow;
  },

  /**
   * Query audit entries with tenant isolation.
   *
   * - Non-admin: restricted to the requesting tenant.
   * - Admin (verified role): may query across tenants.
   */
  async query(filters: AuditQueryFilters, auth: AuditAuthContext): Promise<BrokerExecutionAuditRow[]> {
    const db = requireDb('audit repository query');

    const where: Record<string, unknown> = {};
    if (filters.actorId) where.actorId = filters.actorId;
    if (filters.action) where.action = filters.action;
    if (filters.commandId) where.commandId = filters.commandId;
    if (filters.correlationId) where.correlationId = filters.correlationId;

    if (!auth.isAdmin) {
      // Tenant isolation: non-admin queries are hard-scoped.
      where.tenantId = auth.userId;
    } else if (filters.tenantId) {
      where.tenantId = filters.tenantId;
    }

    const rows = await db.brokerExecutionAudit.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: Math.min(filters.limit ?? 100, 500),
      skip: filters.offset ?? 0,
    });
    return rows as unknown as BrokerExecutionAuditRow[];
  },

  /** Get the audit trail for a specific command (tenant-scoped). */
  async getCommandAuditTrail(commandId: string, auth: AuditAuthContext): Promise<BrokerExecutionAuditRow[]> {
    return this.query({ commandId }, auth);
  },

  /** Count audit entries (tenant-scoped; admin may count all). */
  async count(auth: AuditAuthContext, filters?: AuditQueryFilters): Promise<number> {
    const db = requireDb('audit repository count');
    const where: Record<string, unknown> = {};
    if (filters?.action) where.action = filters.action;
    if (!auth.isAdmin) {
      where.tenantId = auth.userId;
    } else if (filters?.tenantId) {
      where.tenantId = filters.tenantId;
    }
    return db.brokerExecutionAudit.count({ where });
  },
};

// ── Safe DTO ──

/** Audit DTO safe for API responses — sanitized, no credentials. */
export function toAuditDTO(row: BrokerExecutionAuditRow): Record<string, unknown> {
  return {
    id: row.id,
    actorId: row.actorId,
    tenantId: row.tenantId,
    action: row.action,
    previousState: row.previousState,
    resultingState: row.resultingState,
    reason: row.reason,
    correlationId: row.correlationId,
    commandId: row.commandId,
    ipMetadata: redactForAudit(row.ipMetadata ?? null),
    timestamp: row.timestamp,
  };
}
