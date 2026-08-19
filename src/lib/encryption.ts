// ============================================================
// encryption.ts — AES-256-GCM encryption for broker API keys
// Supports both sync (Node 22+) and async (Node 18+) crypto APIs
//
// FAIL-CLOSED in production:
//   - ENCRYPTION_KEY must be set and >= 32 characters.
//   - Production never falls back to a repository-known key.
//   - Development/test retains a documented fallback for convenience.
//   - Module throws at load time in production if key is invalid.
// ============================================================

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

// Detect sync API availability at module load
const hasSyncImportKey = typeof (crypto.subtle as any).importKeySync === 'function';
const hasSyncEncrypt = typeof (crypto.subtle as any).encryptSync === 'function';
const hasSyncDecrypt = typeof (crypto.subtle as any).decryptSync === 'function';
const USE_SYNC = hasSyncImportKey && hasSyncEncrypt && hasSyncDecrypt;

if (!USE_SYNC) {
  console.warn('[encryption] Sync crypto API not available — using async fallback. Consider upgrading to Node.js 22+');
}

// -- Production-safe key loading --
// In test/development mode, the module loads with a documented fallback.
// In production, missing or short ENCRYPTION_KEY causes immediate failure —
// no fallback to a repository-known value.

const _ENCRYPTION_KEY_RAW = process.env.ENCRYPTION_KEY;

let _cachedKey: Uint8Array | null = null;

if (process.env.NODE_ENV === 'production') {
  if (!_ENCRYPTION_KEY_RAW || _ENCRYPTION_KEY_RAW.length < 32) {
    const reason = !_ENCRYPTION_KEY_RAW
      ? 'ENCRYPTION_KEY is not set. Generate a random key (>= 32 chars) and set it as an environment variable.'
      : 'ENCRYPTION_KEY is too short (' + _ENCRYPTION_KEY_RAW.length + ' chars). It must be at least 32 characters.';
    throw new Error(reason);
  }
  _cachedKey = new TextEncoder().encode(_ENCRYPTION_KEY_RAW.slice(0, 32));
}

/**
 * Get the encryption key.
 * In production, this always returns the pre-validated key.
 * In development/test, uses a documented development-only fallback.
 */
function getKey(): Uint8Array {
  if (_cachedKey) return _cachedKey;

  // Development/test only: use a documented, repository-known fallback.
  // This must NEVER be reached in production.
  const DEV_FALLBACK = 'fovi-dev-encryption-key-32b!';
  const source = process.env.APP_SECRET || DEV_FALLBACK;
  if (typeof (crypto.subtle as any).digestSync === 'function') {
    _cachedKey = (crypto.subtle as any).digestSync('SHA-256', new TextEncoder().encode(source)) as Uint8Array;
    return _cachedKey;
  }
  // Fallback: simple hash for older Node versions
  const encoder = new TextEncoder();
  const data = encoder.encode(source);
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const chr = data[i];
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  const key = new Uint8Array(32);
  const view = new DataView(key.buffer);
  view.setInt32(0, hash, true);
  view.setInt32(4, hash * 31, true);
  for (let i = 8; i < 32; i++) {
    key[i] = data[i % data.length] ^ (hash & 0xFF);
  }
  _cachedKey = key;
  return _cachedKey;
}

/**
 * Encrypt a plaintext string.
 * Returns base64-encoded string: base64(iv + authTag + ciphertext)
 */
export async function encrypt(plaintext: string): Promise<string> {
  if (!plaintext) return '';
  try {
    const key = getKey();
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const encoded = new TextEncoder().encode(plaintext);

    let encrypted: ArrayBuffer;
    if (USE_SYNC) {
      const cryptoKey = (crypto.subtle as any).importKeySync(
        'raw', key, { name: ALGORITHM }, false, ['encrypt', 'decrypt']
      );
      encrypted = (crypto.subtle as any).encryptSync(
        { name: ALGORITHM, iv },
        cryptoKey,
        encoded
      );
    } else {
      const cryptoKey = await crypto.subtle.importKey(
        'raw', key.buffer as ArrayBuffer, { name: ALGORITHM }, false, ['encrypt', 'decrypt']
      );
      encrypted = await crypto.subtle.encrypt(
        { name: ALGORITHM, iv },
        cryptoKey,
        encoded
      );
    }

    const result = new Uint8Array(iv.length + encrypted.byteLength);
    result.set(iv, 0);
    result.set(new Uint8Array(encrypted), iv.length);
    return Buffer.from(result).toString('base64');
  } catch (e) {
    console.error('[encryption] Encrypt failed:', e);
    return '';
  }
}

/**
 * Decrypt a base64-encoded encrypted string.
 */
export async function decrypt(encryptedBase64: string): Promise<string> {
  if (!encryptedBase64) return '';
  try {
    const key = getKey();
    const data = Buffer.from(encryptedBase64, 'base64');
    const iv = data.subarray(0, IV_LENGTH);
    const ciphertext = data.subarray(IV_LENGTH);

    let decrypted: ArrayBuffer;
    if (USE_SYNC) {
      const cryptoKey = (crypto.subtle as any).importKeySync(
        'raw', key, { name: ALGORITHM }, false, ['encrypt', 'decrypt']
      );
      decrypted = (crypto.subtle as any).decryptSync(
        { name: ALGORITHM, iv },
        cryptoKey,
        ciphertext
      );
    } else {
      const cryptoKey = await crypto.subtle.importKey(
        'raw', key.buffer as ArrayBuffer, { name: ALGORITHM }, false, ['encrypt', 'decrypt']
      );
      decrypted = await crypto.subtle.decrypt(
        { name: ALGORITHM, iv },
        cryptoKey,
        ciphertext
      );
    }

    return new TextDecoder().decode(decrypted);
  } catch (e) {
    console.warn('[encryption] Decrypt failed:', e);
    return '';
  }
}

/**
 * Check if a value looks like it's already encrypted (base64 with length > 20).
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
