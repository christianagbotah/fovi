import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../..');
const SECRET = resolve(ROOT, 'src/lib/two-factor-secret.ts');
const SETUP = resolve(ROOT, 'src/app/api/auth/two-factor/setup/route.ts');
const VERIFY = resolve(ROOT, 'src/app/api/auth/two-factor/verify/route.ts');
const DISABLE = resolve(ROOT, 'src/app/api/auth/two-factor/disable/route.ts');
const AUTHENTICATE = resolve(ROOT, 'src/app/api/auth/two-factor/authenticate/route.ts');
const ORIGINAL_ENV = process.env;

describe('Phase 3AK TOTP secret encryption at rest', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
      APP_SECRET: 'phase-3ak-test-encryption-material',
    };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('round-trips a TOTP secret through a versioned encrypted storage envelope', async () => {
    const { openTwoFactorSecret, sealTwoFactorSecret } = await import('@/lib/two-factor-secret');
    const plaintext = 'JBSWY3DPEHPK3PXP';
    const stored = await sealTwoFactorSecret(plaintext);

    expect(stored).toBeTruthy();
    expect(stored).toMatch(/^enc:v1:/);
    expect(stored).not.toContain(plaintext);

    const opened = await openTwoFactorSecret(stored!);
    expect(opened).toEqual({ secret: plaintext, legacyPlaintext: false });
  });

  it('marks unprefixed pre-3AK values as legacy plaintext instead of guessing from base64 shape', async () => {
    const { openTwoFactorSecret } = await import('@/lib/two-factor-secret');
    await expect(openTwoFactorSecret('JBSWY3DPEHPK3PXP')).resolves.toEqual({
      secret: 'JBSWY3DPEHPK3PXP',
      legacyPlaintext: true,
    });
  });

  it('uses an explicit version prefix and fails closed when encryption or decryption yields no secret', () => {
    const source = readFileSync(SECRET, 'utf8');

    expect(source).toContain("const TWO_FACTOR_SECRET_PREFIX = 'enc:v1:';");
    expect(source).toContain('const ciphertext = await encrypt(secret);');
    expect(source).toContain('if (!ciphertext) return null;');
    expect(source).toContain('const plaintext = await decrypt(stored.slice(TWO_FACTOR_SECRET_PREFIX.length));');
    expect(source).toContain('if (!plaintext) return null;');
    expect(source).not.toContain('isEncrypted(');
  });

  it('encrypts a newly generated enrollment secret before either settings write', () => {
    const source = readFileSync(SETUP, 'utf8');

    const generatedIndex = source.indexOf('const secret = otplib.generateSecret();');
    const sealIndex = source.indexOf('const storedSecret = await sealTwoFactorSecret(secret);', generatedIndex);
    const transactionIndex = source.indexOf('db!.$transaction(async (tx) => {', sealIndex);
    const updateIndex = source.indexOf('data: { twoFactorSecret: storedSecret },', transactionIndex);
    const createIndex = source.indexOf('twoFactorSecret: storedSecret, twoFactorEnabled: false', updateIndex);

    expect(generatedIndex).toBeGreaterThan(-1);
    expect(sealIndex).toBeGreaterThan(generatedIndex);
    expect(transactionIndex).toBeGreaterThan(sealIndex);
    expect(updateIndex).toBeGreaterThan(transactionIndex);
    expect(createIndex).toBeGreaterThan(updateIndex);
    expect(source).not.toContain('data: { twoFactorSecret: secret }');
  });

  it.each([
    ['enable', VERIFY, 'settings.twoFactorSecret'],
    ['disable', DISABLE, 'settings.twoFactorSecret'],
    ['sign-in', AUTHENTICATE, 'user.settings.twoFactorSecret'],
  ] as const)('%s decrypts stored TOTP material before calling otplib', (_name, route, storedExpression) => {
    const source = readFileSync(route, 'utf8');
    const openIndex = source.indexOf(`openTwoFactorSecret(${storedExpression})`);
    const verifyIndex = source.indexOf('otplib.verify({ token: code, secret: openedSecret.secret })', openIndex);

    expect(openIndex).toBeGreaterThan(-1);
    expect(verifyIndex).toBeGreaterThan(openIndex);
  });

  it('upgrades legacy enrollment material only after a valid TOTP and under the original stored-value CAS', () => {
    const source = readFileSync(VERIFY, 'utf8');

    const verifyIndex = source.indexOf('const isValid = otplib.verify({ token: code, secret: openedSecret.secret });');
    const upgradeIndex = source.indexOf('openedSecret.legacyPlaintext', verifyIndex);
    const sealIndex = source.indexOf('await sealTwoFactorSecret(openedSecret.secret)', upgradeIndex);
    const claimIndex = source.indexOf('const claimed = await tx.userSettings.updateMany({', sealIndex);
    const storedCasIndex = source.indexOf('twoFactorSecret: settings.twoFactorSecret,', claimIndex);
    const encryptedWriteIndex = source.indexOf('twoFactorSecret: nextStoredSecret', storedCasIndex);

    expect(verifyIndex).toBeGreaterThan(-1);
    expect(upgradeIndex).toBeGreaterThan(verifyIndex);
    expect(sealIndex).toBeGreaterThan(upgradeIndex);
    expect(claimIndex).toBeGreaterThan(sealIndex);
    expect(storedCasIndex).toBeGreaterThan(claimIndex);
    expect(encryptedWriteIndex).toBeGreaterThan(storedCasIndex);
  });

  it('upgrades a legacy enabled secret after valid TOTP but before consuming the one-time sign-in challenge', () => {
    const source = readFileSync(AUTHENTICATE, 'utf8');

    const verifyIndex = source.indexOf('otplib.verify({ token: code, secret: openedSecret.secret })');
    const legacyIndex = source.indexOf('if (openedSecret.legacyPlaintext) {', verifyIndex);
    const updateIndex = source.indexOf('db!.userSettings.updateMany({', legacyIndex);
    const exactStoredIndex = source.indexOf('twoFactorSecret: user.settings!.twoFactorSecret,', updateIndex);
    const consumeIndex = source.indexOf('consumeTwoFactorChallenge(challengePayload.jti, user.id)', exactStoredIndex);

    expect(verifyIndex).toBeGreaterThan(-1);
    expect(legacyIndex).toBeGreaterThan(verifyIndex);
    expect(updateIndex).toBeGreaterThan(legacyIndex);
    expect(exactStoredIndex).toBeGreaterThan(updateIndex);
    expect(consumeIndex).toBeGreaterThan(exactStoredIndex);
  });

  it.each([SETUP, VERIFY, DISABLE, AUTHENTICATE])('fails closed rather than using an empty protected secret in %s', (route) => {
    const source = readFileSync(route, 'utf8');
    expect(source).toContain('2FA secret protection service unavailable.');
    expect(source).toContain('{ status: 503 }');
  });
});
