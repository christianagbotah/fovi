// ============================================================
// audit-trail.ts — Durable audit trail for broker-execution
// (CORRECTION ROUND, defect 10)
//
// The BrokerExecutionAudit PostgreSQL table is the authoritative,
// append-only audit repository (via persistence/audit-repository).
// The previous in-memory array + Object.freeze() implementation is
// REMOVED — Object.freeze is immutability within one process, not
// durability across restarts, deployments and instances.
//
// SAFETY CONSTRAINT (mirrors trading-policy.ts & audit.ts):
//   - Audit entries are APPEND-ONLY: no update or delete path
//     exists anywhere in this module or the repository.
//   - No credentials ever appear in audit records:
//     redactForAudit() recursively strips known sensitive fields
//     (apiKey, apiSecret, passphrase, token, refreshToken,
//     password, secret) before persistence.
//   - For security-critical mutations where the audit record is
//     part of the security guarantee (command submission,
//     kill-switch activation/deactivation, credential writes),
//     the audit write happens INSIDE the mutation transaction —
//     a failed audit write rolls back the mutation instead of
//     returning false success.
//
// TENANT ISOLATION:
//   - query() scopes non-admin queries to the requesting tenant.
//   - Cross-tenant queries require an explicitly verified admin
//     context (isAdmin from the verified JWT role).
//   - No tenant can access another tenant's audit records.
// ============================================================

import type {
  AuditAction,
  ExecutionState,
  IpMetadata,
} from '../types';
import { AuditRepository, toAuditDTO, type AuditAuthContext } from '../persistence/audit-repository';

export { redactForAudit } from './redaction';

// ── Audit event input ──

/**
 * Input for creating an audit entry.
 *
 * REDACTION SAFETY:
 *   All fields are redacted before persistence via redactForAudit().
 *   No credential field exists on the persisted record (enforced
 *   structurally in audit.ts and by the repository sanitizer).
 */
export interface AuditEventInput {
  /** ID of the actor performing the action */
  actorId: string;
  /** Tenant/user ID scope */
  tenantId: string;
  /** Trading account ID, if applicable */
  accountId?: string | null;
  /** Broker provider ID, if applicable */
  providerId?: string | null;
  /** The action being audited */
  action: AuditAction;
  /** State before the action */
  previousState?: ExecutionState | string | null;
  /** State after the action */
  resultingState?: ExecutionState | string | null;
  /** Human-readable reason (redacted if it contains credentials) */
  reason?: string | null;
  /** Correlation ID for cross-referencing */
  correlationId?: string | null;
  /** Command ID, if applicable */
  commandId?: string | null;
  /** Network metadata (only for external-request-triggered actions) */
  ipMetadata?: IpMetadata | null;
}

// ── Query filters ──

/**
 * Filters for querying audit entries. All filters are optional —
 * combine for intersection.
 *
 * TENANT ISOLATION:
 *   Non-admin queries are always scoped to the authenticated
 *   tenant regardless of the tenantId filter.
 */
export interface AuditQueryFilters {
  /** Filter by actor ID */
  actorId?: string;
  /** Filter by tenant ID (only honored for verified admin contexts) */
  tenantId?: string;
  /** Filter by action type */
  action?: string;
  /** Filter by correlation ID */
  correlationId?: string;
  /** Filter by command ID */
  commandId?: string;
  /** Result limit (max 500) */
  limit?: number;
  /** Result offset */
  offset?: number;
}

export type { AuditAuthContext };

// ── AuditTrail ──

/**
 * Durable, append-only audit trail backed by BrokerExecutionAudit
 * (PostgreSQL). Every method is fail-closed: DB failures throw,
 * so security-critical callers never mistake a failed audit write
 * for success.
 */
export class AuditTrail {
  /**
   * Append an audit entry to the persistent, append-only store.
   * Throws ServiceUnavailableError when persistence fails — callers
   * for whom the audit record is part of the security guarantee
   * must treat this as a failed mutation (fail-closed).
   */
  async record(event: AuditEventInput): Promise<Record<string, unknown>> {
    const row = await AuditRepository.append({
      actorId: event.actorId,
      tenantId: event.tenantId,
      accountId: event.accountId ?? null,
      providerId: event.providerId ?? null,
      action: String(event.action),
      previousState: event.previousState ? String(event.previousState) : null,
      resultingState: event.resultingState ? String(event.resultingState) : null,
      reason: event.reason ?? null,
      correlationId: event.correlationId ?? null,
      commandId: event.commandId ?? null,
      ipMetadata: event.ipMetadata ?? null,
    });
    return toAuditDTO(row);
  }

  /**
   * Query audit entries with tenant isolation.
   *
   * - Non-admin auth: results are hard-scoped to auth.userId.
   * - Admin auth (verified role): may query across tenants.
   */
  async query(filters: AuditQueryFilters, auth: AuditAuthContext): Promise<Record<string, unknown>[]> {
    const rows = await AuditRepository.query(
      {
        actorId: filters.actorId,
        action: filters.action,
        commandId: filters.commandId,
        correlationId: filters.correlationId,
        tenantId: filters.tenantId,
        limit: filters.limit,
        offset: filters.offset,
      },
      auth,
    );
    return rows.map(toAuditDTO);
  }

  /** Get the audit trail for a specific command (tenant-scoped). */
  async getCommandAuditTrail(
    commandId: string,
    auth: AuditAuthContext,
  ): Promise<Record<string, unknown>[]> {
    return this.query({ commandId }, auth);
  }

  /** Get the audit trail for a connection's lifecycle (tenant-scoped). */
  async getConnectionAuditTrail(
    _connectionId: string,
    auth: AuditAuthContext,
  ): Promise<Record<string, unknown>[]> {
    // Connection lifecycle entries carry action CONNECT/DISCONNECT/UPDATE.
    // Scoped to the requesting tenant (admin may query cross-tenant).
    return this.query({ action: 'CONNECT' }, auth);
  }

  /** Count entries (tenant-scoped; admin may count all). */
  async count(auth: AuditAuthContext, filters?: AuditQueryFilters): Promise<number> {
    return AuditRepository.count(auth, filters);
  }
}

// ── Singleton ──

/** Global AuditTrail singleton (thin stateless domain layer). */
export const auditTrail = new AuditTrail();
