import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../..');
const AUTH = resolve(ROOT, 'src/lib/auth.ts');
const SESSIONS = resolve(ROOT, 'src/lib/auth-sessions.ts');
const SIGNIN = resolve(ROOT, 'src/app/api/auth/signin/route.ts');
const REFRESH = resolve(ROOT, 'src/app/api/auth/refresh/route.ts');
const TWO_FACTOR_AUTH = resolve(ROOT, 'src/app/api/auth/two-factor/authenticate/route.ts');

describe('Phase 3AJ access-token session-family binding', () => {
  it('returns the server-side family id from initial and rotated refresh sessions', () => {
    const source = readFileSync(SESSIONS, 'utf8');

    expect(source).toContain('familyId: string;');
    expect(source).toContain('const familyId = randomUUID();');
    expect(source).toContain('return { refreshToken, familyId, expiresAt, rememberMe };');
    expect(source).toContain('familyId: session.familyId,');
  });

  it('embeds a session-family identifier in production access JWTs', () => {
    const source = readFileSync(AUTH, 'utf8');

    expect(source).toContain('sid?: string;');
    expect(source).toContain('sessionFamilyId?: string,');
    expect(source).toContain('if (sessionFamilyId) payload.sid = sessionFamilyId;');
  });

  it('requires a live unrevoked unexpired session family for bound access tokens', () => {
    const source = readFileSync(AUTH, 'utf8');

    const activeIndex = source.indexOf('async function isAccessSessionActive(payload: AccessTokenPayload)');
    const familyIndex = source.indexOf('familyId: payload.sid,', activeIndex);
    const userIndex = source.indexOf('userId: payload.sub,', familyIndex);
    const revokedIndex = source.indexOf('revokedAt: null,', userIndex);
    const expiryIndex = source.indexOf('expiresAt: { gt: new Date() },', revokedIndex);
    const activeUserIndex = source.indexOf('return session?.user.isActive === true;', expiryIndex);

    expect(activeIndex).toBeGreaterThan(-1);
    expect(familyIndex).toBeGreaterThan(activeIndex);
    expect(userIndex).toBeGreaterThan(familyIndex);
    expect(revokedIndex).toBeGreaterThan(userIndex);
    expect(expiryIndex).toBeGreaterThan(revokedIndex);
    expect(activeUserIndex).toBeGreaterThan(expiryIndex);
  });

  it('fails closed when a production access token has no session family or the session store cannot prove it active', () => {
    const source = readFileSync(AUTH, 'utf8');

    expect(source).toContain("if (process.env.NODE_ENV === 'test') return true;");
    expect(source).toContain("process.env.NODE_ENV !== 'production'");
    expect(source).toContain("process.env.ENABLE_DEMO_AUTH === 'true'");
    expect(source).toContain("payload.sub === 'demo-user'");
    expect(source).toContain('if (!payload.sid) return allowUnboundTestOrDemoAccess(payload);');
    expect(source).toContain("if (!isDbAvailable() || !db || !hasModel('authSession')) return false;");
    expect(source).toContain('if (!(await isAccessSessionActive(verified))) return null;');
  });

  it.each([
    ['password sign-in', SIGNIN, 'session.familyId,'],
    ['refresh rotation', REFRESH, 'rotation.familyId,'],
    ['2FA sign-in', TWO_FACTOR_AUTH, 'session.familyId,'],
  ] as const)('%s binds its minted access token to the live refresh family', (_name, route, familyExpression) => {
    const source = readFileSync(route, 'utf8');
    const tokenIndex = source.indexOf('const token = await generateAccessToken(');
    const familyIndex = source.indexOf(familyExpression, tokenIndex);

    expect(tokenIndex).toBeGreaterThan(-1);
    expect(familyIndex).toBeGreaterThan(tokenIndex);
  });

  it('keeps two-factor challenge JWT verification independent of refresh-session binding', () => {
    const source = readFileSync(AUTH, 'utf8');
    const verifyIndex = source.indexOf('export async function verifyToken(token: string)');
    const accessBranchIndex = source.indexOf("if (verified.type === 'access')", verifyIndex);
    const activeCheckIndex = source.indexOf('isAccessSessionActive(verified)', accessBranchIndex);
    const returnIndex = source.indexOf('return verified;', activeCheckIndex);

    expect(accessBranchIndex).toBeGreaterThan(verifyIndex);
    expect(activeCheckIndex).toBeGreaterThan(accessBranchIndex);
    expect(returnIndex).toBeGreaterThan(activeCheckIndex);
  });
});
