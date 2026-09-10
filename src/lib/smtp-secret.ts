import { decrypt, encrypt } from '@/lib/encryption';

export const SMTP_PASSWORD_PREFIX_V1 = 'enc:v1:';
export const SMTP_PASSWORD_ENCRYPTED_PREFIX = 'enc:';
export const SMTP_PASSWORD_REDACTION = '********';
const SMTP_PASSWORD_AAD = 'fovi:smtp-config:password:v1';

/**
 * Encrypt an SMTP password for database storage and bind the ciphertext to
 * the SMTP-password purpose so it cannot be transplanted into another secret
 * domain that shares the same encryption key.
 */
export async function sealSmtpPassword(password: string): Promise<string | null> {
  if (!password) return null;

  const ciphertext = await encrypt(password, SMTP_PASSWORD_AAD);
  return ciphertext ? `${SMTP_PASSWORD_PREFIX_V1}${ciphertext}` : null;
}

/**
 * Open a stored SMTP password.
 *
 * - enc:v1: values require the SMTP-specific authenticated context.
 * - unknown enc:* versions fail closed.
 * - unprefixed values are legacy plaintext and remain readable until the next
 *   admin save, where the route rewraps them as enc:v1:.
 */
export async function openSmtpPassword(storedPassword: string): Promise<string | null> {
  if (!storedPassword) return null;

  if (storedPassword.startsWith(SMTP_PASSWORD_PREFIX_V1)) {
    const plaintext = await decrypt(
      storedPassword.slice(SMTP_PASSWORD_PREFIX_V1.length),
      SMTP_PASSWORD_AAD,
    );
    return plaintext || null;
  }

  if (storedPassword.startsWith(SMTP_PASSWORD_ENCRYPTED_PREFIX)) {
    return null;
  }

  return storedPassword;
}

export function isSealedSmtpPassword(storedPassword: string): boolean {
  return storedPassword.startsWith(SMTP_PASSWORD_PREFIX_V1);
}

export function isUnknownEncryptedSmtpPassword(storedPassword: string): boolean {
  return storedPassword.startsWith(SMTP_PASSWORD_ENCRYPTED_PREFIX)
    && !isSealedSmtpPassword(storedPassword);
}
