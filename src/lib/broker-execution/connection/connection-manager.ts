// ============================================================
// connection-manager.ts — Broker connection service layer
// (CORRECTION ROUND, defects 4, 8)
//
// This module is now a thin service layer over
// persistence/connection-repository.ts. BrokerConnection
// (PostgreSQL) is the AUTHORITATIVE connection store.
//
// REMOVED (defect 14 cleanup):
//   - the in-memory connection Map (state now survives restarts,
//     deployments and multiple instances)
//   - the exponential-backoff reconnection machinery (there is no
//     real broker transport in Phase 1 — connections to live
//     brokers are impossible by containment, and the demo
//     simulator needs no reconnection)
//
// SECURITY CONTRACT:
//   - Provider identity (type, isDemo, availability) is resolved
//     from the canonical provider registry server-side. The caller
//     may only choose a providerId — never a provider type,
//     demo classification or account type.
//   - Credentials are stored ONLY in the BrokerConnection
//     encrypted columns via the fail-closed vault (see
//     credential-vault.ts). getConnection() NEVER returns
//     credentials; getConnectionWithCredentials() is INTERNAL ONLY.
//   - Tenant isolation is enforced by DB-backed ownership checks.
//     A connection owned by another tenant resolves to the
//     indistinguishable 404 CONNECTION_NOT_FOUND (round 2, item 2)
//     — TenantIsolationError is retained as a defensive guard but
//     the ownership resolver no longer distinguishes foreign from
//     non-existent connections.
//   - Operational state (isActive/connectionState) is SERVER-DERIVED
//     (round 2, item 5): callers may only update harmless metadata
//     (accountName). No public path can set isActive.
//   - All operations write audit entries (transactional where
//     security-critical).
// ============================================================

import { logSecurityEvent } from '@/lib/trading-policy';
import {
  ConnectionRepository,
  toSafeConnectionDTO,
} from '../persistence/connection-repository';
import { resolveOwnedConnection, type BrokerConnectionRow } from '../security/ownership';
import { getCanonicalProvider } from '../providers/canonical-providers';
import type { BrokerCredentials } from './credential-vault';

// ── Public types ──

/** Connection creation request (providerId is the ONLY caller-chosen provider input). */
export interface ConnectionConfig {
  tenantId: string;
  providerId: string;
  accountId?: string | null;
  accountName?: string | null;
  credentials?: BrokerCredentials;
  /** Caller classification claims — never trusted, only contradiction-checked. */
  callerClaims?: {
    isDemo?: unknown;
    providerType?: unknown;
    accountType?: unknown;
  };
}

/** Safe connection record (NEVER contains credentials). */
export type ConnectionRecord = ReturnType<typeof toSafeConnectionDTO> & {
  id: string;
  tenantId: string;
  providerId: string;
};

/** Connection record WITH decrypted credentials — INTERNAL ONLY. */
export interface ConnectionRecordWithCredentials {
  connection: BrokerConnectionRow;
  credentials: BrokerCredentials;
}

/**
 * Mutable connection updates (round 2, item 5): harmless metadata
 * ONLY. `isActive` is deliberately absent — operational connection
 * state is derived server-side, never caller-controlled.
 */
export interface ConnectionUpdates {
  accountName?: string | null;
}

/** Connection test result. */
export interface ConnectionTestResult {
  success: boolean;
  providerId: string;
  isDemo: boolean;
  connectionState: string;
  message: string;
}

/**
 * Thrown on cross-tenant access attempts.
 *
 * Round 2, item 2: the ownership resolver now returns the
 * indistinguishable 404 CONNECTION_NOT_FOUND for foreign
 * connections, so this error is a defensive guard only. It is
 * kept so any future re-introduction of a 403-style path remains
 * mapped consistently by routes.
 */
export class TenantIsolationError extends Error {
  constructor() {
    super('Tenant isolation violation: connection belongs to another tenant.');
    this.name = 'TenantIsolationError';
  }
}

// ── ConnectionManager ──

/**
 * Broker connection service. All state lives in PostgreSQL
 * (BrokerConnection). This class holds NO mutable state.
 */
export class ConnectionManager {
  /**
   * Create a connection for a tenant. The provider is resolved from
   * the canonical registry server-side; contradictory or unknown
   * provider references are rejected. Credentials (when provided)
   * are encrypted fail-closed and stored in the encrypted columns.
   */
  async createConnection(
    config: ConnectionConfig,
    requestContext?: { actorId?: string; ipMetadata?: unknown },
  ): Promise<ConnectionRecord> {
    const result = await ConnectionRepository.createConnection({
      tenantId: config.tenantId,
      providerId: config.providerId,
      accountId: config.accountId ?? null,
      accountName: config.accountName ?? null,
      credentials: config.credentials,
      actorId: requestContext?.actorId ?? config.tenantId,
      ipMetadata: requestContext?.ipMetadata,
      callerClaims: config.callerClaims,
    });

    if (!result.ok) {
      // Re-throw typed errors for route mapping.
      const error = new Error(result.message) as Error & { status?: number; code?: string };
      error.status = result.status;
      error.code = result.code;
      throw error;
    }

    return toSafeConnectionDTO(result.connection) as ConnectionRecord;
  }

