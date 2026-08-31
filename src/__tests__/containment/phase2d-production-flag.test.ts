import { afterEach, describe, expect, it } from 'vitest';
import { validateProductionEnvDry } from '@/lib/production-check';

const ORIGINAL_ENV = process.env;

function validProductionEnv(): NodeJS.ProcessEnv {
  return {
    ...ORIGINAL_ENV,
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://realuser:realpass@realhost:5432/realdb',
    JWT_SECRET: 'a'.repeat(32),
    AUTH_PEPPER: 'b'.repeat(16),
    ENCRYPTION_KEY: 'c'.repeat(32),
    INTERNAL_SERVICE_SECRET: 'd'.repeat(32),
    APP_URL: 'https://fovi.example.org',
    NEXT_PUBLIC_APP_URL: 'https://fovi.example.org',
    PAPER_AUTOMATED_EXECUTION_ENABLED: 'false',
  };
}

describe('Phase 2D production paper-execution containment', () => {
  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('allows the production environment only when paper execution stays disabled', () => {
    process.env = validProductionEnv();
    const result = validateProductionEnvDry();
    expect(result.fatals).toHaveLength(0);
  });

  it.each(['true', '1', 'yes', ' TRUE '])(
    'fatals when PAPER_AUTOMATED_EXECUTION_ENABLED=%s',
    (value) => {
      process.env = {
        ...validProductionEnv(),
        PAPER_AUTOMATED_EXECUTION_ENABLED: value,
      };
      const result = validateProductionEnvDry();
      expect(result.fatals.some(f => f.includes('PAPER_AUTOMATED_EXECUTION_ENABLED must remain false'))).toBe(true);
    },
  );
});
