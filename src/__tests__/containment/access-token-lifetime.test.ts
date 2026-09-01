import { decodeJwt } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = process.env;
const TEST_JWT = 'phase3h-test-jwt-secret-32chars!!';
const TEST_PEPPER = 'phase3h-test-pepper-minimum';

describe('Phase 3H short-lived access tokens', () => {
  let auth: typeof import('@/lib/auth');

  beforeEach(async () => {
    vi.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
      JWT_SECRET: TEST_JWT,
      AUTH_PEPPER: TEST_PEPPER,
    };
    auth = await import('@/lib/auth');
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('pins the access-token TTL to 15 minutes', () => {
    expect(auth.ACCESS_TOKEN_TTL).toBe('15m');
  });

  it('mints access tokens with an exact 15-minute lifetime', async () => {
    const token = await auth.generateAccessToken('phase3h-user', 'phase3h@example.test', 'Phase 3H');
    const payload = decodeJwt(token);

    expect(payload.iat).toBeTypeOf('number');
    expect(payload.exp).toBeTypeOf('number');

    const lifetimeSeconds = (payload.exp as number) - (payload.iat as number);
    expect(lifetimeSeconds).toBe(15 * 60);
    expect(payload.type).toBe('access');
  });
});