  /**
   * Get a connection by id (ownership enforced). NEVER returns
   * credentials. Returns null when not found OR when the connection
   * belongs to another tenant (indistinguishable 404 — round 2,
   * item 2). Throws a typed service-unavailable error when the DB
   * cannot be reached.
   */
  async getConnection(connectionId: string, tenantId: string): Promise<ConnectionRecord | null> {
    const resolution = await resolveOwnedConnection(connectionId, tenantId);
    if (!resolution.ok) {
      if (resolution.status === 503) {
        const error = new Error(resolution.message) as Error & { status?: number; code?: string };
        error.status = 503;
        error.code = resolution.code;
        throw error;
      }
      return null;
    }
    return toSafeConnectionDTO(resolution.connection) as ConnectionRecord;
  }

  /**
   * INTERNAL ONLY — get a connection with decrypted credentials.
   * Decryption is fail-closed for the WHOLE set (see
   * credential-vault.ts). Must never be exposed through API
   * responses.
   */
  async getConnectionWithCredentials(
    connectionId: string,
    tenantId: string,
  ): Promise<ConnectionRecordWithCredentials | null> {
    const resolution = await resolveOwnedConnection(connectionId, tenantId);
    if (!resolution.ok) {
      if (resolution.status === 503) {
        const error = new Error(resolution.message) as Error & { status?: number; code?: string };
        error.status = 503;
        error.code = resolution.code;
        throw error;
      }
      return null;
    }
    const credentials = await ConnectionRepository.getDecryptedCredentials(
      connectionId,
      tenantId,
    );
    return { connection: resolution.connection, credentials };
  }

  /** List a tenant's connections (safe DTOs — no credentials). */
  async listConnections(tenantId: string): Promise<ConnectionRecord[]> {
    const rows = await ConnectionRepository.listConnectionsByTenant(tenantId);
    return rows.map((row) => toSafeConnectionDTO(row) as ConnectionRecord);
  }

  /** Update harmless connection metadata (ownership enforced). */
  async updateConnection(
    connectionId: string,
    tenantId: string,
    updates: ConnectionUpdates,
    requestContext?: { actorId?: string },
  ): Promise<ConnectionRecord | null> {
    const result = await ConnectionRepository.updateConnection(
      connectionId,
      tenantId,
      updates,
      requestContext?.actorId ?? tenantId,
    );
    if (!result.ok) {
      const error = new Error(result.message) as Error & { status?: number; code?: string };
      error.status = result.status;
      error.code = result.code;
      throw error;
    }
    return toSafeConnectionDTO(result.connection) as ConnectionRecord;
  }

  /** Delete a connection (ownership enforced, audited). */
  async deleteConnection(
    connectionId: string,
    tenantId: string,
    requestContext?: { actorId?: string },
  ): Promise<boolean> {
    const result = await ConnectionRepository.deleteConnection(
      connectionId,
      tenantId,
      requestContext?.actorId ?? tenantId,
    );
    if (!result.ok) {
      const error = new Error(result.message) as Error & { status?: number; code?: string };
      error.status = result.status;
      error.code = result.code;
      throw error;
    }
    return true;
  }

  /**
   * Test a connection (round 2, item 5) — DEMO GATED ON BOTH SIDES.
   *
   * A test can only report success when BOTH of these hold:
   *   1. the canonical provider registry classifies the provider
   *      as isDemo === true, AND
   *   2. the persisted connection record itself is isDemo === true.
   *
   * A real/non-demo connection can NEVER be reported as
   * "tested successfully". No external broker is EVER contacted
   * (there is no transport in Phase 1) — the check is purely a
   * registry/record consistency verification.
   */
  async testConnection(connectionId: string, tenantId: string): Promise<ConnectionTestResult> {
    const resolution = await resolveOwnedConnection(connectionId, tenantId);
    if (!resolution.ok) {
      const error = new Error(resolution.message) as Error & { status?: number; code?: string };
      error.status = resolution.status;
      error.code = resolution.code;
      throw error;
    }
    const connection = resolution.connection;

    // Canonical-registry demo classification (trusted, server-side).
    const canonical = getCanonicalProvider(connection.providerId);
    const canonicalIsDemo = canonical?.isDemo === true;

    // Persisted-record demo classification.
    const recordIsDemo = connection.isDemo === true;

    if (!canonical || !canonicalIsDemo || !recordIsDemo) {
      logSecurityEvent({
        eventType: 'CONNECTION_TEST_NON_DEMO_REFUSED',
        route: 'connection-manager.testConnection',
        userId: tenantId,
        reason: `Connection test refused for non-demo connection=${connectionId} ` +
          `(provider=${connection.providerId}, canonicalIsDemo=${canonical ? canonicalIsDemo : 'unknown'}, recordIsDemo=${recordIsDemo})`,
      });
      return {
        success: false,
        providerId: connection.providerId,
        isDemo: recordIsDemo,
        connectionState: connection.connectionState,
        message:
          'Connection test refused: only demo/simulator connections can be tested ' +
          'under Phase 1 containment. No external broker contact was made.',
      };
    }

    return {
      success: true,
      providerId: connection.providerId,
      isDemo: true,
      connectionState: connection.connectionState,
      message:
        'Phase 1: demo connection verified against the canonical provider registry ' +
        '(isDemo on both the registry and the record). No external broker contact ' +
        'is possible under containment.',
    };
  }
}

// ── Singleton ──

let _instance: ConnectionManager | null = null;

/** Global ConnectionManager singleton (stateless — all truth in PostgreSQL). */
export function getConnectionManager(): ConnectionManager {
  if (!_instance) {
    _instance = new ConnectionManager();
  }
  return _instance;
}

/** Reset the singleton (for testing only). */
export function resetConnectionManager(): void {
  _instance = null;
}
