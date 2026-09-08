import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../..');
const SECRET = resolve(ROOT, 'src/lib/two-factor-secret.ts');
const ENCRYPTION = resolve(ROOT, 'src/lib/encryption.ts');
const SETUP = resolve(ROOT, 'src/app/api/auth/two-factor/setup/route.ts');
const VERIFY = resolve(ROOT, 'src/app/api/auth/two-factor/verify/route.ts');
const DISABLE = resolve(ROOT, 'src/app/api/auth/two-factor/disable/route.ts');
const AUTHENTICATE = resolve(ROOT, 'src/app/api/auth/two-factor/authenticate/route.ts');
const ORIGINAL_ENV = process.env;

describe('Phase 3AO account-bound TOTP secret encryption', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
      APP_SECRET: 'phase-3ao-test-encryption-material',
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = ORIGINAL_ENV;
  });

  it('round-trips a v2 TOTP secret only for the account that sealed it', async () => {
    const { openTwoFactorSecret, sealTwoFactorSecret } = await import('@/lib/two-factor-secret');
    const plaintext = 'JBSWY3DPEHPK3PXP';
    const stored = await sealTwoFactorSecret(plaintext, 'user-a');

    expect(stored).toBeTruthy();
    expect(stored).toMatch(/^enc:v2:/);
    expect(stored).not.toContain(plaintext);

    await expect(openTwoFactorSecret(stored!, 'user-a')).resolves.toEqual({
      secret: plaintext,
      legacyPlaintext: false,
      needsUpgrade: false,
      storageVersion: 'v2',
    });

    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(openTwoFactorSecret(stored!, 'user-b')).resolves.toBeNull();
  });

  it('keeps v1 encrypted records readable but marks them for authenticated rewrap', async () => {
    const encryption = await import('@/lib/encryption');
    const { openTwoFactorSecret } = await import('@/lib/two-factor-secret');
    const plaintext = 'JBSWY3DPEHPK3PXP';
    const ciphertext = await encryption.encrypt(plaintext);

    await expect(openTwoFactorSecret(`enc:v1:${ciphertext}`, 'user-a')).resolves.toEqual({
      secret: plaintext,
      legacyPlaintext: false,
      needsUpgrade: true,
      storageVersion: 'v1',
    });
  });

  it('marks unprefixed pre-3AK values for upgrade and rejects unknown encrypted versions', async () => {
    const { openTwoFactorSecret } = await import('@/lib/two-factor-secret');

    await expect(openTwoFactorSecret('JBSWY3DPEHPK3PXP', 'user-a')).resolves.toEqual({
      secret: 'JBSWY3DPEHPK3PXP',
      legacyPlaintext: true,
      needsUpgrade: true,
      storageVersion: 'legacy',
    });
    await expect(openTwoFactorSecret('enc:v99:not-a-supported-envelope', 'user-a')).resolves.toBeNull();
  });

  it('keeps production import build-safe while crypto use still fails closed without a key', async () => {
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'production',
    };
    delete process.env.ENCRYPTION_KEY;
    vi.resetModules();

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const encryption = await import('@/lib/encryption');

    await expect(encryption.encrypt('protected-at-runtime', 'context')).resolves.toBe('');
    expect(errorSpy).toHaveBeenCalled();
  });

  it('uses AES-GCM additional authenticated data for v2 account binding', () => {
    const secretSource = readFileSync(SECRET, 'utf8');
    const encryptionSource = readFileSync(ENCRYPTION, 'utf8');

    expect(secretSource).toContain("const TWO_FACTOR_SECRET_PREFIX_V1 = 'enc:v1:';");
    expect(secretSource).toContain("const TWO_FACTOR_SECRET_PREFIX_V2 = 'enc:v2:';");
    expect(secretSource).toContain("const TWO_FACTOR_SECRET_AAD_PREFIX = 'fovi:two-factor-secret:v2:user:';");
    expect(secretSource).toContain('encrypt(secret, twoFactorSecretAad(userId))');
    expect(secretSource).toContain('twoFactorSecretAad(userId),');
    expect(secretSource).toContain('if (stored.startsWith(TWO_FACTOR_SECRET_ENCRYPTED_PREFIX))');
    expect(secretSource).not.toContain('isEncrypted(');

    expect(encryptionSource).toContain('additionalAuthenticatedData?: string');
    expect(encryptionSource).toContain('additionalData: new TextEncoder().encode(additionalAuthenticatedData)');
  });

  it('seals a newly generated enrollment secret for the authenticated user before either settings write', () => {
    const source = readFileSync(SETUP, 'utf8');

    const generatedIndex = source.indexOf('const secret = otplib.generateSecret();');
    const sealIndex = source.indexOf('const storedSecret = await sealTwoFactorSecret(secret, user.id);', generatedIndex);
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
    ['enable', VERIFY, 'openTwoFactorSecret(settings.twoFactorSecret, userId)'],
    ['disable', DISABLE, 'openTwoFactorSecret(settings.twoFactorSecret, userId)'],
    ['sign-in', AUTHENTICATE, 'openTwoFactorSecret(user.settings.twoFactorSecret, user.id)'],
  ] as const)('%s binds stored TOTP material to the verified account before calling otplib', (_name, route, openExpression) => {
    const source = readFileSync(route, 'utf8');
    const openIndex = source.indexOf(openExpression);
    const verifyIndex = source.indexOf('otplib.verify({ token: code, secret: openedSecret.secret })', openIndex);

    expect(openIndex).toBeGreaterThan(-1);
    expect(verifyIndex).toBeGreaterThan(openIndex);
  });

  it('upgrades plaintext or v1 enrollment material only after valid TOTP under the original stored-value CAS', () => {
    const source = readFileSync(VERIFY, 'utf8');

    const verifyIndex = source.indexOf('const isValid = otplib.verify({ token: code, secret: openedSecret.secret });');
    const upgradeIndex = source.indexOf('openedSecret.needsUpgrade', verifyIndex);
    const sealIndex = source.indexOf('await sealTwoFactorSecret(openedSecret.secret, userId)', upgradeIndex);
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

  it('rewraps a plaintext or v1 enabled secret after valid TOTP but before consuming the sign-in challenge', () => {
    const source = readFileSync(AUTHENTICATE, 'utf8');

    const verifyIndex = source.indexOf('otplib.verify({ token: code, secret: openedSecret.secret })');
    const upgradeIndex = source.indexOf('if (openedSecret.needsUpgrade) {', verifyIndex);
    const sealIndex = source.indexOf('sealTwoFactorSecret(openedSecret.secret, user.id)', upgradeIndex);
    const updateIndex = source.indexOf('db!.userSettings.updateMany({', sealIndex);
    const exactStoredIndex = source.indexOf('twoFactorSecret: user.settings!.twoFactorSecret,', updateIndex);
    const consumeIndex = source.indexOf('consumeTwoFactorChallenge(challengePayload.jti, user.id)', exactStoredIndex);

    expect(verifyIndex).toBeGreaterThan(-1);
    expect(upgradeIndex).toBeGreaterThan(verifyIndex);
    expect(sealIndex).toBeGreaterThan(upgradeIndex);
    expect(updateIndex).toBeGreaterThan(sealIndex);
    expect(exactStoredIndex).toBeGreaterThan(updateIndex);
    expect(consumeIndex).toBeGreaterThan(exactStoredIndex);
  });

  it.each([SETUP, VERIFY, DISABLE, AUTHENTICATE])('fails closed rather than using an empty protected secret in %s', (route) => {
    const source = readFileSync(route, 'utf8');
    expect(source).toContain('2FA secret protection service unavailable.');
    expect(source).toContain('{ status: 503 }');
  });
});
