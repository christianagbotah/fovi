import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ROOT = resolve(__dirname, '../../..');
const AUTH = resolve(ROOT, 'src/lib/auth.ts');
const SESSIONS = resolve(ROOT, 'src/lib/auth-sessions.ts');
const SIGNIN = resolve(ROOT, 'src/app/api/auth/signin/route.ts');
const REFRESH = resolve(ROOT, 'src/app/api/auth/refresh/route.ts');
const TWO_FACTOR = resolve(ROOT, 'src/app/api/auth/two-factor/authenticate/route.ts');

const ORIGINAL_ENV = process.env;
const TEST_JWT = 'phase3ai-test-jwt-secret-32chars!!';
const TEST_PEPPER = 'phase3ai-test-pepper-minimum';

describe('Phase 3AI session-bound access-token revocation', () => {
  it('requires an sid claim and checks it against the live server-side session family', () => {
    const auth = readFileSync(AUTH, 'utf8');

    expect(auth).toContain('sid: string;');
    expect(auth).toContain('sessionFamilyId: string,');
    expect(auth).toContain("throw new Error('ACCESS_SESSION_FAMILY_REQUIRED');");
    expect(auth).toContain('sid: sessionFamilyId,');
    expect(auth).toContain("typeof payload.sid !== 'string'");
    expect(auth).toContain("await import('@/lib/auth-sessions')");
    expect(auth).toContain('isAccessSessionFamilyActive(accessPayload.sub, accessPayload.sid)');
  });

  it('fails session-family liveness closed on revocation, expiry, inactive account, or store failure', () => {
    const sessions = readFileSync(SESSIONS, 'utf8');

    expect(sessions).toContain('export async function isAccessSessionFamilyActive');
    expect(sessions).toContain('userId,');
    expect(sessions).toContain('familyId,');
    expect(sessions).toContain('revokedAt: null');
    expect(sessions).toContain('expiresAt: { gt: new Date() }');
    expect(sessions).toContain('user: { select: { isActive: true } }');
    expect(sessions).toContain('return session?.user.isActive === true;');
    expect(sessions).toContain('return false;');
  });

  it('binds every production access-token issuance path to the session family', () => {
    const signin = readFileSync(SIGNIN, 'utf8');
    const refresh = readFileSync(REFRESH, 'utf8');
    const twoFactor = readFileSync(TWO_FACTOR, 'utf8');
    const sessions = readFileSync(SESSIONS, 'utf8');

    expect(signin).toContain('session.familyId,');
    expect(twoFactor).toContain('session.familyId,');
    expect(refresh).toContain('rotation.familyId,');
    expect(sessions).toContain('return { refreshToken, familyId, expiresAt, rememberMe };');
    expect(sessions).toContain('familyId: session.familyId,');
  });

  it('keeps the sessionless demo exception explicit, opt-in, and impossible in production', () => {
    const auth = readFileSync(AUTH, 'utf8');
    const signin = readFileSync(SIGNIN, 'utf8');

    expect(auth).toContain("export const LOCAL_DEMO_SESSION_FAMILY = 'local-demo-session';");
    expect(auth).toContain("process.env.NODE_ENV !== 'production'");
    expect(auth).toContain("process.env.ENABLE_DEMO_AUTH === 'true'");
    expect(auth).toContain("payload.sub === 'demo-user'");
    expect(auth).toContain("payload.email === 'demo@fovi.ai'");
    expect(signin).toContain('LOCAL_DEMO_SESSION_FAMILY');
  });
});

describe('Phase 3AI fail-closed legacy access tokens', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
      JWT_SECRET: TEST_JWT,
      AUTH_PEPPER: TEST_PEPPER,
    };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('rejects a correctly signed legacy access JWT that has no session-family claim', async () => {
    const token = await new SignJWT({
      sub: 'legacy-user',
      email: 'legacy@example.test',
      type: 'access',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(new TextEncoder().encode(TEST_JWT));

    const auth = await import('@/lib/auth');
    await expect(auth.verifyToken(token)).resolves.toBeNull();
  });

  it('rejects a bound access JWT when the server-side session store cannot confirm liveness', async () => {
    const auth = await import('@/lib/auth');
    const token = await auth.generateAccessToken(
      'session-user',
      'session@example.test',
      'missing-session-family',
      'Session User',
    );

    await expect(auth.verifyToken(token)).resolves.toBeNull();
  });
});
