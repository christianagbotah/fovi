import { afterEach, describe, expect, it } from 'vitest';
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

function setProductionEnv(overrides: Record<string, string> = {}) {
  process.env = {
    ...ORIGINAL_ENV,
    NODE_ENV: 'production',
    ...VALID_ENV,
    ...overrides,
  };
  delete process.env.PAPER_AUTOMATED_EXECUTION_ENABLED;
}

describe('Phase 3AM critical secret domain separation', () => {
  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  const pairs = [
    ['JWT_SECRET', 'AUTH_PEPPER'],
    ['JWT_SECRET', 'ENCRYPTION_KEY'],
    ['JWT_SECRET', 'INTERNAL_SERVICE_SECRET'],
    ['AUTH_PEPPER', 'ENCRYPTION_KEY'],
    ['AUTH_PEPPER', 'INTERNAL_SERVICE_SECRET'],
    ['ENCRYPTION_KEY', 'INTERNAL_SERVICE_SECRET'],
  ] as const;

  it.each(pairs)('rejects exact secret reuse between %s and %s', (left, right) => {
    const shared = 'shared-independent-secret-material-1234567890';
    setProductionEnv({ [left]: shared, [right]: shared });

    const result = validateProductionEnvDry();
    const matchingFatal = result.fatals.find(
      fatal => fatal.includes(left) && fatal.includes(right) && fatal.includes('different independently generated secrets'),
    );

    expect(matchingFatal).toBeDefined();
    expect(matchingFatal).not.toContain(shared);
  });

  it('accepts independently generated critical secrets', () => {
    setProductionEnv();

    const result = validateProductionEnvDry();
    expect(result.fatals).toHaveLength(0);
  });

  it('reports each reused pair without exposing the shared secret value', () => {
    const shared = 'same-secret-for-all-boundaries-123456789';
    setProductionEnv({
      JWT_SECRET: shared,
      AUTH_PEPPER: shared,
      ENCRYPTION_KEY: shared,
      INTERNAL_SERVICE_SECRET: shared,
    });

    const result = validateProductionEnvDry();
    const separationFatals = result.fatals.filter(fatal => fatal.includes('independently generated secrets'));

    expect(separationFatals).toHaveLength(6);
    expect(separationFatals.every(fatal => !fatal.includes(shared))).toBe(true);
  });
});
