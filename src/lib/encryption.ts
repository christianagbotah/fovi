// ============================================================
// encryption.ts — AES-256-GCM encryption for protected secrets
// Supports both sync (Node 22+) and async WebCrypto APIs.
// AES-GCM selects the cipher family; the 32-byte key provides AES-256.
// Optional additional authenticated data (AAD) can bind ciphertext to
// an application context without storing that context in the ciphertext.
//
// FAIL-CLOSED in production:
//   - ENCRYPTION_KEY must be set, unpadded, and >= 32 characters before crypto use.
//   - The existing first-32-character key derivation must encode to exactly 32 bytes.
//   - Production never falls back to a repository-known key.
//   - Development/test retains a documented fallback for convenience.
//   - Validation is deferred until encryption/decryption is invoked so
//     production builds can safely import server route modules without secrets.
// ============================================================

const ALGORITHM = 'AES-GCM';
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

let _cachedKey: Uint8Array | null = null;

/**
 * Get the encryption key.
 * Production validation happens at the point of crypto use rather than module
 * import so build-time route discovery does not require runtime secrets.
 * A missing/short/whitespace-padded/invalid-byte-length production key throws
 * and is converted by encrypt/decrypt into a fail-closed empty result.
 */
function getKey(): Uint8Array {
  if (_cachedKey) return _cachedKey;

  if (process.env.NODE_ENV === 'production') {
    const encryptionKey = process.env.ENCRYPTION_KEY;
    if (!encryptionKey) {
      throw new Error(
        'ENCRYPTION_KEY is not set. Generate a random key (>= 32 chars) and set it as an environment variable.',
      );
    }

    const trimmedKey = encryptionKey.trim();
    if (trimmedKey.length === 0 || trimmedKey !== encryptionKey) {
      throw new Error('ENCRYPTION_KEY must not be whitespace-only or contain leading/trailing whitespace.');
    }
    if (encryptionKey.length < 32) {
      throw new Error(
        'ENCRYPTION_KEY is too short (' + encryptionKey.length + ' chars). It must be at least 32 characters.',
      );
    }

    // Preserve the pre-existing derivation for ciphertext compatibility, but
    // validate the actual bytes WebCrypto will receive. JavaScript string
    // length counts UTF-16 code units, not UTF-8 bytes, so a multibyte value can
    // look like 32 characters while producing an invalid AES key length.
    const keyBytes = new TextEncoder().encode(encryptionKey.slice(0, 32));
    if (keyBytes.byteLength !== 32) {
      throw new Error(
        'ENCRYPTION_KEY effective AES-256 key material must encode to exactly 32 bytes. Use ASCII-safe random secret material.',
      );
    }

    _cachedKey = keyBytes;
    return _cachedKey;
  }

  // Development/test only: use a documented, repository-known fallback.
  // This branch is structurally unreachable in production.
  const DEV_FALLBACK = 'fovi-dev-encryption-key-32b!';
  const source = process.env.APP_SECRET || DEV_FALLBACK;
  if (typeof (crypto.subtle as any).digestSync === 'function') {
    _cachedKey = (crypto.subtle as any).digestSync('SHA-256', new TextEncoder().encode(source)) as Uint8Array;
    return _cachedKey;
  }

  // Fallback: simple hash for older development/test runtimes.
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

function buildAesGcmParams(iv: Uint8Array, additionalAuthenticatedData?: string) {
  if (additionalAuthenticatedData === undefined) {
    return { name: ALGORITHM, iv };
  }

  return {
    name: ALGORITHM,
    iv,
    additionalData: new TextEncoder().encode(additionalAuthenticatedData),
  };
}

/**
 * Encrypt a plaintext string.
 * Returns base64-encoded WebCrypto AES-GCM output prefixed by the 12-byte IV.
 * WebCrypto appends the authentication tag to the ciphertext. When AAD is
 * provided, the same exact context is required for successful decryption.
 */
export async function encrypt(plaintext: string, additionalAuthenticatedData?: string): Promise<string> {
  if (!plaintext) return '';
  try {
    const key = getKey();
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const encoded = new TextEncoder().encode(plaintext);
    const params = buildAesGcmParams(iv, additionalAuthenticatedData);

    let encrypted: ArrayBuffer;
    if (USE_SYNC) {
      const cryptoKey = (crypto.subtle as any).importKeySync(
        'raw', key, { name: ALGORITHM }, false, ['encrypt', 'decrypt']
      );
      encrypted = (crypto.subtle as any).encryptSync(
        params,
        cryptoKey,
        encoded
      );
    } else {
      const cryptoKey = await crypto.subtle.importKey(
        'raw', key.buffer as ArrayBuffer, { name: ALGORITHM }, false, ['encrypt', 'decrypt']
      );
      encrypted = await crypto.subtle.encrypt(
        params,
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
 * Decrypt a base64-encoded encrypted string. If AAD was used during
 * encryption, callers must provide the exact same authenticated context.
 */
export async function decrypt(encryptedBase64: string, additionalAuthenticatedData?: string): Promise<string> {
  if (!encryptedBase64) return '';
  try {
    const key = getKey();
    const data = Buffer.from(encryptedBase64, 'base64');
    const iv = data.subarray(0, IV_LENGTH);
    const ciphertext = data.subarray(IV_LENGTH);
    const params = buildAesGcmParams(iv, additionalAuthenticatedData);

    let decrypted: ArrayBuffer;
    if (USE_SYNC) {
      const cryptoKey = (crypto.subtle as any).importKeySync(
        'raw', key, { name: ALGORITHM }, false, ['encrypt', 'decrypt']
      );
      decrypted = (crypto.subtle as any).decryptSync(
        params,
        cryptoKey,
        ciphertext
      );
    } else {
      const cryptoKey = await crypto.subtle.importKey(
        'raw', key.buffer as ArrayBuffer, { name: ALGORITHM }, false, ['encrypt', 'decrypt']
      );
      decrypted = await crypto.subtle.decrypt(
        params,
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
