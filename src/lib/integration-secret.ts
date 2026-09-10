import { decrypt, encrypt } from '@/lib/encryption';

export const INTEGRATION_SECRET_PREFIX_V1 = 'enc:v1:';
export const INTEGRATION_SECRET_ENCRYPTED_PREFIX = 'enc:';
export const INTEGRATION_SECRET_REDACTION = '********';

export type IntegrationSecretPurpose =
  | 'hubtel-sms-client-id'
  | 'hubtel-sms-client-secret'
  | 'hubtel-payment-client-id'
  | 'hubtel-payment-client-secret'
  | 'hubtel-payment-account-number';

const INTEGRATION_SECRET_AAD_PREFIX = 'fovi:integration-secret:v1:';

function integrationSecretAad(purpose: IntegrationSecretPurpose): string {
  return `${INTEGRATION_SECRET_AAD_PREFIX}${purpose}`;
}

export async function sealIntegrationSecret(
  value: string,
  purpose: IntegrationSecretPurpose,
): Promise<string | null> {
  if (!value) return null;

  const ciphertext = await encrypt(value, integrationSecretAad(purpose));
  return ciphertext ? `${INTEGRATION_SECRET_PREFIX_V1}${ciphertext}` : null;
}

export async function openIntegrationSecret(
  storedValue: string,
  purpose: IntegrationSecretPurpose,
): Promise<string | null> {
  if (!storedValue) return null;

  if (storedValue.startsWith(INTEGRATION_SECRET_PREFIX_V1)) {
    const plaintext = await decrypt(
      storedValue.slice(INTEGRATION_SECRET_PREFIX_V1.length),
      integrationSecretAad(purpose),
    );
    return plaintext || null;
  }

  if (storedValue.startsWith(INTEGRATION_SECRET_ENCRYPTED_PREFIX)) {
    return null;
  }

  // Compatibility for pre-3AV plaintext SystemConfig rows. The next admin
  // save re-seals these values through saveHubtel*Config().
  return storedValue;
}
