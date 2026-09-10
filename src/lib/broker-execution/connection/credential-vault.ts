// ============================================================
// credential-vault.ts — Encrypted credential storage for broker connections
//
// SECURITY CONTRACT:
//   - All credentials encrypted with AES-256-GCM via @/lib/encryption
//   - AAD bound to "fovi:broker-credential:{tenantId}:{connectionId}"
//     prevents ciphertext transplant across tenants or connections
//   - enforcePhase1CredentialIntake() MUST be called before any
//     non-demo credential storage — Phase 1 blocks live credential intake
//   - Credentials are NEVER returned in API responses — only decrypted
//     for broker adapter use via retrieveCredentials()
//   - redactCredentials() replaces every field with "***REDACTED***"
//   - Encrypted format: enc:v3:{base64(iv+ciphertext+tag)}
//     (v3 = AAD-bound, distinguishes from legacy v1/v2 formats)
// ============================================================

import { encrypt, decrypt } from '@/lib/encryption';
import { enforcePhase1CredentialIntake, logSecurityEvent } from '@/lib/trading-policy';
import { v4 as uuidv4 } from 'uuid';

// ── Credential field types ──

/**
 * Broker credential fields.
 * All fields are optional — which fields are required depends on the
 * provider type (e.g., OAuth providers use token/refreshToken,
 * API-key providers use apiKey/apiSecret, some use passphrase).
 */
export interface BrokerCredentials {
  apiKey?: string;
  apiSecret?: string;
  passphrase?: string;
  token?: string;
  refreshToken?: string;
}

/**
 * Encrypted credential record stored in the vault.
 * Each field is individually encrypted with AAD binding.
 * Format per field: "enc:v3:{base64(iv+ciphertext+tag)}"
 */
export interface EncryptedCredentialRecord {
  connectionId: string;
  tenantId: string;
  encryptedFields: Record<keyof BrokerCredentials, string>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Result of a credential storage operation.
 * Contains the encrypted record — NEVER the plaintext.
 */
export interface CredentialStoreResult {
  success: boolean;
  connectionId: string;
  tenantId: string;
  encryptedRecord: EncryptedCredentialRecord | null;
  error?: string;
}

/**
 * Result of a credential retrieval operation.
 * Plaintext credentials are ONLY available here — this type
 * must NEVER appear in API responses.
 */
export interface CredentialRetrieveResult {
  success: boolean;
  credentials: BrokerCredentials | null;
  error?: string;
}

// ── Constants ──

const ENCRYPTION_PREFIX = 'enc:v3:';
const REDACTED_VALUE = '***REDACTED***';

/**
 * Build the AAD context string for a credential encryption binding.
 * Format: "fovi:broker-credential:{tenantId}:{connectionId}"
 * This binds the ciphertext to a specific tenant+connection pair,
 * preventing transplant attacks where a ciphertext from one context
 * is decrypted in another.
 */
function buildCredentialAAD(tenantId: string, connectionId: string): string {
  return `fovi:broker-credential:${tenantId}:${connectionId}`;
}

/**
 * Check if a stored value is in the v3 AAD-bound encrypted format.
 */
export function isEncryptedV3(value: string): boolean {
  return typeof value === 'string' && value.startsWith(ENCRYPTION_PREFIX);
}

/**
 * Strip the encryption prefix to get the raw base64 payload.
 */
function stripPrefix(encryptedValue: string): string {
  return encryptedValue.slice(ENCRYPTION_PREFIX.length);
}

/**
 * Add the encryption prefix to a base64 payload.
 */
function addPrefix(base64Payload: string): string {
  return `${ENCRYPTION_PREFIX}${base64Payload}`;
}

// ── CredentialVault class ──

/**
 * CredentialVault manages encrypted credential storage for broker connections.
 *
 * SECURITY GUARANTEES:
 *   1. All credentials encrypted with AES-256-GCM (encryption.ts)
 *   2. AAD binding prevents cross-tenant/cross-connection decryption
 *   3. Phase 1 enforcement: non-demo credential intake is blocked
 *   4. Credentials NEVER appear in API responses
 *   5. Redaction utilities ensure safe logging/serialization
 *
 * STORAGE MODEL:
 *   In-memory store with Map keyed by "{tenantId}:{connectionId}".
 *   In production, this would be backed by a persistent encrypted store
 *   (database with encryption at rest). The in-memory model ensures
 *   credentials never touch disk unencrypted and provides the same
 *   security contract for the vault API surface.
 */
export class CredentialVault {
  private readonly store = new Map<string, EncryptedCredentialRecord>();

