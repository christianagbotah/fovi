// ============================================================
// connection-manager.ts — Broker connection management per tenant
//
// TENANT ISOLATION CONTRACT:
//   - All operations verify tenantId matches the connection's tenant
//   - No cross-tenant access allowed — throws on mismatch
//   - Credentials are NEVER returned in API responses
//   - getConnectionWithCredentials() is INTERNAL ONLY — for
//     adapter use, never exposed to API routes
//
// PHASE 1 CONTAINMENT:
//   - Credential storage delegates to CredentialVault which
//     enforces enforcePhase1CredentialIntake()
//   - testConnection() only works for demo connections
//   - Non-demo connections are registered but remain in BLOCKED state
//
// CONNECTION LIFECYCLE:
//   DISCONNECTED → CONNECTING → CONNECTED
//                    ↓              ↓
//                 FAILED      RECONNECTING → CONNECTED
//                    ↓              ↓
//               (terminal)      DEGRADED
//   Any non-demo in Phase 1 → BLOCKED (terminal)
// ============================================================

import { v4 as uuidv4 } from 'uuid';
import {
  BrokerConnectionState,
  type BrokerProviderType,
} from '@/lib/broker-execution/types/broker-adapter';
import {
  getCredentialVault,
  type BrokerCredentials,
} from './credential-vault';
import { logSecurityEvent } from '@/lib/trading-policy';

// ── Connection record types ──

/**
 * Configuration for creating a new broker connection.
 */
export interface ConnectionConfig {
  tenantId: string;
  providerType: BrokerProviderType;
  providerId: string;
  name: string;
  credentials: BrokerCredentials;
  accountContext: {
    broker: string;
    accountType: string;
    isDemo?: boolean | null;
  };
  metadata?: Record<string, string>;
}

/**
 * A broker connection record — WITHOUT credentials.
 * This is the safe representation for API responses.
 * Credentials are stored separately in CredentialVault
 * and only accessible via getConnectionWithCredentials().
 */
export interface ConnectionRecord {
  id: string;
  tenantId: string;
  providerType: BrokerProviderType;
  providerId: string;
  name: string;
  state: BrokerConnectionState;
  createdAt: string;
  updatedAt: string;
  lastConnectedAt: string | null;
  metadata: Record<string, string>;
}

/**
 * Internal connection record WITH decrypted credentials.
 * NEVER expose this through API responses.
 * Only used internally to pass credentials to broker adapters.
 */
export interface ConnectionRecordWithCredentials extends ConnectionRecord {
  credentials: BrokerCredentials;
}

/**
 * Updates that can be applied to a connection.
 * Credentials must be rotated via CredentialVault.rotateCredentials().
 */
export interface ConnectionUpdates {
  name?: string;
  state?: BrokerConnectionState;
  metadata?: Record<string, string>;
}

/**
 * Result of a connection test.
 */
export interface ConnectionTestResult {
  connectionId: string;
  success: boolean;
  state: BrokerConnectionState;
  latencyMs: number | null;
  error?: string;
}

/**
 * Audit record for connection operations.
 * Follows the same credential-redaction contract as audit.ts.
 */
export interface ConnectionAuditRecord {
  id: string;
  connectionId: string;
  tenantId: string;
  action: string;
  result: 'success' | 'failure' | 'blocked';
  reason: string | null;
  timestamp: string;
}

// ── Reconnection configuration ──

export interface ReconnectionConfig {
  /** Maximum number of reconnection attempts */
  maxAttempts: number;
  /** Base delay in milliseconds for exponential backoff */
  baseDelayMs: number;
  /** Maximum delay cap in milliseconds */
  maxDelayMs: number;
  /** Jitter factor (0-1) to add randomness to backoff */
  jitterFactor: number;
}

const DEFAULT_RECONNECTION_CONFIG: ReconnectionConfig = {
  maxAttempts: 5,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  jitterFactor: 0.25,
};

// ── ConnectionManager class ──

/**
 * ConnectionManager manages broker connections per tenant.
 *
 * TENANT ISOLATION:
 *   Every operation that accesses a connection verifies the
 *   tenantId matches. Cross-tenant access throws
 *   TenantIsolationError immediately — no data is returned.
 *
 * CREDENTIAL SAFETY:
 *   - getConnection() returns ConnectionRecord (no credentials)
 *   - listConnections() returns ConnectionRecord[] (no credentials)
 *   - getConnectionWithCredentials() returns decrypted credentials
 *     but is marked INTERNAL ONLY and must never be called from
 *     API route handlers
 */
