import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function source(path: string): string {
  return readFileSync(resolve(__dirname, path), 'utf8');
}

const refreshRoute = source('../../../src/app/api/auth/refresh/route.ts');
const logoutRoute = source('../../../src/app/api/auth/logout/route.ts');
const signinRoute = source('../../../src/app/api/auth/signin/route.ts');
const twoFactorRoute = source('../../../src/app/api/auth/two-factor/authenticate/route.ts');
const authSessions = source('../../../src/lib/auth-sessions.ts');
const auth = source('../../../src/lib/auth.ts');
const apiFetch = source('../../../src/lib/api-fetch.ts');
const tradingStore = source('../../../src/lib/store/trading-store.ts');
const proxy = source('../../../src/proxy.ts');
const schema = source('../../../prisma/schema.prisma');
const migration = source(
  '../../../prisma/migrations/20260901112500_revocable_auth_sessions/migration.sql',
);

describe('Phase 3F revocable refresh-session containment', () => {
  it('persists only refresh-token hashes and never restores stateless JWT refresh minting', () => {
    expect(authSessions).toContain("createHash('sha256')");
    expect(authSessions).toContain("randomBytes(48).toString('base64url')");
    expect(authSessions).toContain('tokenHash: hashRefreshToken(refreshToken)');
    expect(schema).toContain('model AuthSession');
    expect(schema).toContain('tokenHash    String   @unique');
    expect(schema).not.toMatch(/\brefreshToken\s+String/);
    expect(migration).toContain('"tokenHash" TEXT NOT NULL');
    expect(migration).not.toContain('"refreshToken"');
    expect(auth).not.toContain('generateRefreshToken');
    expect(auth).not.toContain("type: 'refresh'");
  });

  it('rotates one-time refresh tokens and revokes the family on reuse', () => {
    expect(authSessions).toContain("revokeReason: 'ROTATED'");
    expect(authSessions).toContain("revokeReason: 'REUSE_DETECTED'");
    expect(authSessions).toContain('rotation.count !== 1');
    expect(authSessions).toContain('familyId: session.familyId');
    expect(authSessions).toContain('expiresAt: session.expiresAt');
  });

  it('revalidates account state and absolute session expiry before minting access', () => {
    expect(authSessions).toContain('session.expiresAt.getTime() <= now.getTime()');
    expect(authSessions).toContain('!session.user.isActive');
    expect(refreshRoute).toContain('rotateAuthSession(refreshToken)');
    expect(refreshRoute).toContain('generateAccessToken');
    expect(refreshRoute).not.toContain('verifyToken');
    expect(refreshRoute).not.toContain('generateRefreshToken');
  });

  it('keeps refresh secrets in a hardened HttpOnly cookie boundary', () => {
    expect(authSessions).toContain("REFRESH_COOKIE_NAME = 'fovi_refresh'");
    expect(authSessions).toContain('httpOnly: true');
    expect(authSessions).toContain("sameSite: 'strict'");
    expect(authSessions).toContain("path: '/api/auth'");
    expect(authSessions).toContain("secure: process.env.NODE_ENV === 'production'");
    expect(apiFetch).toContain("fetch('/api/auth/refresh'");
    expect(apiFetch).not.toContain("localStorage.setItem('fovi_refresh'");
    expect(apiFetch).not.toContain("localStorage.getItem('fovi_refresh'");
  });

  it('synchronizes successful access-token rotation across browser auth state', () => {
    expect(apiFetch).toContain('useTradingStore.getState().setAuth(data.user, data.token)');
    expect(apiFetch).toContain(
      'useTradingStore.setState({ authUser: null, authToken: null, isAuthenticated: false })',
    );
  });

  it('creates server-side sessions only after password or password-plus-2FA authentication', () => {
    expect(signinRoute).toContain('createAuthSession(user.id, rememberMe)');
    expect(signinRoute).toContain('setRefreshCookie(response, session)');
    expect(twoFactorRoute).toContain('createAuthSession(user.id, rememberMe)');
    expect(twoFactorRoute).toContain('setRefreshCookie(response, session)');
  });

  it('supports same-origin server-side logout and refresh mutation boundaries', () => {
    expect(refreshRoute).toContain('isSameOriginMutation(request)');
    expect(logoutRoute).toContain('isSameOriginMutation(request)');
    expect(logoutRoute).toContain("revokeAuthSessionFamily(refreshToken, 'LOGOUT')");
    expect(logoutRoute).toContain('clearRefreshCookie(response)');
    expect(proxy).toContain("'/api/auth/logout'");
  });

  it('revokes the server refresh family when the browser signs out', () => {
    const logoutCall = tradingStore.indexOf("fetch('/api/auth/logout'");
    const tokenCleanup = tradingStore.indexOf("localStorage.removeItem('fovi_token')", logoutCall);

    expect(logoutCall).toBeGreaterThan(-1);
    expect(tradingStore).toContain("credentials: 'same-origin'");
    expect(tradingStore).toContain('keepalive: true');
    expect(tokenCleanup).toBeGreaterThan(logoutCall);
  });
});