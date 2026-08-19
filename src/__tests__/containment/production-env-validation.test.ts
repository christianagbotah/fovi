// ============================================================
// Containment behavioral tests — production env validation
// Tests that validateProductionEnv blocks on missing/invalid config.
// This is the SINGLE SOURCE OF TRUTH for production env policy.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateProductionEnvDry } from '@/lib/production-check';

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

describe('production env validation — dry run', () => {
  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  // Realistic but non-secret test values that should pass
  const validEnv = {
    DATABASE_URL: 'postgresql://realuser:realpass@realhost:5432/realdb',
    JWT_SECRET: 'a'.repeat(32),
    AUTH_PEPPER: 'b'.repeat(16),
    ENCRYPTION_KEY: 'c'.repeat(32),
    INTERNAL_SERVICE_SECRET: 'd'.repeat(32),
    APP_URL: 'https://fovi.example.org',
    NEXT_PUBLIC_APP_URL: 'https://fovi.example.org',
  };

  // --- Positive test ---

  it('passes with all valid production secrets', () => {
    mockProdEnv(validEnv);
    const result = validateProductionEnvDry();
    expect(result.fatals).toHaveLength(0);
  });

  // --- DATABASE_URL ---

  it('fatals when DATABASE_URL is missing', () => {
    mockProdEnv({ ...validEnv, DATABASE_URL: undefined });
    const result = validateProductionEnvDry();
    expect(result.fatals.some(f => f.includes('DATABASE_URL is not set'))).toBe(true);
  });

  it('fatals when DATABASE_URL is non-PostgreSQL', () => {
    mockProdEnv({ ...validEnv, DATABASE_URL: 'mysql://u:p@h/d' });
    const result = validateProductionEnvDry();
    expect(result.fatals.some(f => f.includes('not a PostgreSQL'))).toBe(true);
  });

  it('fatals when DATABASE_URL is SQLite in production', () => {
    mockProdEnv({ ...validEnv, DATABASE_URL: 'file:./db/dev.db' });
    const result = validateProductionEnvDry();
    expect(result.fatals.some(f => f.includes('not a PostgreSQL'))).toBe(true);
  });

  it('fatals when DATABASE_URL contains template USER/PASSWORD/HOST/DATABASE_NAME', () => {
    mockProdEnv({ ...validEnv, DATABASE_URL: 'postgresql://USER:PASSWORD@HOST:5432/DATABASE_NAME' });
    const result = validateProductionEnvDry();
    expect(result.fatals.some(f => f.includes('DATABASE_URL contains a placeholder'))).toBe(true);
  });

  it('fatals when DATABASE_URL has placeholder username', () => {
    mockProdEnv({ ...validEnv, DATABASE_URL: 'postgresql://USERNAME:somepass@realhost:5432/realdb' });
    const result = validateProductionEnvDry();
    expect(result.fatals.some(f => f.includes('DATABASE_URL contains a placeholder'))).toBe(true);
  });

  it('fatals when DATABASE_URL has placeholder DB_NAME', () => {
    mockProdEnv({ ...validEnv, DATABASE_URL: 'postgresql://realuser:realpass@realhost:5432/DB_NAME' });
    const result = validateProductionEnvDry();
    expect(result.fatals.some(f => f.includes('DATABASE_URL contains a placeholder'))).toBe(true);
  });

  it('fatals when DATABASE_URL starts with change-me prefix', () => {
    mockProdEnv({ ...validEnv, DATABASE_URL: 'change-me-to-postgresql://u:p@h/d' });
    const result = validateProductionEnvDry();
    // This will fail because it doesn't start with postgresql:// (the prefix check comes first)
    expect(result.fatals.length).toBeGreaterThan(0);
  });

  // --- JWT_SECRET ---

  it('fatals when JWT_SECRET is missing', () => {
    mockProdEnv({ ...validEnv, JWT_SECRET: undefined });
    const result = validateProductionEnvDry();
    expect(result.fatals.some(f => f.includes('JWT_SECRET is not set'))).toBe(true);
  });

  it('fatals when JWT_SECRET is too short (<32)', () => {
    mockProdEnv({ ...validEnv, JWT_SECRET: 'short' });
    const result = validateProductionEnvDry();
    expect(result.fatals.some(f => f.includes('JWT_SECRET is too short'))).toBe(true);
  });

  it('fatals when JWT_SECRET is a placeholder', () => {
    mockProdEnv({ ...validEnv, JWT_SECRET: 'change-me-to-a-random-64-char-string' });
    const result = validateProductionEnvDry();
    expect(result.fatals.some(f => f.includes('placeholder'))).toBe(true);
  });

  // --- AUTH_PEPPER ---

  it('fatals when AUTH_PEPPER is missing', () => {
    mockProdEnv({ ...validEnv, AUTH_PEPPER: undefined });
    const result = validateProductionEnvDry();
    expect(result.fatals.some(f => f.includes('AUTH_PEPPER is not set'))).toBe(true);
  });

  it('fatals when AUTH_PEPPER is too short (<16)', () => {
    mockProdEnv({ ...validEnv, AUTH_PEPPER: 'tiny' });
    const result = validateProductionEnvDry();
    expect(result.fatals.some(f => f.includes('AUTH_PEPPER is too short'))).toBe(true);
  });

  // --- ENCRYPTION_KEY ---

  it('fatals when ENCRYPTION_KEY is missing', () => {
    mockProdEnv({ ...validEnv, ENCRYPTION_KEY: undefined });
    const result = validateProductionEnvDry();
    expect(result.fatals.some(f => f.includes('ENCRYPTION_KEY is not set'))).toBe(true);
  });

  it('fatals when ENCRYPTION_KEY is too short (<32)', () => {
    mockProdEnv({ ...validEnv, ENCRYPTION_KEY: 'short' });
    const result = validateProductionEnvDry();
    expect(result.fatals.some(f => f.includes('ENCRYPTION_KEY is too short'))).toBe(true);
  });

  // --- INTERNAL_SERVICE_SECRET ---

  it('fatals when INTERNAL_SERVICE_SECRET is missing', () => {
    mockProdEnv({ ...validEnv, INTERNAL_SERVICE_SECRET: undefined });
    const result = validateProductionEnvDry();
    expect(result.fatals.some(f => f.includes('INTERNAL_SERVICE_SECRET is not set'))).toBe(true);
  });

  it('fatals when INTERNAL_SERVICE_SECRET is too short (<32)', () => {
    mockProdEnv({ ...validEnv, INTERNAL_SERVICE_SECRET: 'short-secret' });
    const result = validateProductionEnvDry();
    expect(result.fatals.some(f => f.includes('INTERNAL_SERVICE_SECRET is too short'))).toBe(true);
  });

  it('fatals when INTERNAL_SERVICE_SECRET is whitespace-only', () => {
    mockProdEnv({ ...validEnv, INTERNAL_SERVICE_SECRET: '   ' });
    const result = validateProductionEnvDry();
    expect(result.fatals.some(f => f.includes('INTERNAL_SERVICE_SECRET'))).toBe(true);
  });

  it('fatals when INTERNAL_SERVICE_SECRET is a placeholder (change-me)', () => {
    mockProdEnv({ ...validEnv, INTERNAL_SERVICE_SECRET: 'change-me-to-a-random-secret-value-here' });
    const result = validateProductionEnvDry();
    expect(result.fatals.some(f => f.includes('placeholder'))).toBe(true);
  });

  it('fatals when INTERNAL_SERVICE_SECRET is a placeholder (example)', () => {
    mockProdEnv({ ...validEnv, INTERNAL_SERVICE_SECRET: 'example-secret-32chars-minimum-xx' });
    const result = validateProductionEnvDry();
    expect(result.fatals.some(f => f.includes('placeholder'))).toBe(true);
  });

  it('fatals when INTERNAL_SERVICE_SECRET is a placeholder (your-)', () => {
    mockProdEnv({ ...validEnv, INTERNAL_SERVICE_SECRET: 'your-secret-here-32chars-minimum-xx' });
    const result = validateProductionEnvDry();
    expect(result.fatals.some(f => f.includes('placeholder'))).toBe(true);
  });

  // --- APP_URL (REQUIRED, HTTPS, no examples) ---

  it('fatals when APP_URL is missing', () => {
    mockProdEnv({ ...validEnv, APP_URL: undefined });
    const result = validateProductionEnvDry();
    expect(result.fatals.some(f => f.includes('APP_URL is not set'))).toBe(true);
  });

  it('fatals when APP_URL is not HTTPS', () => {
    mockProdEnv({ ...validEnv, APP_URL: 'http://fovi.example.org' });
    const result = validateProductionEnvDry();
    expect(result.fatals.some(f => f.includes('APP_URL must be a valid HTTPS'))).toBe(true);
  });

  it('fatals when APP_URL is https://example.com', () => {
    mockProdEnv({ ...validEnv, APP_URL: 'https://example.com' });
    const result = validateProductionEnvDry();
    expect(result.fatals.some(f => f.includes('APP_URL contains a known example'))).toBe(true);
  });

  it('fatals when APP_URL is https://yourdomain.com', () => {
    mockProdEnv({ ...validEnv, APP_URL: 'https://yourdomain.com' });
    const result = validateProductionEnvDry();
    expect(result.fatals.some(f => f.includes('APP_URL contains a known example'))).toBe(true);
  });

  it('fatals when APP_URL is https://localhost', () => {
    mockProdEnv({ ...validEnv, APP_URL: 'https://localhost' });
    const result = validateProductionEnvDry();
    expect(result.fatals.some(f => f.includes('APP_URL contains a known example'))).toBe(true);
  });

  it('fatals when APP_URL is https://127.0.0.1', () => {
    mockProdEnv({ ...validEnv, APP_URL: 'https://127.0.0.1' });
    const result = validateProductionEnvDry();
    expect(result.fatals.some(f => f.includes('APP_URL contains a known example'))).toBe(true);
  });

  // --- NEXT_PUBLIC_APP_URL (REQUIRED, HTTPS, no examples) ---

  it('fatals when NEXT_PUBLIC_APP_URL is missing', () => {
    mockProdEnv({ ...validEnv, NEXT_PUBLIC_APP_URL: undefined });
    const result = validateProductionEnvDry();
    expect(result.fatals.some(f => f.includes('NEXT_PUBLIC_APP_URL is not set'))).toBe(true);
  });

  it('fatals when NEXT_PUBLIC_APP_URL is not HTTPS', () => {
    mockProdEnv({ ...validEnv, NEXT_PUBLIC_APP_URL: 'http://fovi.example.org' });
    const result = validateProductionEnvDry();
    expect(result.fatals.some(f => f.includes('NEXT_PUBLIC_APP_URL must be a valid HTTPS'))).toBe(true);
  });

  it('fatals when NEXT_PUBLIC_APP_URL is https://example.com', () => {
    mockProdEnv({ ...validEnv, NEXT_PUBLIC_APP_URL: 'https://example.com' });
    const result = validateProductionEnvDry();
    expect(result.fatals.some(f => f.includes('NEXT_PUBLIC_APP_URL contains a known example'))).toBe(true);
  });

  it('fatals when NEXT_PUBLIC_APP_URL is https://yourdomain.com', () => {
    mockProdEnv({ ...validEnv, NEXT_PUBLIC_APP_URL: 'https://yourdomain.com' });
    const result = validateProductionEnvDry();
    expect(result.fatals.some(f => f.includes('NEXT_PUBLIC_APP_URL contains a known example'))).toBe(true);
  });

  // --- validateProductionEnv (with process.exit) ---

  describe('validateProductionEnv (exit behavior)', () => {
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

    it('does not throw with all valid production secrets', async () => {
      mockProdEnv(validEnv);
      const { validateProductionEnv } = await import('@/lib/production-check');
      expect(() => validateProductionEnv()).not.toThrow();
    });

    it('exits when DATABASE_URL is missing', async () => {
      mockProdEnv({ ...validEnv, DATABASE_URL: undefined });
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
});
