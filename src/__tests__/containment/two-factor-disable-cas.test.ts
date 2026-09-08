import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../..');
const DISABLE = resolve(ROOT, 'src/app/api/auth/two-factor/disable/route.ts');

describe('Phase 3AF 2FA disable compare-and-swap boundary', () => {
  it('verifies the current TOTP before attempting the disable claim', () => {
    const source = readFileSync(DISABLE, 'utf8');

    const verifyIndex = source.indexOf('otplib.verify({ token: code, secret: settings.twoFactorSecret })');
    const transactionIndex = source.indexOf('db!.$transaction(async (tx) => {', verifyIndex);
    const claimIndex = source.indexOf('const claimed = await tx.userSettings.updateMany({', transactionIndex);

    expect(verifyIndex).toBeGreaterThan(-1);
    expect(transactionIndex).toBeGreaterThan(verifyIndex);
    expect(claimIndex).toBeGreaterThan(transactionIndex);
  });

  it('claims only the exact still-enabled secret that was verified', () => {
    const source = readFileSync(DISABLE, 'utf8');
    const claimIndex = source.indexOf('const claimed = await tx.userSettings.updateMany({');
    const enabledIndex = source.indexOf('twoFactorEnabled: true,', claimIndex);
    const secretIndex = source.indexOf('twoFactorSecret: settings.twoFactorSecret,', claimIndex);
    const disableIndex = source.indexOf('data: { twoFactorEnabled: false, twoFactorSecret: null },', claimIndex);
    const countIndex = source.indexOf('if (claimed.count !== 1) {', disableIndex);
    const sessionRevokeIndex = source.indexOf(
      "await revokeAllAuthSessionsForUser(tx, userId, 'TWO_FACTOR_DISABLED');",
      countIndex,
    );
    const challengeRevokeIndex = source.indexOf(
      'await revokeTwoFactorChallengesForUser(tx, userId);',
      sessionRevokeIndex,
    );

    expect(claimIndex).toBeGreaterThan(-1);
    expect(enabledIndex).toBeGreaterThan(claimIndex);
    expect(secretIndex).toBeGreaterThan(enabledIndex);
    expect(disableIndex).toBeGreaterThan(secretIndex);
    expect(countIndex).toBeGreaterThan(disableIndex);
    expect(sessionRevokeIndex).toBeGreaterThan(countIndex);
    expect(challengeRevokeIndex).toBeGreaterThan(sessionRevokeIndex);
    expect(source).not.toContain('await tx.userSettings.update({');
  });

  it('distinguishes storage failure from a stale disable conflict', () => {
    const source = readFileSync(DISABLE, 'utf8');

    const unavailableIndex = source.indexOf('if (disabled === undefined) {');
    const conflictIndex = source.indexOf('if (!disabled) {', unavailableIndex);
    const conflictMessageIndex = source.indexOf(
      '2FA settings changed during disable. Refresh your security settings and try again.',
      conflictIndex,
    );

    expect(unavailableIndex).toBeGreaterThan(-1);
    expect(conflictIndex).toBeGreaterThan(unavailableIndex);
    expect(conflictMessageIndex).toBeGreaterThan(conflictIndex);
    expect(source).toContain('{ status: 409 }');
  });
});