export class ConnectionManager {
  private readonly connections = new Map<string, ConnectionRecord>();
  private readonly auditLog: ConnectionAuditRecord[] = [];
  private readonly reconnectionAttempts = new Map<string, number>();
  private readonly reconnectionTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly reconnectionConfig: ReconnectionConfig = DEFAULT_RECONNECTION_CONFIG,
  ) {}

  /**
   * Create a new broker connection.
   *
   * 1. Generates a unique connection ID
   * 2. Encrypts credentials via CredentialVault
   * 3. Creates the connection record (without credentials)
   * 4. Sets initial state based on Phase 1 containment
   */
  async createConnection(config: ConnectionConfig): Promise<ConnectionRecord> {
    const connectionId = uuidv4();
    const correlationId = uuidv4();
    const vault = getCredentialVault();

    // Store credentials via vault (enforces Phase 1 containment)
    const storeResult = await vault.storeCredentials(
      connectionId,
      config.tenantId,
      config.credentials,
      config.accountContext,
    );

    // Determine initial state based on containment result
    const initialState: BrokerConnectionState = storeResult.success
      ? BrokerConnectionState.DISCONNECTED
      : BrokerConnectionState.BLOCKED;

    const now = new Date().toISOString();
    const record: ConnectionRecord = {
      id: connectionId,
      tenantId: config.tenantId,
      providerType: config.providerType,
      providerId: config.providerId,
      name: config.name,
      state: initialState,
      createdAt: now,
      updatedAt: now,
      lastConnectedAt: null,
      metadata: config.metadata ?? {},
    };

    this.connections.set(connectionId, record);

    this.audit({
      connectionId,
      tenantId: config.tenantId,
      action: 'CREATE_CONNECTION',
      result: storeResult.success ? 'success' : 'blocked',
      reason: storeResult.success
        ? null
        : 'Phase 1 containment: credential intake blocked',
    });

    if (!storeResult.success) {
      logSecurityEvent({
        eventType: 'CONNECTION_CREATED_BLOCKED',
        correlationId,
        reason: `Connection ${connectionId} created in BLOCKED state for tenant=${config.tenantId} provider=${config.providerType}`,
      });
    }

    return record;
  }

  /**
   * Get a connection record WITHOUT credentials.
   * Safe for API responses.
   */
  getConnection(connectionId: string, tenantId: string): ConnectionRecord | null {
    const record = this.connections.get(connectionId);
    if (!record) return null;

    // Tenant isolation check
    this.verifyTenantIsolation(connectionId, record.tenantId, tenantId);

    return { ...record };
  }

  /**
   * Get a connection record WITH decrypted credentials.
   *
   * *** INTERNAL ONLY — for broker adapter use ***
   * NEVER call this from API route handlers.
   * Credentials must never be exposed in API responses.
   */
  async getConnectionWithCredentials(
    connectionId: string,
    tenantId: string,
  ): Promise<ConnectionRecordWithCredentials | null> {
    const record = this.connections.get(connectionId);
    if (!record) return null;

    // Tenant isolation check
    this.verifyTenantIsolation(connectionId, record.tenantId, tenantId);

    // Retrieve decrypted credentials from vault
    const vault = getCredentialVault();
    const credentialResult = await vault.retrieveCredentials(connectionId, tenantId);

    if (!credentialResult.success || !credentialResult.credentials) {
      this.audit({
        connectionId,
        tenantId,
        action: 'GET_CREDENTIALS',
        result: 'failure',
        reason: credentialResult.error ?? 'Unknown credential retrieval failure',
      });
      return null;
    }

    this.audit({
      connectionId,
      tenantId,
      action: 'GET_CREDENTIALS',
      result: 'success',
      reason: null,
    });

    return {
      ...record,
      credentials: credentialResult.credentials,
    };
  }

  /**
   * List all connections for a tenant.
   * Returns ConnectionRecord[] — NO credentials.
   */
  listConnections(tenantId: string): ConnectionRecord[] {
    const result: ConnectionRecord[] = [];
    for (const record of this.connections.values()) {
      if (record.tenantId === tenantId) {
        result.push({ ...record });
      }
    }
    return result;
  }

  /**
   * Update a connection's configuration.
   * Credentials are NOT updated here — use CredentialVault.rotateCredentials().
   */
  updateConnection(
    connectionId: string,
    tenantId: string,
    updates: ConnectionUpdates,
  ): ConnectionRecord | null {
    const record = this.connections.get(connectionId);
    if (!record) return null;

    // Tenant isolation check
    this.verifyTenantIsolation(connectionId, record.tenantId, tenantId);

    // Apply updates
    if (updates.name !== undefined) {
      record.name = updates.name;
    }
    if (updates.state !== undefined) {
      record.state = updates.state;
    }
    if (updates.metadata !== undefined) {
      record.metadata = { ...updates.metadata };
    }
    record.updatedAt = new Date().toISOString();

    this.audit({
      connectionId,
      tenantId,
      action: 'UPDATE_CONNECTION',
      result: 'success',
      reason: null,
    });

    return { ...record };
  }

  /**
   * Delete a connection.
   * Revokes credentials via CredentialVault and removes the record.
   */
  deleteConnection(connectionId: string, tenantId: string): boolean {
    const record = this.connections.get(connectionId);
    if (!record) return false;

    // Tenant isolation check
    this.verifyTenantIsolation(connectionId, record.tenantId, tenantId);

    // Revoke credentials
    const vault = getCredentialVault();
    vault.revokeCredentials(connectionId, tenantId);

    // Cancel any pending reconnection
    this.cancelReconnection(connectionId);

    // Remove connection record
    this.connections.delete(connectionId);
    this.reconnectionAttempts.delete(connectionId);

    this.audit({
      connectionId,
      tenantId,
      action: 'DELETE_CONNECTION',
      result: 'success',
      reason: null,
    });

    return true;
  }

  /**
   * Test connectivity for a connection.
   *
   * Phase 1 containment: only demo connections can be tested.
   * Non-demo connections always return a blocked result.
   */
  async testConnection(connectionId: string, tenantId: string): Promise<ConnectionTestResult> {
    const record = this.connections.get(connectionId);

    if (!record) {
      return {
        connectionId,
        success: false,
        state: BrokerConnectionState.DISCONNECTED,
        latencyMs: null,
        error: 'Connection not found.',
      };
    }

    // Tenant isolation check
    this.verifyTenantIsolation(connectionId, record.tenantId, tenantId);

    // Phase 1: only demo connections can be tested
    if (record.state === BrokerConnectionState.BLOCKED) {
      this.audit({
        connectionId,
        tenantId,
        action: 'TEST_CONNECTION',
        result: 'blocked',
        reason: 'Phase 1 containment: connection is in BLOCKED state',
      });
      return {
        connectionId,
        success: false,
        state: BrokerConnectionState.BLOCKED,
        latencyMs: null,
        error: 'Phase 1 containment: connection testing is not permitted for blocked connections.',
      };
    }

    // For demo connections, simulate a successful test
    if (record.providerType === 'REST_WS' || record.providerId === 'demo') {
      const startMs = Date.now();

      // Simulate connection test (demo always succeeds)
      record.state = BrokerConnectionState.CONNECTED;
      record.lastConnectedAt = new Date().toISOString();
      record.updatedAt = new Date().toISOString();

      const latencyMs = Date.now() - startMs;

      this.audit({
        connectionId,
        tenantId,
        action: 'TEST_CONNECTION',
        result: 'success',
        reason: null,
      });

      return {
        connectionId,
        success: true,
        state: BrokerConnectionState.CONNECTED,
        latencyMs,
      };
    }

    // Non-demo in Phase 1: blocked
    this.audit({
      connectionId,
      tenantId,
      action: 'TEST_CONNECTION',
      result: 'blocked',
      reason: 'Phase 1: only demo connections can be tested',
    });
    return {
      connectionId,
      success: false,
      state: BrokerConnectionState.BLOCKED,
      latencyMs: null,
      error: 'Phase 1 containment: connection testing is only available for demo connections.',
    };
  }

  /**
   * Initiate reconnection with exponential backoff.
   *
   * Calculates the next backoff delay using:
   *   delay = min(baseDelay * 2^attempt, maxDelay) * (1 + jitter * random())
   *
   * Schedules a reconnection attempt after the calculated delay.
   * After maxAttempts, the connection transitions to FAILED state.
   */
  scheduleReconnection(connectionId: string, tenantId: string): void {
    const record = this.connections.get(connectionId);
    if (!record) return;

    this.verifyTenantIsolation(connectionId, record.tenantId, tenantId);

    // Don't reconnect blocked or already-connected connections
    if (
      record.state === BrokerConnectionState.BLOCKED ||
      record.state === BrokerConnectionState.CONNECTED
    ) {
      return;
    }

    const attempts = this.reconnectionAttempts.get(connectionId) ?? 0;

    if (attempts >= this.reconnectionConfig.maxAttempts) {
      record.state = BrokerConnectionState.FAILED;
      record.updatedAt = new Date().toISOString();

      this.audit({
        connectionId,
        tenantId,
        action: 'RECONNECTION_EXHAUSTED',
        result: 'failure',
        reason: `Max reconnection attempts (${this.reconnectionConfig.maxAttempts}) reached`,
      });
      return;
    }

    // Exponential backoff with jitter
    const baseDelay = this.reconnectionConfig.baseDelayMs;
    const maxDelay = this.reconnectionConfig.maxDelayMs;
    const jitter = this.reconnectionConfig.jitterFactor;

    const exponentialDelay = Math.min(baseDelay * Math.pow(2, attempts), maxDelay);
    const jitterMultiplier = 1 + jitter * Math.random();
    const delayMs = Math.floor(exponentialDelay * jitterMultiplier);

    this.reconnectionAttempts.set(connectionId, attempts + 1);
    record.state = BrokerConnectionState.RECONNECTING;
    record.updatedAt = new Date().toISOString();

    this.audit({
      connectionId,
      tenantId,
      action: 'SCHEDULE_RECONNECTION',
      result: 'success',
      reason: `Attempt ${attempts + 1}/${this.reconnectionConfig.maxAttempts} in ${delayMs}ms`,
    });

    const timer = setTimeout(() => {
      this.reconnectionTimers.delete(connectionId);
      // In a real implementation, this would invoke the adapter's reconnect()
      // For now, we update state to indicate the attempt
      const current = this.connections.get(connectionId);
      if (current && current.state === BrokerConnectionState.RECONNECTING) {
        current.state = BrokerConnectionState.DISCONNECTED;
        current.updatedAt = new Date().toISOString();
      }
    }, delayMs);

    this.reconnectionTimers.set(connectionId, timer);
  }

  /**
   * Cancel a pending reconnection for a connection.
   */
  cancelReconnection(connectionId: string): void {
    const timer = this.reconnectionTimers.get(connectionId);
    if (timer) {
      clearTimeout(timer);
      this.reconnectionTimers.delete(connectionId);
    }
    this.reconnectionAttempts.delete(connectionId);
  }

  /**
   * Get the audit log for a tenant.
   */
  getAuditLog(tenantId: string): ConnectionAuditRecord[] {
    return this.auditLog.filter((r) => r.tenantId === tenantId);
  }

  /**
   * Get the current reconnection attempt count for a connection.
   */
  getReconnectionAttempts(connectionId: string): number {
    return this.reconnectionAttempts.get(connectionId) ?? 0;
  }

  // ── Private helpers ──

  /**
   * Verify tenant isolation — throws if the stored tenantId
   * does not match the requested tenantId.
   */
  private verifyTenantIsolation(
    connectionId: string,
    storedTenantId: string,
    requestedTenantId: string,
  ): void {
    if (storedTenantId !== requestedTenantId) {
      const correlationId = uuidv4();
      logSecurityEvent({
        eventType: 'TENANT_ISOLATION_VIOLATION',
        correlationId,
        reason: `Cross-tenant access attempt on connection=${connectionId} storedTenant=${storedTenantId} requestedTenant=${requestedTenantId}`,
      });
      throw new TenantIsolationError(
        connectionId,
        storedTenantId,
        requestedTenantId,
      );
    }
  }

  /**
   * Create and store an audit record.
   */
  private audit(params: {
    connectionId: string;
    tenantId: string;
    action: string;
    result: 'success' | 'failure' | 'blocked';
    reason: string | null;
  }): void {
    this.auditLog.push({
      id: uuidv4(),
      connectionId: params.connectionId,
      tenantId: params.tenantId,
      action: params.action,
      result: params.result,
      reason: params.reason,
      timestamp: new Date().toISOString(),
    });
  }
}

// ── Tenant isolation error ──

/**
 * Error thrown when a cross-tenant access is attempted.
 * No information about the actual tenant is included in the
 * error message to prevent information leakage.
 */
export class TenantIsolationError extends Error {
  public readonly code = 'TENANT_ISOLATION_VIOLATION';
  public readonly connectionId: string;

  constructor(
    connectionId: string,
    _storedTenantId: string,
    _requestedTenantId: string,
  ) {
    super(
      `Tenant isolation violation: access denied for connection ${connectionId}. ` +
      'Cross-tenant access is not permitted.',
    );
    this.name = 'TenantIsolationError';
    this.connectionId = connectionId;
  }
}

// ── Singleton instance ──

let _instance: ConnectionManager | null = null;

export function getConnectionManager(): ConnectionManager {
  if (!_instance) {
    _instance = new ConnectionManager();
  }
  return _instance;
}

/**
 * Reset the singleton (for testing only).
 */
export function resetConnectionManager(): void {
  _instance = null;
}
