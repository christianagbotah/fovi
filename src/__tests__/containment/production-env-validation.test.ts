// ============================================================
// Containment behavioral tests — production env validation (Req 4)
// Tests that validateProductionEnv blocks on missing/invalid config.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ORIGINAL_ENV = process.env;

function mockProdEnv(overrides: Record<string, string | undefined> = {}) {
  process.env = {
    ...ORIGINAL_ENV,
    NODE_ENV: 'production',
    ...overrides,
  };
  // Delete keys explicitly set to undefined in overrides
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
  }
}

describe('production env validation', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
      throw new Error(`process.exit(${code})`);
    });
  });

  afterEach(() => {
    exitSpy.mockRestore();
    process.env = ORIGINAL_ENV;
  });

  const validEnv = {
    DATABASE_URL: 'postgresql://user:pass@host:5432/db',
    JWT_SECRET: 'a'.repeat(32),
    AUTH_PEPPER: 'b'.repeat(16),
    ENCRYPTION_KEY: 'c'.repeat(32),
    INTERNAL_SERVICE_SECRET: 'd'.repeat(32),
    APP_URL: 'https://example.com',
    NEXT_PUBLIC_APP_URL: 'https://example.com',
  };

  it('does not exit with all valid production secrets', async () => {
    mockProdEnv(validEnv);
    const { validateProductionEnv } = await import('@/lib/production-check');
    expect(() => validateProductionEnv()).not.toThrow();
  });

  it('exits when DATABASE_URL is missing', async () => {
    mockProdEnv({ ...validEnv, DATABASE_URL: undefined });
    const { validateProductionEnv } = await import('@/lib/production-check');
    expect(() => validateProductionEnv()).toThrow('Production configuration fatal');
  });

  it('exits when DATABASE_URL is SQLite in production', async () => {
    mockProdEnv({ ...validEnv, DATABASE_URL: 'file:./db/dev.db' });
    const { validateProductionEnv } = await import('@/lib/production-check');
    expect(() => validateProductionEnv()).toThrow('Production configuration fatal');
  });

  it('exits when JWT_SECRET is missing', async () => {
    mockProdEnv({ ...validEnv, JWT_SECRET: undefined });
    const { validateProductionEnv } = await import('@/lib/production-check');
    expect(() => validateProductionEnv()).toThrow('Production configuration fatal');
  });

  it('exits when JWT_SECRET is too short (<32)', async () => {
    mockProdEnv({ ...validEnv, JWT_SECRET: 'short' });
    const { validateProductionEnv } = await import('@/lib/production-check');
    expect(() => validateProductionEnv()).toThrow('Production configuration fatal');
  });

  it('exits when AUTH_PEPPER is missing', async () => {
    mockProdEnv({ ...validEnv, AUTH_PEPPER: undefined });
    const { validateProductionEnv } = await import('@/lib/production-check');
    expect(() => validateProductionEnv()).toThrow('Production configuration fatal');
  });

  it('exits when AUTH_PEPPER is too short (<16)', async () => {
    mockProdEnv({ ...validEnv, AUTH_PEPPER: 'tiny' });
    const { validateProductionEnv } = await import('@/lib/production-check');
    expect(() => validateProductionEnv()).toThrow('Production configuration fatal');
  });

  it('exits when ENCRYPTION_KEY is missing', async () => {
    mockProdEnv({ ...validEnv, ENCRYPTION_KEY: undefined });
    const { validateProductionEnv } = await import('@/lib/production-check');
    expect(() => validateProductionEnv()).toThrow('Production configuration fatal');
  });

  it('exits when ENCRYPTION_KEY is too short (<32)', async () => {
    mockProdEnv({ ...validEnv, ENCRYPTION_KEY: 'short' });
    const { validateProductionEnv } = await import('@/lib/production-check');
    expect(() => validateProductionEnv()).toThrow('Production configuration fatal');
  });

  it('exits when INTERNAL_SERVICE_SECRET is missing', async () => {
    mockProdEnv({ ...validEnv, INTERNAL_SERVICE_SECRET: undefined });
    const { validateProductionEnv } = await import('@/lib/production-check');
    expect(() => validateProductionEnv()).toThrow('Production configuration fatal');
  });

  it('exits when APP_URL is not HTTPS', async () => {
    mockProdEnv({ ...validEnv, APP_URL: 'http://example.com' });
    const { validateProductionEnv } = await import('@/lib/production-check');
    expect(() => validateProductionEnv()).toThrow('Production configuration fatal');
  });

  it('exits when NEXT_PUBLIC_APP_URL is not HTTPS', async () => {
    mockProdEnv({ ...validEnv, NEXT_PUBLIC_APP_URL: 'http://example.com' });
    const { validateProductionEnv } = await import('@/lib/production-check');
    expect(() => validateProductionEnv()).toThrow('Production configuration fatal');
  });

  it('rejects placeholder DATABASE_URL values', async () => {
    mockProdEnv({ ...validEnv, DATABASE_URL: 'change-me-to-postgresql' });
    const { validateProductionEnv } = await import('@/lib/production-check');
    expect(() => validateProductionEnv()).toThrow('Production configuration fatal');
  });

  it('rejects placeholder JWT_SECRET values', async () => {
    mockProdEnv({ ...validEnv, JWT_SECRET: 'change-me-to-a-random-64-char-string' });
    const { validateProductionEnv } = await import('@/lib/production-check');
    expect(() => validateProductionEnv()).toThrow('Production configuration fatal');
  });

  it('does not exit in non-production environment', async () => {
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'development',
    };
    const { validateProductionEnv } = await import('@/lib/production-check');
    expect(() => validateProductionEnv()).not.toThrow();
  });
});
