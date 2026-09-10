// ============================================================
// ownership.ts — Server-side account/connection ownership
// resolution (CORRECTION ROUND, defects 1, 2, 7).
//
// SECURITY CONTRACT:
//   - `tenantId = authenticatedUserId` is NOT proof that an
//     accountId/connectionId belongs to that user. Ownership is
//     proven from server-side PostgreSQL records only.
//   - Cross-tenant access returns 403 WITHOUT leaking the other
//     tenant's information; unknown IDs return 404.
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
      status: 404 | 403 | 503;
      code: 'CONNECTION_NOT_FOUND' | 'TENANT_ISOLATION_VIOLATION' | 'SERVICE_UNAVAILABLE';
      message: string;
    };

/**
 * Resolve a connection by ID and prove ownership by the
 * authenticated user, from server-side PostgreSQL records.
 *
 * Behavior:
 *   - DB unavailable → 503 fail-closed (no in-memory fallback)
 *   - Connection not found → 404 (no tenant information leak)
 *   - Connection belongs to another tenant → 403 (unless an
 *     explicitly verified admin cross-tenant branch is requested
 *     and the caller is admin)
 */
export async function resolveOwnedConnection(
  connectionId: string,
  authenticatedUserId: string,
  options?: {
    /** Allow a verified admin to resolve another tenant's connection. */
    allowAdminCrossTenant?: boolean;
    /** Must be the VERIFIED role (from the proxy's JWT-derived header). */
    callerIsAdmin?: boolean;
  },
): Promise<OwnershipResolution> {
  if (typeof connectionId !== 'string' || connectionId.trim() === '') {
    return {
      ok: false,
      status: 404,
      code: 'CONNECTION_NOT_FOUND',
      message: 'Connection identifier is required.',
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
      status: 404,
      code: 'CONNECTION_NOT_FOUND',
      message: 'Connection not found.',
    };
  }

  if (connection.tenantId !== authenticatedUserId) {
    const adminBypass =
      options?.allowAdminCrossTenant === true && options?.callerIsAdmin === true;

    if (!adminBypass) {
      logSecurityEvent({
        eventType: 'OWNERSHIP_VIOLATION_BLOCKED',
        route: 'broker-execution/ownership',
        userId: authenticatedUserId,
        reason: `Cross-tenant access denied for connection=${connectionId}`,
      });
      return {
        ok: false,
        status: 403,
        code: 'TENANT_ISOLATION_VIOLATION',
        message: 'Access denied. You do not own this connection.',
      };
    }
  }

  return { ok: true, connection };
}
