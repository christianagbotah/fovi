import { decrypt, encrypt } from '@/lib/encryption';

const TWO_FACTOR_SECRET_PREFIX_V1 = 'enc:v1:';
const TWO_FACTOR_SECRET_PREFIX_V2 = 'enc:v2:';
const TWO_FACTOR_SECRET_ENCRYPTED_PREFIX = 'enc:';
const TWO_FACTOR_SECRET_AAD_PREFIX = 'fovi:two-factor-secret:v2:user:';

export type OpenedTwoFactorSecret = {
  secret: string;
  legacyPlaintext: boolean;
  needsUpgrade: boolean;
  storageVersion: 'legacy' | 'v1' | 'v2';
};

function twoFactorSecretAad(userId: string): string {
  return `${TWO_FACTOR_SECRET_AAD_PREFIX}${userId}`;
}

/**
 * Encrypt a TOTP secret for database storage. v2 binds the AES-GCM
 * authentication tag to both the TOTP purpose and the owning user id, so a
 * valid ciphertext copied to another account fails closed during decryption.
 */
export async function sealTwoFactorSecret(secret: string, userId: string): Promise<string | null> {
  if (!secret || !userId) return null;
  const ciphertext = await encrypt(secret, twoFactorSecretAad(userId));
  if (!ciphertext) return null;
  return `${TWO_FACTOR_SECRET_PREFIX_V2}${ciphertext}`;
}

/**
 * Open a stored TOTP secret for one specific account.
 *
 * - v2 records require account/purpose-bound AAD.
 * - v1 encrypted records remain readable for compatibility and are marked for
 *   rewrap only after a valid TOTP possession proof.
 * - unprefixed pre-3AK values remain a legacy plaintext bridge and are likewise
 *   marked for upgrade only after a valid TOTP.
 * - unknown enc:* versions fail closed rather than being interpreted as
 *   plaintext, preventing version-confusion downgrade behavior.
 */
export async function openTwoFactorSecret(
  stored: string,
  userId: string,
): Promise<OpenedTwoFactorSecret | null> {
  if (!stored || !userId) return null;

  if (stored.startsWith(TWO_FACTOR_SECRET_PREFIX_V2)) {
    const plaintext = await decrypt(
      stored.slice(TWO_FACTOR_SECRET_PREFIX_V2.length),
      twoFactorSecretAad(userId),
    );
    if (!plaintext) return null;
    return {
      secret: plaintext,
      legacyPlaintext: false,
      needsUpgrade: false,
      storageVersion: 'v2',
    };
  }

  if (stored.startsWith(TWO_FACTOR_SECRET_PREFIX_V1)) {
    const plaintext = await decrypt(stored.slice(TWO_FACTOR_SECRET_PREFIX_V1.length));
    if (!plaintext) return null;
    return {
      secret: plaintext,
      legacyPlaintext: false,
      needsUpgrade: true,
      storageVersion: 'v1',
    };
  }

  if (stored.startsWith(TWO_FACTOR_SECRET_ENCRYPTED_PREFIX)) {
    return null;
  }

  return {
    secret: stored,
    legacyPlaintext: true,
    needsUpgrade: true,
    storageVersion: 'legacy',
  };
}

export function isSealedTwoFactorSecret(stored: string): boolean {
  return (
    stored.startsWith(TWO_FACTOR_SECRET_PREFIX_V1) ||
    stored.startsWith(TWO_FACTOR_SECRET_PREFIX_V2)
  );
}
