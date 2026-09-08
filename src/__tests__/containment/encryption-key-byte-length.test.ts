import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateProductionEnvDry } from '@/lib/production-check';

const ORIGINAL_ENV = process.env;

const VALID_ENV = {
  DATABASE_URL: 'postgresql://realuser:realpass@realhost:5432/realdb',
  JWT_SECRET: 'jwt-'.padEnd(32, 'j'),
  AUTH_PEPPER: 'pepper-'.padEnd(16, 'p'),
  ENCRYPTION_KEY: 'encryption-'.padEnd(32, 'e'),
  INTERNAL_SERVICE_SECRET: 'internal-'.padEnd(32, 'i'),
  APP_URL: 'https://fovi.example.org',
  NEXT_PUBLIC_APP_URL: 'https://fovi.example.org',
};

function setProductionEnv(encryptionKey: string) {
  process.env = {
    ...ORIGINAL_ENV,
    NODE_ENV: 'production',
    ...VALID_ENV,
    ENCRYPTION_KEY: encryptionKey,
  };
  delete process.env.PAPER_AUTOMATED_EXECUTION_ENABLED;
}

describe('Phase 3AN encryption key byte-length validation', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = ORIGINAL_ENV;
  });

  it('startup validation rejects a 32-character key whose effective UTF-8 material exceeds 32 bytes', () => {
    const multibyteKey = 'é'.repeat(32);
    expect(multibyteKey.length).toBe(32);
    expect(new TextEncoder().encode(multibyteKey.slice(0, 32)).byteLength).toBeGreaterThan(32);

    setProductionEnv(multibyteKey);
    const result = validateProductionEnvDry();

    expect(result.fatals.some(fatal => fatal.includes('ENCRYPTION_KEY') && fatal.includes('exactly 32 bytes'))).toBe(true);
    expect(result.fatals.every(fatal => !fatal.includes(multibyteKey))).toBe(true);
  });

  it('runtime remains import-safe but refuses invalid multibyte AES key material when crypto is invoked', async () => {
    const multibyteKey = 'é'.repeat(32);
    setProductionEnv(multibyteKey);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const encryption = await import('@/lib/encryption');
    expect(typeof encryption.encrypt).toBe('function');
    await expect(encryption.encrypt('protected-value')).resolves.toBe('');
    expect(errorSpy).toHaveBeenCalled();
  });

  it('accepts and round-trips a valid ASCII-safe production key', async () => {
    const validKey = 'k'.repeat(32);
    setProductionEnv(validKey);

    const result = validateProductionEnvDry();
    expect(result.fatals).toHaveLength(0);

    const encryption = await import('@/lib/encryption');
    const ciphertext = await encryption.encrypt('protected-value');
    expect(ciphertext).toBeTruthy();
    await expect(encryption.decrypt(ciphertext)).resolves.toBe('protected-value');
  });

  it('keeps compatibility with longer ASCII secrets when their established first 32 characters encode to 32 bytes', async () => {
    const compatibleLongKey = `${'a'.repeat(32)}é-suffix-not-used-by-existing-derivation`;
    setProductionEnv(compatibleLongKey);

    const result = validateProductionEnvDry();
    expect(result.fatals).toHaveLength(0);

    const encryption = await import('@/lib/encryption');
    const ciphertext = await encryption.encrypt('compatibility-check');
    expect(ciphertext).toBeTruthy();
    await expect(encryption.decrypt(ciphertext)).resolves.toBe('compatibility-check');
  });
});
