import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateProductionEnvDry } from '@/lib/production-check';

const ORIGINAL_ENV = process.env;

const VALID_PRODUCTION_ENV = {
  DATABASE_URL: 'postgresql://realuser:realpass@realhost:5432/realdb',
  JWT_SECRET: 'j'.repeat(32),
  AUTH_PEPPER: 'p'.repeat(16),
  ENCRYPTION_KEY: 'e'.repeat(32),
  INTERNAL_SERVICE_SECRET: 'i'.repeat(32),
  APP_URL: 'https://fovi.example.org',
  NEXT_PUBLIC_APP_URL: 'https://fovi.example.org',
};

function setProductionEnv(overrides: Record<string, string | undefined> = {}) {
  process.env = {
    ...ORIGINAL_ENV,
    NODE_ENV: 'production',
    ...VALID_PRODUCTION_ENV,
    ...overrides,
  };

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
  }

  delete process.env.PAPER_AUTOMATED_EXECUTION_ENABLED;
}

describe('Phase 3AL critical secret whitespace hardening', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = ORIGINAL_ENV;
  });

  it.each([
    ['JWT_SECRET', ' '.repeat(32)],
    ['AUTH_PEPPER', ' '.repeat(16)],
    ['ENCRYPTION_KEY', ' '.repeat(32)],
  ] as const)('production validation rejects full-length whitespace-only %s', (name, value) => {
    setProductionEnv({ [name]: value });
    const result = validateProductionEnvDry();

    expect(result.fatals.some(fatal => fatal.includes(name) && fatal.includes('whitespace'))).toBe(true);
  });

  it.each([
    ['JWT_SECRET', ` ${'j'.repeat(32)}`],
    ['AUTH_PEPPER', `${'p'.repeat(16)} `],
    ['ENCRYPTION_KEY', ` ${'e'.repeat(32)} `],
  ] as const)('production validation rejects leading/trailing whitespace on %s', (name, value) => {
    setProductionEnv({ [name]: value });
    const result = validateProductionEnvDry();

    expect(result.fatals.some(fatal => fatal.includes(name) && fatal.includes('whitespace'))).toBe(true);
  });

  it('auth runtime rejects a full-length whitespace JWT_SECRET in production', async () => {
    setProductionEnv({ JWT_SECRET: ' '.repeat(32) });

    await expect(import('@/lib/auth')).rejects.toThrow('JWT_SECRET');
  });

  it('auth runtime rejects a whitespace-padded JWT_SECRET in production', async () => {
    setProductionEnv({ JWT_SECRET: ` ${'j'.repeat(32)}` });

    await expect(import('@/lib/auth')).rejects.toThrow('JWT_SECRET');
  });

  it('auth runtime rejects a full-length whitespace AUTH_PEPPER in production', async () => {
    setProductionEnv({ AUTH_PEPPER: ' '.repeat(16) });

    await expect(import('@/lib/auth')).rejects.toThrow('AUTH_PEPPER');
  });

  it('auth runtime rejects a whitespace-padded AUTH_PEPPER in production', async () => {
    setProductionEnv({ AUTH_PEPPER: `${'p'.repeat(16)} ` });

    await expect(import('@/lib/auth')).rejects.toThrow('AUTH_PEPPER');
  });

  it.each([
    ['whitespace-only', ' '.repeat(32)],
    ['leading whitespace', ` ${'e'.repeat(32)}`],
    ['trailing whitespace', `${'e'.repeat(32)} `],
  ] as const)('encryption remains import-safe but refuses %s production keys at crypto use', async (_case, key) => {
    setProductionEnv({ ENCRYPTION_KEY: key });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const encryption = await import('@/lib/encryption');
    expect(typeof encryption.encrypt).toBe('function');
    await expect(encryption.encrypt('must-not-be-encrypted-with-an-invalid-key')).resolves.toBe('');
    expect(errorSpy).toHaveBeenCalled();
  });

  it('accepts unpadded critical secrets that meet the existing minimum lengths', () => {
    setProductionEnv();
    const result = validateProductionEnvDry();

    expect(result.fatals).toHaveLength(0);
  });
});