  /**
   * Build the composite key for the internal store.
   */
  private storeKey(connectionId: string, tenantId: string): string {
    return `${tenantId}:${connectionId}`;
  }

  /**
   * Store credentials for a broker connection.
   *
   * CONTAINMENT:
   *   - Calls enforcePhase1CredentialIntake() before any non-demo
   *     credential storage. Phase 1 blocks live credential intake.
   *   - Demo credentials (broker=demo, accountType=demo, isDemo=true)
   *     are the only credentials allowed during Phase 1.
   *
   * ENCRYPTION:
   *   - Each credential field is individually encrypted with AES-256-GCM
   *   - AAD bound to "fovi:broker-credential:{tenantId}:{connectionId}"
   *   - Output format: "enc:v3:{base64(iv+ciphertext+tag)}"
   *
   * @param connectionId - Unique connection identifier
   * @param tenantId - Tenant identifier for isolation
   * @param credentials - Plaintext credential fields to encrypt and store
   * @param accountContext - Account context for Phase 1 enforcement
   */
  async storeCredentials(
    connectionId: string,
    tenantId: string,
    credentials: BrokerCredentials,
    accountContext: {
      broker: string;
      accountType: string;
      isDemo?: boolean | null;
    },
  ): Promise<CredentialStoreResult> {
    const correlationId = uuidv4();

    // Phase 1 enforcement: block non-demo credential intake
    const policyResult = enforcePhase1CredentialIntake(
      accountContext.broker,
      accountContext.accountType,
      accountContext.isDemo,
    );

    if (policyResult.blocked) {
      logSecurityEvent({
        eventType: 'CREDENTIAL_STORAGE_BLOCKED',
        correlationId,
        reason: `Phase 1 blocked credential storage for connection=${connectionId} tenant=${tenantId} broker=${accountContext.broker}`,
      });
      return {
        success: false,
        connectionId,
        tenantId,
        encryptedRecord: null,
        error: 'Phase 1 containment: credential intake is not permitted for non-demo accounts.',
      };
    }

    try {
      const aad = buildCredentialAAD(tenantId, connectionId);
      const encryptedFields: Record<keyof BrokerCredentials, string> = {
        apiKey: '',
        apiSecret: '',
        passphrase: '',
        token: '',
        refreshToken: '',
      };

      // Encrypt each non-empty field individually
      const fields: (keyof BrokerCredentials)[] = [
        'apiKey', 'apiSecret', 'passphrase', 'token', 'refreshToken',
      ];

      for (const field of fields) {
        const value = credentials[field];
        if (value && value.length > 0) {
          const encrypted = await encrypt(value, aad);
          encryptedFields[field] = addPrefix(encrypted);
        }
      }

      const now = new Date().toISOString();
      const record: EncryptedCredentialRecord = {
        connectionId,
        tenantId,
        encryptedFields,
        createdAt: now,
        updatedAt: now,
      };

      this.store.set(this.storeKey(connectionId, tenantId), record);

      logSecurityEvent({
        eventType: 'CREDENTIAL_STORED',
        correlationId,
        reason: `Credentials encrypted and stored for connection=${connectionId} tenant=${tenantId}`,
      });

      return {
        success: true,
        connectionId,
        tenantId,
        encryptedRecord: record,
      };
    } catch (error) {
      logSecurityEvent({
        eventType: 'CREDENTIAL_STORAGE_ERROR',
        correlationId,
        reason: `Failed to encrypt/store credentials for connection=${connectionId} tenant=${tenantId}: ${error instanceof Error ? error.message : 'unknown'}`,
      });
      return {
        success: false,
        connectionId,
        tenantId,
        encryptedRecord: null,
        error: 'Credential encryption failed.',
      };
    }
  }

