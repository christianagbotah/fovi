// ============================================================
// encryption.ts — AES-256-GCM encryption for broker API keys
// ============================================================

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/**
 * Get the encryption key from env, generating a deterministic
 * fallback if ENCRYPTION_KEY is not set (prevents data loss on
 * first deploy, but admin should set ENCRYPTION_KEY in production).
 */
function getKey(): Uint8Array {
  const envKey = process.env.ENCRYPTION_KEY;
  if (envKey && envKey.length >= 32) {
    return new TextEncoder().encode(envKey.slice(0, 32));
  }
  // Deterministic fallback from APP_SECRET or a fixed dev key.
  // NOT secure for production — admin must set ENCRYPTION_KEY.
  const source = process.env.APP_SECRET || 'fovi-dev-encryption-key-32b!';
  // Hash to get exactly 32 bytes
  return crypto.subtle.digestSync('SHA-256', new TextEncoder().encode(source)) as unknown as Uint8Array;
}

/**
 * Encrypt a plaintext string. Returns base64-encoded string:
 *   base64(iv + authTag + ciphertext)
 */
export function encrypt(plaintext: string): string {
  if (!plaintext) return '';
  const key = getKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  // Import key for AES-GCM
  const cryptoKey = crypto.subtle.importKey(
    'raw', key, { name: ALGORITHM }, false, ['encrypt']
  );
  const encoded = new TextEncoder().encode(plaintext);
  const encrypted = crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    cryptoKey,
    encoded
  );
  // encrypted is ArrayBuffer: iv (12) + ciphertext + authTag (16)
  const result = new Uint8Array(iv.length + encrypted.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(encrypted), iv.length);
  return Buffer.from(result).toString('base64');
}

/**
 * Decrypt a base64-encoded encrypted string.
 */
export function decrypt(encryptedBase64: string): string {
  if (!encryptedBase64) return '';
  try {
    const key = getKey();
    const data = Buffer.from(encryptedBase64, 'base64');
    const iv = data.subarray(0, IV_LENGTH);
    const ciphertext = data.subarray(IV_LENGTH);
    const cryptoKey = crypto.subtle.importKey(
      'raw', key, { name: ALGORITHM }, false, ['decrypt']
    );
    const decrypted = crypto.subtle.decrypt(
      { name: ALGORITHM, iv },
      cryptoKey,
      ciphertext
    );
    return new TextDecoder().decode(decrypted);
  } catch (e) {
    console.warn('[encryption] Decrypt failed:', e);
    return ''; // Return empty — caller should handle gracefully
  }
}

/**
 * Check if a value looks like it's already encrypted (base64 with length > 20).
 * Used for migration: detect unencrypted values vs encrypted ones.
 */
export function isEncrypted(value: string): boolean {
  if (!value || value.length < 20) return false;
  try {
    const decoded = Buffer.from(value, 'base64');
    return decoded.length >= IV_LENGTH + AUTH_TAG_LENGTH + 1;
  } catch {
    return false;
  }
}
