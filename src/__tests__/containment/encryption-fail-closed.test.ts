// ============================================================
// Containment behavioral tests — encryption fail-closed (Req 5)
// Tests that production never uses a repository-known fallback key.
// Production modules may be imported during `next build`; key validation
// therefore happens when encryption/decryption is actually invoked.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ORIGINAL_ENV = process.env;

describe('encryption fail-closed in production', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = ORIGINAL_ENV;
  });

  async function expectEncryptionUnavailable(encryptionKey?: string) {
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'production',
    };

    if (encryptionKey === undefined) {
      delete process.env.ENCRYPTION_KEY;
    } else {
      process.env.ENCRYPTION_KEY = encryptionKey;
    }

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const enc = await import('@/lib/encryption');

    expect(typeof enc.encrypt).toBe('function');
    await expect(enc.encrypt('must-not-use-a-fallback')).resolves.toBe('');
    expect(errorSpy).toHaveBeenCalled();
  }

  it('imports safely but refuses encryption when ENCRYPTION_KEY is absent in production', async () => {
    await expectEncryptionUnavailable();
  });

  it('imports safely but refuses encryption when ENCRYPTION_KEY is too short in production', async () => {
    await expectEncryptionUnavailable('short');
  });

  it('does NOT fail to import in test mode when ENCRYPTION_KEY is absent', async () => {
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
    };
    delete process.env.ENCRYPTION_KEY;
    const enc = await import('@/lib/encryption');
    expect(typeof enc.encrypt).toBe('function');
    expect(typeof enc.decrypt).toBe('function');
  });

  it('encrypts and decrypts with a valid ENCRYPTION_KEY in production', async () => {
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'production',
      ENCRYPTION_KEY: 'a'.repeat(32),
    };
    const enc = await import('@/lib/encryption');
    const ciphertext = await enc.encrypt('protected-value');

    expect(ciphertext).toBeTruthy();
    expect(ciphertext).not.toContain('protected-value');
    await expect(enc.decrypt(ciphertext)).resolves.toBe('protected-value');
  });

  it('adversarial: production with exactly 31 chars refuses encryption', async () => {
    await expectEncryptionUnavailable('a'.repeat(31));
  });

  it('adversarial: production with empty ENCRYPTION_KEY refuses encryption', async () => {
    await expectEncryptionUnavailable('');
  });

  it('adversarial: production with whitespace-only ENCRYPTION_KEY refuses encryption', async () => {
    await expectEncryptionUnavailable('   ');
  });
});
