// ============================================================
// ownership.ts — Server-side account/connection ownership
// resolution (CORRECTION ROUND, defects 1, 2, 7;
// correction round 2, items 2 and 3).
//
// SECURITY CONTRACT:
//   - `tenantId = authenticatedUserId` is NOT proof that an
//     accountId/connectionId belongs to that user. Ownership is
//     proven from server-side PostgreSQL records only.
//   - EXISTENCE-ORACLE REMOVED (round 2, item 2): a connection
//     belonging to ANOTHER tenant and a connection that does NOT
//     exist produce IDENTICAL failure responses — same status
//     (404), same code (CONNECTION_NOT_FOUND), same message, same
//     response shape. An authenticated caller cannot distinguish
//     "does not exist" from "exists but owned by someone else",
//     so connection existence cannot be probed across tenants.
//     The REAL violation (connection id + owning tenant) is logged
//     internally via logSecurityEvent — never returned to the
//     caller.
//   - ADMIN CROSS-TENANT RESOLUTION REMOVED (round 2, item 3):
//     there is no admin-bypass branch. Ownership resolution is
//     strictly owner-scoped for every caller, admin or not.
//     Reconciliation and every other consumer are owner-scoped
//     end-to-end (the route may still authorize admins for their
//     own resources — but never for another tenant's).
//   - If DB/model availability cannot be proven, resolution
//     fails CLOSED with 503 — never a silent fallback.
//   - Caller-supplied tenantId/isDemo/broker/accountType values
//     are never trusted for authorization.
// ============================================================

import { logSecurityEvent } from '@/lib/trading-policy';
import { requireDb, ServiceUnavailableError, isDbUnavailableError } from '../persistence/db-access';

/** A BrokerConnection row as stored in PostgreSQL (Prisma model shape). */
export interface BrokerConnectionRow {
  id: string;
  tenantId: string;
  providerId: string;
  accountId: string | null;
  accountName: string | null;
  accountType: string;
  isDemo: boolean;
  isActive: boolean;
  connectionState: string;
  encryptedApiKey: string | null;
  encryptedApiSecret: string | null;
  encryptedPassphrase: string | null;
  encryptedToken: string | null;
  encryptedRefreshToken: string | null;
  credentialVersion: number;
  lastConnectedAt: Date | null;
  lastErrorAt: Date | null;
  errorMessage: string | null;
  reconnectAttempts: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Outcome of an ownership resolution. Never throws for business cases. */
export type OwnershipResolution =
  | { ok: true; connection: BrokerConnectionRow }
  | {
      ok: false;
      status: 404 | 503;
      code: 'CONNECTION_NOT_FOUND' | 'SERVICE_UNAVAILABLE';
      message: string;
    };

/**
 * The EXACT failure payload returned for both a non-existent
 * connection and a connection owned by another tenant.
 *
 * Indistinguishability contract (round 2, item 2): every field
 * (status, code, message) is byte-for-byte identical between the
 * two cases. Do NOT diverge these payloads — doing so reintroduces
 * the cross-tenant existence oracle.
 */
const CONNECTION_NOT_FOUND_RESPONSE = {
  status: 404 as const,
  code: 'CONNECTION_NOT_FOUND' as const,
  message: 'Connection not found.',
};

/**
 * Resolve a connection by ID and prove ownership by the
 * authenticated user, from server-side PostgreSQL records.
 *
 * Behavior:
 *   - DB unavailable → 503 fail-closed (no in-memory fallback)
 *   - Connection not found → 404 CONNECTION_NOT_FOUND
 *   - Connection belongs to another tenant → 404
 *     CONNECTION_NOT_FOUND (IDENTICAL response shape — the
 *     existence oracle is removed; the real violation is logged
 *     server-side only)
 */
export async function resolveOwnedConnection(
  connectionId: string,
  authenticatedUserId: string,
): Promise<OwnershipResolution> {
  if (typeof connectionId !== 'string' || connectionId.trim() === '') {
    return {
      ok: false,
      ...CONNECTION_NOT_FOUND_RESPONSE,
    };
  }

  let connection: BrokerConnectionRow | null;
  try {
    const db = requireDb('connection ownership resolution');
    connection = await db.brokerConnection.findUnique({
      where: { id: connectionId },
    }) as BrokerConnectionRow | null;
  } catch (error) {
    if (error instanceof ServiceUnavailableError || isDbUnavailableError(error)) {
      return {
        ok: false,
        status: 503,
        code: 'SERVICE_UNAVAILABLE',
        message: 'Connection records are unavailable (fail-closed).',
      };
    }
    logSecurityEvent({
      eventType: 'OWNERSHIP_RESOLUTION_ERROR',
      route: 'broker-execution/ownership',
      userId: authenticatedUserId,
      reason: `Connection lookup failed: ${error instanceof Error ? error.message : 'unknown'}`,
    });
    return {
      ok: false,
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
      message: 'Connection records are unavailable (fail-closed).',
    };
  }

  if (!connection) {
    // 404 without revealing whether the connection exists for another tenant.
    return {
      ok: false,
      ...CONNECTION_NOT_FOUND_RESPONSE,
    };
  }

  if (connection.tenantId !== authenticatedUserId) {
    // EXISTENCE-ORACLE REMOVED: a foreign connection must yield the
    // EXACT same 404 CONNECTION_NOT_FOUND payload as a non-existent
    // one (status, code, message, response shape). The caller learns
    // nothing about whether the connection exists. The real tenant
    // violation is preserved in the server-side security log.
    logSecurityEvent({
      eventType: 'OWNERSHIP_VIOLATION_BLOCKED',
      route: 'broker-execution/ownership',
      userId: authenticatedUserId,
      reason: `Cross-tenant access denied for connection=${connectionId} (owner=${connection.tenantId}); returning indistinguishable CONNECTION_NOT_FOUND`,
    });
    return {
      ok: false,
      ...CONNECTION_NOT_FOUND_RESPONSE,
    };
  }

  return { ok: true, connection };
}