  /**
   * Retrieve and decrypt credentials for a broker connection.
   *
   * SECURITY: This method is INTERNAL ONLY — for broker adapter use.
   * Credentials must NEVER be exposed through API responses.
   * Use redactCredentials() for any external-facing representation.
   *
   * AAD binding ensures that credentials can only be decrypted
   * with the correct tenant+connection context. A mismatch
   * (e.g., cross-tenant attempt) will fail decryption.
   *
   * @param connectionId - Unique connection identifier
   * @param tenantId - Tenant identifier (must match the stored record)
   */
  async retrieveCredentials(
    connectionId: string,
    tenantId: string,
  ): Promise<CredentialRetrieveResult> {
    const correlationId = uuidv4();
    const key = this.storeKey(connectionId, tenantId);
    const record = this.store.get(key);

    if (!record) {
      logSecurityEvent({
        eventType: 'CREDENTIAL_RETRIEVAL_MISSING',
        correlationId,
        reason: `No credentials found for connection=${connectionId} tenant=${tenantId}`,
      });
      return {
        success: false,
        credentials: null,
        error: 'Credentials not found for this connection.',
      };
    }

    try {
      const aad = buildCredentialAAD(tenantId, connectionId);
      const credentials: BrokerCredentials = {};

      const fields: (keyof BrokerCredentials)[] = [
        'apiKey', 'apiSecret', 'passphrase', 'token', 'refreshToken',
      ];

      for (const field of fields) {
        const encryptedValue = record.encryptedFields[field];
        if (encryptedValue && isEncryptedV3(encryptedValue)) {
          const rawBase64 = stripPrefix(encryptedValue);
          const decrypted = await decrypt(rawBase64, aad);
          if (decrypted) {
            credentials[field] = decrypted;
          }
        }
      }

      logSecurityEvent({
        eventType: 'CREDENTIAL_RETRIEVED',
        correlationId,
        reason: `Credentials decrypted for connection=${connectionId} tenant=${tenantId}`,
      });

      return {
        success: true,
        credentials,
      };
    } catch (error) {
      logSecurityEvent({
        eventType: 'CREDENTIAL_RETRIEVAL_ERROR',
        correlationId,
        reason: `Failed to decrypt credentials for connection=${connectionId} tenant=${tenantId}: ${error instanceof Error ? error.message : 'unknown'}`,
      });
      return {
        success: false,
        credentials: null,
        error: 'Credential decryption failed.',
      };
    }
  }

  /**
   * Rotate credentials for a broker connection.
   *
   * Replaces existing encrypted credentials with new encrypted values.
   * The old credentials are overwritten in memory (no history retained
   * in the vault — audit trail captures the rotation event).
   *
   * CONTAINMENT: Same Phase 1 enforcement as storeCredentials().
   *
   * @param connectionId - Unique connection identifier
   * @param tenantId - Tenant identifier
   * @param newCredentials - New plaintext credential fields
   * @param accountContext - Account context for Phase 1 enforcement
   */
  async rotateCredentials(
    connectionId: string,
    tenantId: string,
    newCredentials: BrokerCredentials,
    accountContext: {
      broker: string;
      accountType: string;
      isDemo?: boolean | null;
    },
  ): Promise<CredentialStoreResult> {
    const correlationId = uuidv4();

    // Phase 1 enforcement
    const policyResult = enforcePhase1CredentialIntake(
      accountContext.broker,
      accountContext.accountType,
      accountContext.isDemo,
    );

    if (policyResult.blocked) {
      logSecurityEvent({
        eventType: 'CREDENTIAL_ROTATION_BLOCKED',
        correlationId,
        reason: `Phase 1 blocked credential rotation for connection=${connectionId} tenant=${tenantId}`,
      });
      return {
        success: false,
        connectionId,
        tenantId,
        encryptedRecord: null,
        error: 'Phase 1 containment: credential rotation is not permitted for non-demo accounts.',
      };
    }

    // Verify existing credentials exist
    const key = this.storeKey(connectionId, tenantId);
    const existing = this.store.get(key);
    if (!existing) {
      logSecurityEvent({
        eventType: 'CREDENTIAL_ROTATION_MISSING',
        correlationId,
        reason: `Cannot rotate: no existing credentials for connection=${connectionId} tenant=${tenantId}`,
      });
      return {
        success: false,
        connectionId,
        tenantId,
        encryptedRecord: null,
        error: 'No existing credentials to rotate.',
      };
    }

    try {
      const aad = buildCredentialAAD(tenantId, connectionId);
      const encryptedFields: Record<keyof BrokerCredentials, string> = {
        apiKey: '',
        apiSecret: '',
        passphrase: '',
        token: '',
        refreshToken: '',
      };

      const fields: (keyof BrokerCredentials)[] = [
        'apiKey', 'apiSecret', 'passphrase', 'token', 'refreshToken',
      ];

      for (const field of fields) {
        const value = newCredentials[field];
        if (value && value.length > 0) {
          const encrypted = await encrypt(value, aad);
          encryptedFields[field] = addPrefix(encrypted);
        }
      }

      const now = new Date().toISOString();
      const record: EncryptedCredentialRecord = {
        connectionId,
        tenantId,
        encryptedFields,
        createdAt: existing.createdAt, // preserve original creation time
        updatedAt: now,
      };

      this.store.set(key, record);

      logSecurityEvent({
        eventType: 'CREDENTIAL_ROTATED',
        correlationId,
        reason: `Credentials rotated for connection=${connectionId} tenant=${tenantId}`,
      });

      return {
        success: true,
        connectionId,
        tenantId,
        encryptedRecord: record,
      };
    } catch (error) {
      logSecurityEvent({
        eventType: 'CREDENTIAL_ROTATION_ERROR',
        correlationId,
        reason: `Failed to rotate credentials for connection=${connectionId} tenant=${tenantId}: ${error instanceof Error ? error.message : 'unknown'}`,
      });
      return {
        success: false,
        connectionId,
        tenantId,
        encryptedRecord: null,
        error: 'Credential rotation encryption failed.',
      };
    }
  }

