import { decrypt, encrypt } from '@/lib/encryption';

const TWO_FACTOR_SECRET_PREFIX = 'enc:v1:';

export type OpenedTwoFactorSecret = {
  secret: string;
  legacyPlaintext: boolean;
};

/**
 * Encrypt a TOTP secret for database storage. The explicit version prefix
 * avoids heuristic ciphertext detection and gives us a future key/format
 * migration boundary.
 */
export async function sealTwoFactorSecret(secret: string): Promise<string | null> {
  if (!secret) return null;
  const ciphertext = await encrypt(secret);
  if (!ciphertext) return null;
  return `${TWO_FACTOR_SECRET_PREFIX}${ciphertext}`;
}

/**
 * Open a stored TOTP secret. Unprefixed values are legacy plaintext records
 * from releases before Phase 3AK and may be upgraded only after a valid TOTP.
 */
export async function openTwoFactorSecret(stored: string): Promise<OpenedTwoFactorSecret | null> {
  if (!stored) return null;

  if (!stored.startsWith(TWO_FACTOR_SECRET_PREFIX)) {
    return { secret: stored, legacyPlaintext: true };
  }

  const plaintext = await decrypt(stored.slice(TWO_FACTOR_SECRET_PREFIX.length));
  if (!plaintext) return null;
  return { secret: plaintext, legacyPlaintext: false };
}

export function isSealedTwoFactorSecret(stored: string): boolean {
  return stored.startsWith(TWO_FACTOR_SECRET_PREFIX);
}
