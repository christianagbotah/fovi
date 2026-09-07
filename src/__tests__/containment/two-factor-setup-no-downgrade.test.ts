import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../..');
const SETUP = resolve(ROOT, 'src/app/api/auth/two-factor/setup/route.ts');
const VERIFY = resolve(ROOT, 'src/app/api/auth/two-factor/verify/route.ts');

describe('Phase 3AD 2FA setup no-downgrade boundary', () => {
  it('never rewrites an already-enabled 2FA secret during setup', () => {
    const source = readFileSync(SETUP, 'utf8');

    expect(source).toContain('const existingSettings = await tx.userSettings.findUnique({');
    expect(source).toContain('if (existingSettings?.twoFactorEnabled) {');
    expect(source).toContain("return 'already_enabled' as const;");
    expect(source).toContain("2FA is already enabled. Disable it with a valid code before starting a new setup.");
    expect(source).not.toContain('update: { twoFactorSecret: secret, twoFactorEnabled: false }');
  });

  it('claims only a still-disabled settings row with the exact previously observed secret', () => {
    const source = readFileSync(SETUP, 'utf8');

    const transactionIndex = source.indexOf('db!.$transaction(async (tx) => {');
    const updateIndex = source.indexOf('const claimed = await tx.userSettings.updateMany({', transactionIndex);
    const enabledPredicateIndex = source.indexOf('twoFactorEnabled: false,', updateIndex);
    const secretPredicateIndex = source.indexOf('twoFactorSecret: existingSettings.twoFactorSecret,', updateIndex);
    const secretWriteIndex = source.indexOf('data: { twoFactorSecret: secret },', updateIndex);
    const revokeIndex = source.indexOf('await revokeTwoFactorChallengesForUser(tx, user.id);', updateIndex);

    expect(transactionIndex).toBeGreaterThan(-1);
    expect(updateIndex).toBeGreaterThan(transactionIndex);
    expect(enabledPredicateIndex).toBeGreaterThan(updateIndex);
    expect(secretPredicateIndex).toBeGreaterThan(enabledPredicateIndex);
    expect(secretWriteIndex).toBeGreaterThan(secretPredicateIndex);
    expect(revokeIndex).toBeGreaterThan(secretWriteIndex);
    expect(source).toContain('if (claimed.count !== 1) {');
    expect(source).toContain("return 'conflict' as const;");
  });

  it('enables 2FA only if the secret is unchanged from the one whose TOTP was verified', () => {
    const source = readFileSync(VERIFY, 'utf8');

    const verifyIndex = source.indexOf('otplib.verify({ token: code, secret: settings.twoFactorSecret })');
    const transactionIndex = source.indexOf('db!.$transaction(async (tx) => {', verifyIndex);
    const updateIndex = source.indexOf('const claimed = await tx.userSettings.updateMany({', transactionIndex);
    const disabledIndex = source.indexOf('twoFactorEnabled: false,', updateIndex);
    const secretIndex = source.indexOf('twoFactorSecret: settings.twoFactorSecret,', updateIndex);
    const enableIndex = source.indexOf('data: { twoFactorEnabled: true },', updateIndex);
    const revokeIndex = source.indexOf('await revokeTwoFactorChallengesForUser(tx, userId);', updateIndex);

    expect(verifyIndex).toBeGreaterThan(-1);
    expect(transactionIndex).toBeGreaterThan(verifyIndex);
    expect(updateIndex).toBeGreaterThan(transactionIndex);
    expect(disabledIndex).toBeGreaterThan(updateIndex);
    expect(secretIndex).toBeGreaterThan(disabledIndex);
    expect(enableIndex).toBeGreaterThan(secretIndex);
    expect(revokeIndex).toBeGreaterThan(enableIndex);
    expect(source).toContain('if (claimed.count !== 1) {');
    expect(source).toContain('2FA settings changed during verification. Restart setup and try again.');
  });
});
