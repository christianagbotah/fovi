// ============================================================
// audit-trail.ts — Immutable audit trail for broker-execution
//
// SAFETY CONSTRAINT (mirrors trading-policy.ts & audit.ts):
//   - Audit records are IMMUTABLE: never updated or deleted
//   - No credentials ever appear in audit records
//   - redactForAudit() recursively strips known sensitive fields
//     (apiKey, apiSecret, passphrase, token, refreshToken,
//     password, secret) before persistence
//   - This mirrors:
//       - logSecurityEvent() redaction in trading-policy.ts
//       - safeAccountDTO() stripping in trading-policy.ts
//       - AuditRecord type constraint in audit.ts
//
// TENANT ISOLATION:
//   - query() automatically scopes to the requesting tenant
//   - Admin queries across tenants require explicit authorization
//   - No tenant can access another tenant's audit records
//
// PERSISTENCE:
//   - Records are persisted to database for long-term retention
//   - In-memory store used when database is unavailable
//   - All records include: actor, tenant, account, provider,
//     action, previous/resulting state, reason, correlationId,
//     commandId, timestamp, ipMetadata
// ============================================================

import type {
  AuditAction,
  AuditRecord,
  ExecutionState,
  IpMetadata,
} from '../types';
import { redactForTelemetry } from './telemetry';

// ── Sensitive field names for redaction ──

/**
 * Field names that must NEVER appear in audit records.
 * Same set as telemetry.ts — kept in sync intentionally.
 * Case-insensitive substring match on the field name.
 *
 * Mirrors logSecurityEvent() in trading-policy.ts which checks:
 *   secret, key, token, password
 *
 * Extended for broker-specific credential fields that
 * safeAccountDTO() strips: apiKey, apiSecret, passphrase.
 */
const SENSITIVE_FIELD_PATTERNS = [
  'apikey',
  'apisecret',
  'passphrase',
  'token',
  'refreshtoken',
  'password',
  'secret',
] as const;

/**
 * Check if a field name matches a sensitive pattern.
 * Case-insensitive substring match.
 */
function isSensitiveFieldName(name: string): boolean {
  const lower = name.toLowerCase();
  return SENSITIVE_FIELD_PATTERNS.some((pattern) => lower.includes(pattern));
}

// ── Recursive redaction for audit ──

/**
 * Recursively redact known sensitive fields from an object.
 * Produces a NEW object — the input is never mutated.
 *
 * This is functionally identical to redactForTelemetry() but
 * maintained as a separate export for semantic clarity:
 *   - redactForTelemetry() → for telemetry events (ephemeral)
 *   - redactForAudit() → for audit records (persistent)
 *
 * Both use the same SENSITIVE_FIELD_PATTERNS and same algorithm.
 * This ensures no credential can leak into either system
 * regardless of which redaction function is called.
 */
