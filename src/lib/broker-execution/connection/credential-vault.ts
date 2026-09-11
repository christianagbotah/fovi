// ============================================================
// credential-vault.ts — Fail-closed credential encryption for
// broker connections (CORRECTION ROUND, defect 5).
//
// SECURITY CONTRACT:
//   - This module is the CRYPTO LAYER ONLY. Persistence lives in
//     the BrokerConnection encrypted columns via
//     connection-repository.ts. There is NO in-memory credential
//     store and NO in-memory credential truth.
//   - Encryption uses AES-256-GCM via @/lib/encryption with AAD
//     bound to "fovi:broker-credential:{tenantId}:{connectionId}"
//     — ciphertext cannot be transplanted across tenants or
//     connections.
//   - WRITE PATH (encryptCredentialFields): for every non-empty
//     field, encrypt(), verify the ciphertext is non-empty AND
//     structurally valid (round-trip decrypt must reproduce the
//     plaintext). If ANY required encryption fails, the ENTIRE
//     write is aborted — no partial credential sets, no success.
//     The underlying encrypt() returns '' on failure, so an
//     unchecked result would persist "enc:v3:" with an empty
//     payload — that is now impossible.
//   - READ PATH (decryptCredentialFields): every stored non-empty
//     encrypted value must successfully decrypt. If ANY required
//     value fails authentication/decryption, the ENTIRE retrieval
//     fails — a partially populated credential set is NEVER
//     returned as success.
//   - Phase 1 credential intake enforcement
//     (enforcePhase1CredentialIntake) happens at the persistence
//     boundary (connection-repository) BEFORE encryption.
//   - Plaintext secrets are never logged.
//   - Encrypted format: enc:v3:{base64(iv+ciphertext+tag)}
// ============================================================

import { encrypt, decrypt } from '@/lib/encryption';
import { logSecurityEvent } from '@/lib/trading-policy';

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

/** The ordered credential field list (single source of truth). */
export const CREDENTIAL_FIELDS = [
  'apiKey',
  'apiSecret',
  'passphrase',
  'token',
  'refreshToken',
] as const;

export type CredentialField = (typeof CREDENTIAL_FIELDS)[number];

/** Encrypted field map. Absent fields are undefined; stored empty strings are invalid. */
export type EncryptedCredentialFields = Partial<Record<CredentialField, string>>;

// ── Fail-closed error types ──

/**
 * Thrown when a required credential encryption fails or produces
 * an invalid ciphertext. The ENTIRE credential write must abort.
 */
export class CredentialEncryptionFailureError extends Error {
  readonly code = 'CREDENTIAL_ENCRYPTION_FAILED';

  constructor(field: CredentialField, detail: string) {
    super(`Credential encryption failed for field '${field}': ${detail}`);
    this.name = 'CredentialEncryptionFailureError';
  }
}

/**
 * Thrown when a stored encrypted credential fails decryption or
 * authentication. The ENTIRE credential retrieval must fail —
 * partial credential sets are never returned as success.
 */
export class CredentialDecryptionFailureError extends Error {
  readonly code = 'CREDENTIAL_DECRYPTION_FAILED';

