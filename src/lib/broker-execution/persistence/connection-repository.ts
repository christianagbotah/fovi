// ============================================================
// connection-repository.ts — PostgreSQL-backed broker connection
// persistence with fail-closed encrypted credentials
// (CORRECTION ROUND, defects 4, 5, 8).
//
// SECURITY CONTRACT:
//   - BrokerConnection is the authoritative connection store.
//     Credentials use the encrypted* columns — NEVER plaintext,
//     NEVER an in-memory map.
//   - Credential writes are ALL-OR-NOTHING: every non-empty field
//     is encrypted, verified non-empty AND round-trip decrypted.
//     ANY failure aborts the ENTIRE write — no partial credential
//     sets are persisted and no success is returned.
//   - Credential reads fail the WHOLE retrieval if any stored
//     non-empty value fails decryption — partial credential sets
//     are never returned as success.
//   - Provider identity (type, isDemo, availability, authType)
//     is resolved from the canonical provider registry — never
//     from caller-supplied values.
//   - Non-demo credential intake is blocked by
//     enforcePhase1CredentialIntake() before any storage.
//   - Security-critical mutations write their audit entry in the
//     SAME transaction (fail-closed).
//   - API responses never include encrypted credential columns
//     (toSafeConnectionDTO).
// ============================================================

import { enforcePhase1CredentialIntake, logSecurityEvent } from '@/lib/trading-policy';
import { requireDb, ServiceUnavailableError } from './db-access';
import { resolveProviderForConnection } from '../providers/canonical-providers';
import { resolveOwnedConnection, type BrokerConnectionRow } from '../security/ownership';
import { sanitizeBrokerAuditInput } from '../observability/redaction';
import {
  encryptCredentialFields,
  decryptCredentialFields,
  CredentialEncryptionFailureError,
  CREDENTIAL_FIELDS,
  type BrokerCredentials,
} from '../connection/credential-vault';

// ── Inputs ──

export interface CreateConnectionInput {
  tenantId: string;
  providerId: string;
  accountId?: string | null;
  accountName?: string | null;
  /** Optional credentials (demo only — non-demo intake is blocked). */
  credentials?: BrokerCredentials;
  actorId: string;
  ipMetadata?: unknown;
  /**
   * Caller-supplied classification claims (isDemo/providerType/
   * accountType). NEVER trusted — passed only so the canonical
   * resolver can detect and REJECT contradictions.
   */
  callerClaims?: {
    isDemo?: unknown;
    providerType?: unknown;
    accountType?: unknown;
  };
}

export interface UpdateConnectionInput {
  /** Harmless display metadata ONLY (round 2, item 5). */
  accountName?: string | null;
}

// ── Containment result for credential intake ──

/** Thrown inside the create transaction when Phase 1 blocks credential intake. */
class Phase1CredentialIntakeBlockedError extends Error {
  readonly code = 'PHASE1_CREDENTIAL_INTAKE_DISABLED';
  constructor(message: string) {
    super(message);
    this.name = 'Phase1CredentialIntakeBlockedError';
  }
}

// ── Repository ──