  /**
   * Revoke (securely remove) credentials for a broker connection.
   *
   * Overwrites the in-memory record and deletes it from the store.
   * In a persistent backing store, this would also issue a secure
   * delete command. The audit trail records the revocation.
   *
   * @param connectionId - Unique connection identifier
   * @param tenantId - Tenant identifier
   */
  revokeCredentials(connectionId: string, tenantId: string): boolean {
    const correlationId = uuidv4();
    const key = this.storeKey(connectionId, tenantId);
    const record = this.store.get(key);

    if (!record) {
      logSecurityEvent({
        eventType: 'CREDENTIAL_REVOKE_MISSING',
        correlationId,
        reason: `No credentials to revoke for connection=${connectionId} tenant=${tenantId}`,
      });
      return false;
    }

    // Secure overwrite: replace encrypted fields with zeros before deletion
    const fields: (keyof BrokerCredentials)[] = [
      'apiKey', 'apiSecret', 'passphrase', 'token', 'refreshToken',
    ];
    for (const field of fields) {
      if (record.encryptedFields[field]) {
        record.encryptedFields[field] = '';
      }
    }

    this.store.delete(key);

    logSecurityEvent({
      eventType: 'CREDENTIAL_REVOKED',
      correlationId,
      reason: `Credentials revoked and removed for connection=${connectionId} tenant=${tenantId}`,
    });

    return true;
  }

  /**
   * Check if credentials exist for a connection.
   */
  hasCredentials(connectionId: string, tenantId: string): boolean {
    return this.store.has(this.storeKey(connectionId, tenantId));
  }

  /**
   * Redact all credential fields — safe for API responses and logging.
   *
   * Returns a copy of the credentials object with every field
   * replaced by "***REDACTED***". This ensures credentials are
   * NEVER leaked through API responses or log output.
   */
  redactCredentials(credentials: BrokerCredentials): Record<keyof BrokerCredentials, string> {
    const redacted: Record<keyof BrokerCredentials, string> = {
      apiKey: REDACTED_VALUE,
      apiSecret: REDACTED_VALUE,
      passphrase: REDACTED_VALUE,
      token: REDACTED_VALUE,
      refreshToken: REDACTED_VALUE,
    };

    // Only include fields that were present in the input
    const fields: (keyof BrokerCredentials)[] = [
      'apiKey', 'apiSecret', 'passphrase', 'token', 'refreshToken',
    ];
    for (const field of fields) {
      if (credentials[field] === undefined) {
        delete redacted[field];
      }
    }

    return redacted;
  }

  /**
   * Check if a value is a redacted credential placeholder.
   * Useful for filtering redacted values in downstream processing.
   */
  isCredentialRedacted(value: string | undefined | null): boolean {
    return value === REDACTED_VALUE;
  }

  /**
   * Get the redacted constant value (for external comparison).
   */
  get redactedValue(): string {
    return REDACTED_VALUE;
  }
}

// ── Singleton instance ──

/**
 * Global CredentialVault singleton.
 * In production with multiple processes, this would be backed by
 * a shared encrypted store (e.g., database with encryption at rest).
 * The singleton ensures a single source of truth within a process.
 */
let _instance: CredentialVault | null = null;

export function getCredentialVault(): CredentialVault {
  if (!_instance) {
    _instance = new CredentialVault();
  }
  return _instance;
}

/**
 * Reset the singleton (for testing only).
 */
export function resetCredentialVault(): void {
  _instance = null;
}