  constructor(field: CredentialField, detail: string) {
    super(`Credential decryption failed for field '${field}': ${detail}`);
    this.name = 'CredentialDecryptionFailureError';
  }
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

// ── Fail-closed encrypt ──

/**
 * Encrypt every non-empty credential field with AAD binding, with
 * fail-closed verification:
 *
 *   1. encrypt() the value.
 *   2. Verify the returned ciphertext is NON-EMPTY (the underlying
 *      encrypt() returns '' on failure).
 *   3. Verify structural validity: base64-decodes to at least
 *      IV(12) + AUTH_TAG(16) + 1 ciphertext byte.
 *   4. Verify round-trip: decrypt(ciphertext, aad) === plaintext.
 *
 * If ANY non-empty field fails any check, this throws
 * CredentialEncryptionFailureError — the caller must abort the
 * ENTIRE credential write (no partial persistence, no success).
 *
 * @returns Map of encrypted fields ("enc:v3:{base64}"). Fields that
 *          were absent/empty in the input are absent in the result.
 */
export async function encryptCredentialFields(
  credentials: BrokerCredentials,
  tenantId: string,
  connectionId: string,
): Promise<EncryptedCredentialFields> {
  const aad = buildCredentialAAD(tenantId, connectionId);
  const encrypted: EncryptedCredentialFields = {};

  for (const field of CREDENTIAL_FIELDS) {
    const value = credentials[field];
    if (!value || value.length === 0) continue; // absent field — not an error

    const ciphertext = await encrypt(value, aad);

    // Check 1: non-empty ciphertext (encrypt() returns '' on failure).
    if (!ciphertext || ciphertext.length === 0) {
      logSecurityEvent({
        eventType: 'CREDENTIAL_ENCRYPT_EMPTY_RESULT',
        reason: `encrypt() returned an empty result for field '${field}' (connection=${connectionId})`,
      });
      throw new CredentialEncryptionFailureError(field, 'encrypt() returned an empty result');
    }

    // Check 2: structural validity — base64 payload must decode to
    // at least IV (12 bytes) + auth tag (16 bytes) + 1 ciphertext byte.
    const payload = Buffer.from(ciphertext, 'base64');
    if (payload.length < 12 + 16 + 1 || Buffer.compare(Buffer.from(ciphertext, 'base64'), payload) !== 0) {
      logSecurityEvent({
        eventType: 'CREDENTIAL_ENCRYPT_INVALID_STRUCTURE',
        reason: `encrypt() returned a structurally invalid ciphertext for field '${field}' (connection=${connectionId})`,
      });
      throw new CredentialEncryptionFailureError(field, 'ciphertext is structurally invalid');
    }

    // Check 3: round-trip verification — the ciphertext must decrypt
    // back to the exact plaintext under the same AAD.
    const roundTrip = await decrypt(ciphertext, aad);
    if (roundTrip !== value) {
      logSecurityEvent({
        eventType: 'CREDENTIAL_ENCRYPT_ROUNDTRIP_FAILED',
        reason: `Round-trip verification failed for field '${field}' (connection=${connectionId})`,
      });
      throw new CredentialEncryptionFailureError(field, 'round-trip verification failed');
    }

    encrypted[field] = addPrefix(ciphertext);
  }

  return encrypted;
}

// ── Fail-closed decrypt ──

/**
 * Decrypt stored encrypted credential fields with fail-closed
 * whole-retrieval semantics:
 *
 *   For every stored non-empty value:
 *     - it must be in the v3 AAD-bound format;
 *     - it must decrypt to a NON-EMPTY plaintext (decrypt() returns
 *       '' on authentication/decryption failure).
 *
 * If ANY stored non-empty value fails, this throws
 * CredentialDecryptionFailureError — the caller must fail the
 * ENTIRE retrieval. A partially populated credential set is never
 * returned as success.
 *
 * @param stored Map of stored values (from BrokerConnection
 *        encrypted* columns). Empty-string entries mean "no value
 *        stored" and are skipped.
 */
export async function decryptCredentialFields(
  stored: Partial<Record<CredentialField, string | null | undefined>>,
  tenantId: string,
  connectionId: string,
): Promise<BrokerCredentials> {
  const aad = buildCredentialAAD(tenantId, connectionId);
  const credentials: BrokerCredentials = {};

  for (const field of CREDENTIAL_FIELDS) {
    const storedValue = stored[field];
    if (!storedValue || storedValue.length === 0) continue; // nothing stored — not an error

    if (!isEncryptedV3(storedValue)) {
      logSecurityEvent({
        eventType: 'CREDENTIAL_DECRYPT_INVALID_FORMAT',
        reason: `Stored value for field '${field}' is not in the v3 AAD-bound format (connection=${connectionId})`,
      });
      throw new CredentialDecryptionFailureError(field, 'stored value is not in enc:v3 format');
    }

    const rawBase64 = stripPrefix(storedValue);
    if (rawBase64.length === 0) {
      logSecurityEvent({
        eventType: 'CREDENTIAL_DECRYPT_EMPTY_PAYLOAD',
        reason: `Stored value for field '${field}' has an empty encrypted payload (connection=${connectionId})`,
      });
      throw new CredentialDecryptionFailureError(field, 'empty encrypted payload');
    }

    const plaintext = await decrypt(rawBase64, aad);
    if (!plaintext || plaintext.length === 0) {
      // decrypt() returns '' on ANY failure: wrong key, tampered tag,
      // wrong AAD (cross-tenant transplant attempt), corruption.
      logSecurityEvent({
        eventType: 'CREDENTIAL_DECRYPT_AUTH_FAILED',
        reason: `Decryption/authentication failed for field '${field}' (connection=${connectionId})`,
      });
      throw new CredentialDecryptionFailureError(
        field,
        'decryption or authentication failed (wrong key, tampered ciphertext, or AAD mismatch)',
      );
    }

    credentials[field] = plaintext;
  }

  return credentials;
}

// ── Redaction utilities (unchanged contract) ──

/** The redacted placeholder value. */
export const REDACTED = REDACTED_VALUE;

/**
 * Redact all credential fields — safe for API responses and logging.
 *
 * Returns a copy of the credentials object with every field
 * replaced by "***REDACTED***". This ensures credentials are
 * NEVER leaked through API responses or log output.
 */
export function redactCredentials(
  credentials: BrokerCredentials,
): Partial<Record<CredentialField, string>> {
  const redacted: Partial<Record<CredentialField, string>> = {};
  for (const field of CREDENTIAL_FIELDS) {
    if (credentials[field] !== undefined) {
      redacted[field] = REDACTED_VALUE;
    }
  }
  return redacted;
}

/**
 * Check if a value is a redacted credential placeholder.
 * Useful for filtering redacted values in downstream processing.
 */
export function isCredentialRedacted(value: string | undefined | null): boolean {
  return value === REDACTED_VALUE;
}
