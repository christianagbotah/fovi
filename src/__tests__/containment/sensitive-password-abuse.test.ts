import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../..');
const ABUSE = resolve(ROOT, 'src/lib/auth-abuse.ts');
const SETUP = resolve(ROOT, 'src/app/api/auth/two-factor/setup/route.ts');
const CHANGE_PASSWORD = resolve(ROOT, 'src/app/api/auth/change-password/route.ts');

describe('Phase 3AI persistent sensitive password abuse controls', () => {
  it('uses a dedicated account-level namespace and transaction-safe clear', () => {
    const source = readFileSync(ABUSE, 'utf8');

    expect(source).toContain("const SENSITIVE_PASSWORD_ABUSE_PREFIX = 'auth-abuse:sensitive-password:';");
    expect(source).toContain('export function getSensitivePasswordAbuseStatus(userId: string)');
    expect(source).toContain('return getAbuseStatus(SENSITIVE_PASSWORD_ABUSE_PREFIX, userId);');
    expect(source).toContain('export function recordSensitivePasswordFailure(userId: string)');
    expect(source).toContain('return recordAbuseFailure(SENSITIVE_PASSWORD_ABUSE_PREFIX, userId);');
    expect(source).toContain('export function clearSensitivePasswordFailuresInTransaction(');
    expect(source).toContain('return clearAbuseFailuresInTransaction(client, SENSITIVE_PASSWORD_ABUSE_PREFIX, userId);');
  });

  it.each([
    ['2FA enrollment', SETUP],
    ['password change', CHANGE_PASSWORD],
  ] as const)('%s checks persistent cooldown before verifying the current password', (_name, route) => {
    const source = readFileSync(route, 'utf8');

    expect(source).toContain('getSensitivePasswordAbuseStatus');
    expect(source).toContain('recordSensitivePasswordFailure');
    expect(source).toContain('clearSensitivePasswordFailuresInTransaction');

    const userIndex = source.indexOf('const user = await safeDbQuery');
    const abuseIndex = source.indexOf('const abuseStatus = await getSensitivePasswordAbuseStatus(userId);', userIndex);
    const passwordIndex = source.indexOf('verifyPassword(currentPassword, user.passwordHash)', abuseIndex);

    expect(userIndex).toBeGreaterThan(-1);
    expect(abuseIndex).toBeGreaterThan(userIndex);
    expect(passwordIndex).toBeGreaterThan(abuseIndex);
  });

  it.each([
    ['2FA enrollment', SETUP, "{ error: 'Current password is incorrect.' }"],
    ['password change', CHANGE_PASSWORD, "{ error: 'Current password is incorrect' }"],
  ] as const)('%s records invalid password failures against the authenticated account', (_name, route, invalidMessage) => {
    const source = readFileSync(route, 'utf8');
    const verifyIndex = source.indexOf('verifyPassword(currentPassword, user.passwordHash)');
    const failureIndex = source.indexOf('const failed = await recordSensitivePasswordFailure(userId);', verifyIndex);
    const invalidIndex = source.indexOf(invalidMessage, failureIndex);

    expect(verifyIndex).toBeGreaterThan(-1);
    expect(failureIndex).toBeGreaterThan(verifyIndex);
    expect(invalidIndex).toBeGreaterThan(failureIndex);
  });

  it('clears 2FA enrollment password failures only after the setup state claim has succeeded', () => {
    const source = readFileSync(SETUP, 'utf8');

    const claimIndex = source.indexOf('const claimed = await tx.userSettings.updateMany({');
    const conflictIndex = source.indexOf('if (claimed.count !== 1) {', claimIndex);
    const createIndex = source.indexOf('await tx.userSettings.create({', conflictIndex);
    const clearIndex = source.indexOf('await clearSensitivePasswordFailuresInTransaction(tx, user.id);', createIndex);
    const challengeIndex = source.indexOf('await revokeTwoFactorChallengesForUser(tx, user.id);', clearIndex);

    expect(claimIndex).toBeGreaterThan(-1);
    expect(conflictIndex).toBeGreaterThan(claimIndex);
    expect(createIndex).toBeGreaterThan(conflictIndex);
    expect(clearIndex).toBeGreaterThan(createIndex);
    expect(challengeIndex).toBeGreaterThan(clearIndex);
  });

  it('clears password-change failures only after the password update succeeds and before session revocation', () => {
    const source = readFileSync(CHANGE_PASSWORD, 'utf8');

    const updateIndex = source.indexOf('await tx.user.update({');
    const clearIndex = source.indexOf('await clearSensitivePasswordFailuresInTransaction(tx, user.id);', updateIndex);
    const sessionIndex = source.indexOf("await revokeAllAuthSessionsForUser(tx, user.id, 'PASSWORD_CHANGED');", clearIndex);
    const challengeIndex = source.indexOf('await revokeTwoFactorChallengesForUser(tx, user.id);', sessionIndex);

    expect(updateIndex).toBeGreaterThan(-1);
    expect(clearIndex).toBeGreaterThan(updateIndex);
    expect(sessionIndex).toBeGreaterThan(clearIndex);
    expect(challengeIndex).toBeGreaterThan(sessionIndex);
  });

  it.each([
    ['2FA enrollment', SETUP, "keyPrefix: '2fa-setup'"],
    ['password change', CHANGE_PASSWORD, "keyPrefix: 'change-pw'"],
  ] as const)('%s retains its independent per-IP limiter and fail-closed persistent response', (_name, route, limiterKey) => {
    const source = readFileSync(route, 'utf8');

    expect(source).toContain(limiterKey);
    expect(source).toContain('const rateResult = limiter(request);');
    expect(source).toContain('status: status.available ? 429 : 503');
    expect(source).toContain("'Authentication service unavailable.'");
    expect(source).toContain("'Retry-After'");
  });
});