export const ConnectionRepository = {
  /**
   * Create a broker connection. Provider identity is resolved from
   * the canonical registry server-side; caller-supplied provider
   * classification is never trusted. Credentials (when provided)
   * are encrypted with fail-closed verification and stored in the
   * BrokerConnection encrypted columns — never plaintext.
   */
  async createConnection(input: CreateConnectionInput): Promise<
    | { ok: true; connection: BrokerConnectionRow }
    | { ok: false; status: 400 | 403 | 503; code: string; message: string }
  > {
    const providerResolution = resolveProviderForConnection(
      input.providerId,
      input.callerClaims,
    );
    if (!providerResolution.ok) {
      return {
        ok: false,
        status: providerResolution.status,
        code: providerResolution.code,
        message: providerResolution.reason,
      };
    }
    const provider = providerResolution.provider;

    // Derive server-side trusted classification.
    const accountType = provider.isDemo ? 'demo' : 'live';
    const isDemo = provider.isDemo;

    const db = requireDb('connection repository create');

    try {
      const connection = await db.$transaction(async (tx) => {
        const created = await tx.brokerConnection.create({
          data: {
            tenantId: input.tenantId,
            providerId: provider.providerId,
            accountId: input.accountId ?? null,
            accountName: input.accountName ?? null,
            accountType,
            isDemo,
            isActive: false,
            connectionState: 'DISCONNECTED',
          },
        });

        // Bind credential encryption to the FINAL connection id (AAD includes it).
        // Phase 1 enforcement FIRST: non-demo credential intake is blocked
        // before any encryption or storage (demo-only triple check).
        // Fail-closed encryption: any field failure aborts the ENTIRE transaction —
        // no connection record and no partial credentials are persisted.
        if (
          input.credentials &&
          CREDENTIAL_FIELDS.some((f) => (input.credentials as Record<string, string | undefined>)[f])
        ) {
          const intake = enforcePhase1CredentialIntake(provider.providerId, accountType, isDemo);
          if (intake.blocked) {
            logSecurityEvent({
              eventType: 'CREDENTIAL_INTAKE_BLOCKED',
              route: 'connection-repository',
              userId: input.tenantId,
              reason: `Phase 1 blocked credential intake for provider=${provider.providerId}`,
            });
            throw new Phase1CredentialIntakeBlockedError(
              'Phase 1 containment: live broker credential intake is not permitted.',
            );
          }

          const bound = await encryptCredentialFields(
            input.credentials,
            input.tenantId,
            created.id,
          );
          const updated = await tx.brokerConnection.update({
            where: { id: created.id },
            data: {
              encryptedApiKey: bound.apiKey ?? null,
              encryptedApiSecret: bound.apiSecret ?? null,
              encryptedPassphrase: bound.passphrase ?? null,
              encryptedToken: bound.token ?? null,
              encryptedRefreshToken: bound.refreshToken ?? null,
              credentialVersion: 1,
            },
          });
          await tx.brokerExecutionAudit.create({
            data: sanitizeBrokerAuditInput({
              actorId: input.actorId,
              tenantId: input.tenantId,
              accountId: input.accountId ?? null,
              providerId: provider.providerId,
              action: 'CREDENTIALS_STORED',
              resultingState: 'DISCONNECTED',
              reason: 'Credentials encrypted (AES-256-GCM, AAD-bound) and stored',
              commandId: null,
              ipMetadata: input.ipMetadata,
            }) as never,
          });
          return updated;
        }

        await tx.brokerExecutionAudit.create({
          data: sanitizeBrokerAuditInput({
            actorId: input.actorId,
            tenantId: input.tenantId,
            accountId: input.accountId ?? null,
            providerId: provider.providerId,
            action: 'CONNECT',
            resultingState: 'DISCONNECTED',
            reason: `Connection created for canonical provider ${provider.providerId} (isDemo=${provider.isDemo})`,
            commandId: null,
            ipMetadata: input.ipMetadata,
          }) as never,
        });

        return created;
      });

      return { ok: true, connection: connection as unknown as BrokerConnectionRow };
    } catch (error) {
      if (error instanceof Phase1CredentialIntakeBlockedError) {
        return {
          ok: false,
          status: 403,
          code: 'PHASE1_CREDENTIAL_INTAKE_DISABLED',
          message: error.message,
        };
      }
      if (error instanceof CredentialEncryptionFailureError) {
        logSecurityEvent({
          eventType: 'CREDENTIAL_ENCRYPTION_FAIL_CLOSED',
          route: 'connection-repository',
          userId: input.tenantId,
          reason: `Credential encryption failed; connection creation aborted: ${error.message}`,
        });
        return {
          ok: false,
          status: 503,
          code: 'CREDENTIAL_ENCRYPTION_FAILED',
          message: 'Credential encryption failed — connection was not created (fail-closed).',
        };
      }
      if (error instanceof ServiceUnavailableError) {
        return {
          ok: false,
          status: 503,
          code: 'SERVICE_UNAVAILABLE',
          message: 'Connection persistence is unavailable (fail-closed).',
        };
      }
      logSecurityEvent({
        eventType: 'CONNECTION_CREATE_ERROR',
        route: 'connection-repository',
        userId: input.tenantId,
        reason: `Connection create failed: ${error instanceof Error ? error.message : 'unknown'}`,
      });
      return {
        ok: false,
        status: 503,
        code: 'SERVICE_UNAVAILABLE',
        message: 'Connection persistence failed (fail-closed).',
      };
    }
  },

  /** Get a connection by id with PROOF of ownership by the given tenant. */
  async getConnectionForTenant(
    connectionId: string,
    tenantId: string,
  ): Promise<{ ok: true; connection: BrokerConnectionRow } | { ok: false; status: number; code: string; message: string }> {
    const resolution = await resolveOwnedConnection(connectionId, tenantId);
    if (!resolution.ok) {
      return {
        ok: false,
        status: resolution.status,
        code: resolution.code,
        message: resolution.message,
      };
    }
    return { ok: true, connection: resolution.connection };
  },

  /** List connections for a tenant (safe DTOs — no credential columns). */
  async listConnectionsByTenant(tenantId: string): Promise<BrokerConnectionRow[]> {
    const db = requireDb('connection repository list');
    const rows = await db.brokerConnection.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
    return rows as unknown as BrokerConnectionRow[];
  },

  /**
   * Update harmless connection metadata (ownership enforced;
   * round 2, item 5: operational state such as isActive is
   * server-derived and NOT caller-settable). Credentials are NOT
   * updatable through this method.
   */
  async updateConnection(
    connectionId: string,
    tenantId: string,
    updates: UpdateConnectionInput,
    actorId: string,
  ): Promise<{ ok: true; connection: BrokerConnectionRow } | { ok: false; status: number; code: string; message: string }> {
    const owned = await this.getConnectionForTenant(connectionId, tenantId);
    if (!owned.ok) return owned;

    const db = requireDb('connection repository update');
    try {
      const updated = await db.$transaction(async (tx) => {
        const row = await tx.brokerConnection.update({
          where: { id: connectionId },
          data: {
            ...(updates.accountName !== undefined ? { accountName: updates.accountName } : {}),
          },
        });
        await tx.brokerExecutionAudit.create({
          data: sanitizeBrokerAuditInput({
            actorId,
            tenantId,
            providerId: row.providerId,
            action: 'UPDATE',
            previousState: owned.connection.connectionState,
            resultingState: row.connectionState,
            reason: 'Connection metadata updated (operational state is server-derived)',
            commandId: null,
          }) as never,
        });
        return row;
      });
      return { ok: true, connection: updated as unknown as BrokerConnectionRow };
    } catch (error) {
      if (error instanceof ServiceUnavailableError) {
        return { ok: false, status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Connection update is unavailable (fail-closed).' };
      }
      return { ok: false, status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Connection update failed (fail-closed).' };
    }
  },

  /**
   * Delete a connection (ownership enforced). Audit written in the
   * same transaction. Reconciliation records reference connections
   * via FK RESTRICT — deleting referenced connections fails safely.
   */
  async deleteConnection(
    connectionId: string,
    tenantId: string,
    actorId: string,
  ): Promise<{ ok: true } | { ok: false; status: number; code: string; message: string }> {
    const owned = await this.getConnectionForTenant(connectionId, tenantId);
    if (!owned.ok) return owned;

    const db = requireDb('connection repository delete');
    try {
      await db.$transaction(async (tx) => {
        await tx.brokerConnection.delete({ where: { id: connectionId } });
        await tx.brokerExecutionAudit.create({
          data: sanitizeBrokerAuditInput({
            actorId,
            tenantId,
            providerId: owned.connection.providerId,
            action: 'DISCONNECT',
            previousState: owned.connection.connectionState,
            resultingState: 'DELETED',
            reason: 'Connection deleted by owner',
            commandId: null,
          }) as never,
        });
      });
      return { ok: true };
    } catch (error) {
      if (error instanceof ServiceUnavailableError) {
        return { ok: false, status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Connection deletion is unavailable (fail-closed).' };
      }
      const message = error instanceof Error ? error.message : '';
      if (/foreign key|restrict/i.test(message)) {
        return {
          ok: false,
          status: 409,
          code: 'CONNECTION_IN_USE',
          message: 'Connection has dependent records (e.g. command history) and cannot be deleted.',
        };
      }
      return { ok: false, status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Connection deletion failed (fail-closed).' };
    }
  },

  /**
   * Update (rotate) the stored credentials for an owned connection.
   * Fail-closed: Phase 1 intake enforcement first, then all-or-nothing
   * encryption (any field failure aborts the whole write — no partial
   * credential sets). The audit entry is written in the same transaction.
   */
  async updateCredentials(
    connectionId: string,
    tenantId: string,
    credentials: BrokerCredentials,
    actorId: string,
  ): Promise<{ ok: true; credentialVersion: number } | { ok: false; status: number; code: string; message: string }> {
    const owned = await this.getConnectionForTenant(connectionId, tenantId);
    if (!owned.ok) return owned;

    const connection = owned.connection;
    const accountType = connection.accountType;
    const isDemo = connection.isDemo;

    const db = requireDb('connection repository update-credentials');
    try {
      const credentialVersion = await db.$transaction(async (tx) => {
        const intake = enforcePhase1CredentialIntake(connection.providerId, accountType, isDemo);
        if (intake.blocked) {
          logSecurityEvent({
            eventType: 'CREDENTIAL_INTAKE_BLOCKED',
            route: 'connection-repository',
            userId: tenantId,
            reason: `Phase 1 blocked credential update for provider=${connection.providerId}`,
          });
          throw new Phase1CredentialIntakeBlockedError(
            'Phase 1 containment: credential update is not permitted for non-demo accounts.',
          );
        }

        // Fail-closed encryption bound to the FINAL connection id.
        const bound = await encryptCredentialFields(credentials, tenantId, connectionId);
        const updated = await tx.brokerConnection.update({
          where: { id: connectionId },
          data: {
            encryptedApiKey: bound.apiKey ?? null,
            encryptedApiSecret: bound.apiSecret ?? null,
            encryptedPassphrase: bound.passphrase ?? null,
            encryptedToken: bound.token ?? null,
            encryptedRefreshToken: bound.refreshToken ?? null,
            credentialVersion: { increment: 1 },
          },
        });

        await tx.brokerExecutionAudit.create({
          data: sanitizeBrokerAuditInput({
            actorId,
            tenantId,
            providerId: connection.providerId,
            action: 'CREDENTIALS_ROTATED',
            previousState: connection.connectionState,
            resultingState: updated.connectionState,
            reason: 'Credentials rotated (AES-256-GCM, AAD-bound, fail-closed verified)',
            commandId: null,
          }) as never,
        });
        return updated.credentialVersion;
      });
      return { ok: true, credentialVersion };
    } catch (error) {
      if (error instanceof Phase1CredentialIntakeBlockedError) {
        return { ok: false, status: 403, code: 'PHASE1_CREDENTIAL_INTAKE_DISABLED', message: error.message };
      }
      if (error instanceof CredentialEncryptionFailureError) {
        return {
          ok: false,
          status: 503,
          code: 'CREDENTIAL_ENCRYPTION_FAILED',
          message: 'Credential encryption failed — nothing was persisted (fail-closed).',
        };
      }
      if (error instanceof ServiceUnavailableError) {
        return { ok: false, status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Credential persistence is unavailable (fail-closed).' };
      }
      return { ok: false, status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Credential update failed (fail-closed).' };
    }
  },

  /**
   * INTERNAL ONLY — retrieve decrypted credentials for a connection.
   * Fails the ENTIRE retrieval if any stored non-empty encrypted
   * value fails decryption (fail-closed, no partial credentials).
   * Never exposed through API responses.
   */
  async getDecryptedCredentials(
    connectionId: string,
    tenantId: string,
  ): Promise<BrokerCredentials> {
    const owned = await this.getConnectionForTenant(connectionId, tenantId);
    if (!owned.ok) {
      throw new Error('Connection not found or not owned by tenant.');
    }
    const connection = owned.connection;
    const stored: Record<string, string> = {
      apiKey: connection.encryptedApiKey ?? '',
      apiSecret: connection.encryptedApiSecret ?? '',
      passphrase: connection.encryptedPassphrase ?? '',
      token: connection.encryptedToken ?? '',
      refreshToken: connection.encryptedRefreshToken ?? '',
    };
    // Whole-retrieval fail-closed decrypt (throws on any failure).
    return decryptCredentialFields(stored, tenantId, connectionId);
  },

  /** Whether a connection has any stored credentials (no decryption). */
  hasStoredCredentials(connection: BrokerConnectionRow): boolean {
    return CREDENTIAL_FIELDS.some((f) => {
      const column = credentialColumnForField(f);
      return !!connection[column] && connection[column] !== '';
    });
  },
};

/** Map credential field name to the BrokerConnection column. */
function credentialColumnForField(field: string): keyof BrokerConnectionRow {
  switch (field) {
    case 'apiKey': return 'encryptedApiKey';
    case 'apiSecret': return 'encryptedApiSecret';
    case 'passphrase': return 'encryptedPassphrase';
    case 'token': return 'encryptedToken';
    case 'refreshToken': return 'encryptedRefreshToken';
    default: return 'encryptedApiKey';
  }
}

// ── Safe DTO ──

/**
 * Connection DTO safe for API responses. NEVER includes the
 * encrypted credential columns.
 */
export function toSafeConnectionDTO(row: BrokerConnectionRow): Record<string, unknown> {
  return {
    id: row.id,
    tenantId: row.tenantId,
    providerId: row.providerId,
    accountId: row.accountId,
    accountName: row.accountName,
    accountType: row.accountType,
    isDemo: row.isDemo,
    isActive: row.isActive,
    connectionState: row.connectionState,
    hasCredentials: ConnectionRepository.hasStoredCredentials(row),
    credentialVersion: row.credentialVersion,
    lastConnectedAt: row.lastConnectedAt,
    lastErrorAt: row.lastErrorAt,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
