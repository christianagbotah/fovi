import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../..');
const ABUSE = resolve(ROOT, 'src/lib/auth-abuse.ts');
const VERIFY = resolve(ROOT, 'src/app/api/auth/two-factor/verify/route.ts');
const DISABLE = resolve(ROOT, 'src/app/api/auth/two-factor/disable/route.ts');

describe('Phase 3AG persistent 2FA management abuse controls', () => {
  it('can clear account-level TOTP failures inside the factor-state transaction under the same advisory lock', () => {
    const source = readFileSync(ABUSE, 'utf8');

    expect(source).toContain("type AuthAbuseTransactionClient = Pick<Prisma.TransactionClient, 'systemConfig' | '$queryRaw'>;");
    expect(source).toContain('async function clearAbuseFailuresInTransaction(');
    expect(source).toContain('await client.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;');
    expect(source).toContain('await client.systemConfig.deleteMany({ where: { key } });');
    expect(source).toContain('export function clearTwoFactorFailuresInTransaction(');
    expect(source).toContain('return clearAbuseFailuresInTransaction(client, TWO_FACTOR_ABUSE_PREFIX, userId);');
  });

  it.each([
    ['enable', VERIFY],
    ['disable', DISABLE],
  ] as const)('%s checks persistent account cooldown before verifying decrypted TOTP', (_name, route) => {
    const source = readFileSync(route, 'utf8');

    expect(source).toContain('getTwoFactorAbuseStatus');
    expect(source).toContain('recordTwoFactorFailure');
    expect(source).toContain('clearTwoFactorFailuresInTransaction');

    const settingsIndex = source.indexOf('const settings = await safeDbQuery');
    const openIndex = source.indexOf('const openedSecret = await openTwoFactorSecret(settings.twoFactorSecret);', settingsIndex);
    const abuseIndex = source.indexOf('const abuseStatus = await getTwoFactorAbuseStatus(userId);', openIndex);
    const verifyIndex = source.indexOf('otplib.verify({ token: code, secret: openedSecret.secret })', abuseIndex);

    expect(settingsIndex).toBeGreaterThan(-1);
    expect(openIndex).toBeGreaterThan(settingsIndex);
    expect(abuseIndex).toBeGreaterThan(openIndex);
    expect(verifyIndex).toBeGreaterThan(abuseIndex);
  });

  it.each([
    ['enable', VERIFY],
    ['disable', DISABLE],
  ] as const)('%s records invalid TOTP failures against the authenticated user', (_name, route) => {
    const source = readFileSync(route, 'utf8');
    const verifyIndex = source.indexOf('otplib.verify({ token: code, secret: openedSecret.secret })');
    const failureIndex = source.indexOf('const failed = await recordTwoFactorFailure(userId);', verifyIndex);
    const invalidIndex = source.indexOf("{ error: 'Invalid code.' }", failureIndex);

    expect(verifyIndex).toBeGreaterThan(-1);
    expect(failureIndex).toBeGreaterThan(verifyIndex);
    expect(invalidIndex).toBeGreaterThan(failureIndex);
  });

  it.each([
    ['enable', VERIFY],
    ['disable', DISABLE],
  ] as const)('%s clears failures only after its state claim succeeds', (_name, route) => {
    const source = readFileSync(route, 'utf8');
    const claimIndex = source.indexOf('const claimed = await tx.userSettings.updateMany({');
    const claimCheckIndex = source.indexOf('if (claimed.count !== 1) {', claimIndex);
    const clearIndex = source.indexOf('await clearTwoFactorFailuresInTransaction(tx, userId);', claimCheckIndex);
    const sessionRevokeIndex = source.indexOf('await revokeAllAuthSessionsForUser(tx, userId,', clearIndex);
    const challengeRevokeIndex = source.indexOf('await revokeTwoFactorChallengesForUser(tx, userId);', sessionRevokeIndex);

    expect(claimIndex).toBeGreaterThan(-1);
    expect(claimCheckIndex).toBeGreaterThan(claimIndex);
    expect(clearIndex).toBeGreaterThan(claimCheckIndex);
    expect(sessionRevokeIndex).toBeGreaterThan(clearIndex);
    expect(challengeRevokeIndex).toBeGreaterThan(sessionRevokeIndex);
  });

  it.each([
    ['enable', VERIFY, "keyPrefix: '2fa-verify'"],
    ['disable', DISABLE, "keyPrefix: '2fa-disable'"],
  ] as const)('%s retains an independent per-IP limiter alongside persistent cooldown', (_name, route, limiterKey) => {
    const source = readFileSync(route, 'utf8');

    expect(source).toContain(limiterKey);
    expect(source).toContain('const rateResult = limiter(request);');
    expect(source).toContain("status: status.available ? 429 : 503");
  });
});