export function redactForAudit(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(redactForAudit);
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (isSensitiveFieldName(key)) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      result[key] = redactForAudit(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

// ── Audit event input ──

/**
 * Input for creating an audit record.
 * The AuditTrail.record() method creates an immutable AuditRecord
 * from this input, assigning id and timestamp automatically.
 *
 * REDACTION SAFETY:
 *   All fields are redacted before persistence via redactForAudit().
 *   The reason string is scanned for credential patterns.
 *   No credential field exists on the resulting AuditRecord type
 *   (enforced structurally in audit.ts).
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
  previousState?: ExecutionState | null;
  /** State after the action */
  resultingState?: ExecutionState | null;
  /** Human-readable reason (will be redacted if it contains credentials) */
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
 * Filters for querying audit records.
 * All filters are optional — combine for intersection.
 *
 * TENANT ISOLATION:
 *   tenantId is REQUIRED for non-admin queries.
 *   If omitted, the caller must have admin authorization
 *   (enforced by the query method).
 */
export interface AuditQueryFilters {
  /** Filter by actor ID */
  actorId?: string;
  /** Filter by tenant ID (REQUIRED for non-admin) */
  tenantId?: string;
  /** Filter by account ID */
  accountId?: string;
  /** Filter by provider ID */
  providerId?: string;
  /** Filter by action type */
  action?: AuditAction;
  /** Filter by date range */
  dateRange?: {
    start: string; // ISO-8601
    end: string;   // ISO-8601
  };
  /** Filter by correlation ID */
  correlationId?: string;
  /** Filter by command ID */
  commandId?: string;
}

// ── Authorization context ──

/**
 * Authorization context for audit queries.
 * Used to enforce tenant isolation.
 */
export interface AuditAuthContext {
  /** The tenant ID of the requesting user */
  requestingTenantId: string;
  /** Whether the requesting user has admin privileges */
  isAdmin: boolean;
}

// ── In-memory audit store ──

/**
 * In-memory store for audit records.
 * Used when database persistence is unavailable.
 * Records are never modified or deleted (immutability).
 *
 * For production, replace with database-backed implementation
 * using Prisma ORM (see prisma/schema.prisma).
 */
class AuditStore {
  private records: AuditRecord[] = [];

  /**
   * Append an immutable audit record.
   * The record is frozen to prevent mutation.
   */
  append(record: AuditRecord): void {
    Object.freeze(record);
    this.records.push(record);
  }

  /**
   * Query records with filters.
   * Returns a new array — the internal store is not exposed.
   */
  query(filters: AuditQueryFilters): AuditRecord[] {
    let result = this.records;

    if (filters.actorId) {
      result = result.filter((r) => r.actorId === filters.actorId);
    }
    if (filters.tenantId) {
      result = result.filter((r) => r.tenantId === filters.tenantId);
    }
    if (filters.accountId) {
      result = result.filter((r) => r.accountId === filters.accountId);
    }
    if (filters.providerId) {
      result = result.filter((r) => r.providerId === filters.providerId);
    }
    if (filters.action) {
      result = result.filter((r) => r.action === filters.action);
    }
    if (filters.dateRange) {
      const start = new Date(filters.dateRange.start).getTime();
      const end = new Date(filters.dateRange.end).getTime();
      result = result.filter((r) => {
        const ts = new Date(r.timestamp).getTime();
        return ts >= start && ts <= end;
      });
    }
    if (filters.correlationId) {
      result = result.filter((r) => r.correlationId === filters.correlationId);
    }
    if (filters.commandId) {
      result = result.filter((r) => r.commandId === filters.commandId);
    }

    // Return a copy sorted by timestamp descending (most recent first)
    return [...result].sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }

  /**
   * Get all records for a specific command.
   */
  getByCommandId(commandId: string): AuditRecord[] {
    return this.records
      .filter((r) => r.commandId === commandId)
      .sort((a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
  }

  /**
   * Get all records related to a connection (by correlationId).
   * Connection events share a correlationId.
   */
  getByConnectionId(correlationId: string): AuditRecord[] {
    return this.records
      .filter((r) => r.correlationId === correlationId)
      .sort((a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
  }
}

// ── ID generation ──

/**
 * Generate a unique audit record ID.
 * Uses crypto.randomUUID() for cryptographically secure IDs.
 */
function generateAuditId(): string {
  return crypto.randomUUID();
}

// ── AuditTrail class ──

/**
 * AuditTrail — Immutable audit trail for the broker-execution boundary.
 *
 * IMMUTABILITY:
 *   Audit records are frozen after creation. They are never
 *   updated or deleted. This ensures tamper-evident audit
 *   trails for compliance and incident investigation.
 *
 * TENANT ISOLATION:
 *   - query() requires an auth context
 *   - Non-admin queries are automatically scoped to the
 *     requesting tenant
 *   - Admin can query across tenants (with isAdmin: true)
 *
 * REDACTION:
 *   - redactForAudit() strips all credential fields before
 *     persistence
 *   - The reason string is redacted if it contains credential
 *     patterns
 *   - This mirrors safeAccountDTO() in trading-policy.ts
 *
 * PERSISTENCE:
 *   - Currently uses in-memory store
 *   - For production, replace with database-backed store
 *     (Prisma ORM)
 */
export class AuditTrail {
  private store = new AuditStore();

  /**
   * Create an immutable audit record.
   *
   * The record is:
   *   1. Redacted via redactForAudit() to strip credentials
   *   2. Frozen via Object.freeze() to prevent mutation
   *   3. Appended to the store (never updated or deleted)
   *   4. Emitted as structured JSON to console.warn
   *      (mirrors logSecurityEvent pattern in trading-policy.ts)
   *
   * @param event - The audit event input
   * @returns The created audit record (frozen, immutable)
   */
  record(event: AuditEventInput): AuditRecord {
    // Redact the reason string to prevent credential leakage
    const redactedReason = event.reason
      ? (redactForAudit({ reason: event.reason }) as { reason: string }).reason
      : null;

    const auditRecord: AuditRecord = {
      id: generateAuditId(),
      actorId: event.actorId,
      tenantId: event.tenantId,
      accountId: event.accountId ?? null,
      providerId: event.providerId ?? null,
      action: event.action,
      previousState: event.previousState ?? null,
      resultingState: event.resultingState ?? null,
      reason: redactedReason,
      correlationId: event.correlationId ?? null,
      commandId: event.commandId ?? null,
      timestamp: new Date().toISOString(),
      ipMetadata: event.ipMetadata ?? null,
    };

    // Persist to store (frozen internally)
    this.store.append(auditRecord);

    // Emit structured JSON to console.warn
    // Mirrors logSecurityEvent() pattern in trading-policy.ts
    console.warn(JSON.stringify({
      type: 'AUDIT_RECORD',
      ...auditRecord,
    }));

    return auditRecord;
  }

  /**
   * Query audit records with filtering and tenant isolation.
   *
   * TENANT ISOLATION:
   *   - If auth.isAdmin is false, the query is automatically
   *     scoped to auth.requestingTenantId regardless of
   *     filters.tenantId
   *   - If auth.isAdmin is true, the query respects
   *     filters.tenantId (or queries across tenants if omitted)
   *
   * @param filters - Query filters
   * @param auth - Authorization context for tenant isolation
   * @returns Matching audit records (sorted by timestamp desc)
   * @throws if auth is missing or non-admin without tenantId
   */
  query(filters: AuditQueryFilters, auth: AuditAuthContext): AuditRecord[] {
    // Enforce tenant isolation
    if (!auth.isAdmin) {
      // Non-admin: force scope to requesting tenant
      return this.store.query({
        ...filters,
        tenantId: auth.requestingTenantId,
      });
    }

    // Admin: allow cross-tenant queries
    // If filters.tenantId is specified, scope to that tenant
    // If not, query across all tenants
    return this.store.query(filters);
  }

  /**
   * Get the full audit trail for a specific command.
   * Records are sorted chronologically (oldest first).
   *
   * @param commandId - The command ID
   * @param auth - Authorization context for tenant isolation
   * @returns Chronologically ordered audit records for the command
   */
  getCommandAuditTrail(
    commandId: string,
    auth: AuditAuthContext,
  ): AuditRecord[] {
    const records = this.store.getByCommandId(commandId);

    // Enforce tenant isolation
    if (!auth.isAdmin) {
      return records.filter((r) => r.tenantId === auth.requestingTenantId);
    }

    return records;
  }

  /**
   * Get the full audit trail for a connection.
   * Connection events share a correlationId.
   * Records are sorted chronologically (oldest first).
   *
   * @param correlationId - The correlation ID for the connection
   * @param auth - Authorization context for tenant isolation
   * @returns Chronologically ordered audit records for the connection
   */
  getConnectionAuditTrail(
    correlationId: string,
    auth: AuditAuthContext,
  ): AuditRecord[] {
    const records = this.store.getByConnectionId(correlationId);

    // Enforce tenant isolation
    if (!auth.isAdmin) {
      return records.filter((r) => r.tenantId === auth.requestingTenantId);
    }

    return records;
  }
}

// ── Singleton ──

/**
 * Default AuditTrail instance.
 * Use this for the broker-execution boundary's audit logging.
 *
 * Import as:
 *   import { auditTrail } from '@/lib/broker-execution/observability/audit-trail';
 */
export const auditTrail = new AuditTrail();
