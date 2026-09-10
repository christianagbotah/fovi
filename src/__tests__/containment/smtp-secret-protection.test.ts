import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  openSmtpPassword,
  sealSmtpPassword,
  SMTP_PASSWORD_PREFIX_V1,
  SMTP_PASSWORD_REDACTION,
} from '@/lib/smtp-secret';

const ROOT = process.cwd();
const SMTP_ROUTE = join(ROOT, 'src/app/api/admin/config/smtp/route.ts');
const EMAIL = join(ROOT, 'src/lib/email.ts');
const SMTP_SECRET = join(ROOT, 'src/lib/smtp-secret.ts');
const APP = join(ROOT, 'src/app/page.tsx');

describe('Phase 3AU SMTP secret-at-rest protection', () => {
  it('round-trips a versioned SMTP password bound to the SMTP purpose', async () => {
    const plaintext = 'smtp-test-password-123!';
    const stored = await sealSmtpPassword(plaintext);

    expect(stored).toBeTruthy();
    expect(stored).toMatch(new RegExp(`^${SMTP_PASSWORD_PREFIX_V1}`));
    expect(stored).not.toContain(plaintext);
    await expect(openSmtpPassword(stored!)).resolves.toBe(plaintext);
  });

  it('keeps legacy plaintext readable and rejects unknown encrypted versions', async () => {
    await expect(openSmtpPassword('legacy-smtp-password')).resolves.toBe('legacy-smtp-password');
    await expect(openSmtpPassword('enc:v99:opaque')).resolves.toBeNull();
  });

  it('binds ciphertext to an SMTP-specific authenticated context', () => {
    const source = readFileSync(SMTP_SECRET, 'utf8');

    expect(source).toContain("const SMTP_PASSWORD_AAD = 'fovi:smtp-config:password:v1';");
    expect(source).toContain('encrypt(password, SMTP_PASSWORD_AAD)');
    expect(source).toContain('SMTP_PASSWORD_PREFIX_V1');
    expect(source).toContain('decrypt(');
    expect(source).toContain('SMTP_PASSWORD_AAD,');
    expect(source).toContain('storedPassword.startsWith(SMTP_PASSWORD_ENCRYPTED_PREFIX)');
  });

  it('decrypts protected database storage before constructing the SMTP runtime config', () => {
    const source = readFileSync(EMAIL, 'utf8');
    const parseIndex = source.indexOf('const parsed = JSON.parse(row.config) as SmtpConfig;');
    const openIndex = source.indexOf('const password = await openSmtpPassword(parsed.password);');
    const cacheIndex = source.indexOf("setCache('smtp', runtimeConfig);");

    expect(parseIndex).toBeGreaterThanOrEqual(0);
    expect(openIndex).toBeGreaterThan(parseIndex);
    expect(cacheIndex).toBeGreaterThan(openIndex);
    expect(source).toContain('password,');
    expect(source).toContain("return null;");
  });

  it('never returns SMTP password fragments from the admin GET endpoint', () => {
    const source = readFileSync(SMTP_ROUTE, 'utf8');

    expect(SMTP_PASSWORD_REDACTION).toBe('********');
    expect(source).toContain('password: storedPassword ? SMTP_PASSWORD_REDACTION :');
    expect(source).toContain('config,');
    expect(source).not.toContain('val.slice(0, n)');
  });

  it('preserves or upgrades the existing secret when the UI posts the redaction sentinel', () => {
    const source = readFileSync(SMTP_ROUTE, 'utf8');
    const sentinelIndex = source.indexOf('if (parsed.data.password === SMTP_PASSWORD_REDACTION)');
    const existingReadIndex = source.indexOf("db!.systemConfig.findUnique({ where: { key: 'smtp' } })", sentinelIndex);
    const sealedIndex = source.indexOf('isSealedSmtpPassword(existingPassword)', sentinelIndex);
    const legacyRewrapIndex = source.indexOf('sealSmtpPassword(existingPassword)', sentinelIndex);
    const upsertIndex = source.indexOf('await db.systemConfig.upsert({');

    expect(sentinelIndex).toBeGreaterThanOrEqual(0);
    expect(existingReadIndex).toBeGreaterThan(sentinelIndex);
    expect(sealedIndex).toBeGreaterThan(existingReadIndex);
    expect(legacyRewrapIndex).toBeGreaterThan(sealedIndex);
    expect(upsertIndex).toBeGreaterThan(legacyRewrapIndex);
  });

  it('encrypts a newly entered SMTP password before database persistence', () => {
    const source = readFileSync(SMTP_ROUTE, 'utf8');
    const newSecretIndex = source.indexOf('storedPassword = await sealSmtpPassword(parsed.data.password);');
    const storedConfigIndex = source.indexOf('const storedConfig = {');
    const upsertIndex = source.indexOf('await db.systemConfig.upsert({');

    expect(newSecretIndex).toBeGreaterThanOrEqual(0);
    expect(storedConfigIndex).toBeGreaterThan(newSecretIndex);
    expect(upsertIndex).toBeGreaterThan(storedConfigIndex);
    expect(source).toContain('password: storedPassword,');
    expect(source).not.toContain('config: JSON.stringify(parsed.data)');
  });

  it('aligns the API response and port parser with the existing admin UI contract', () => {
    const route = readFileSync(SMTP_ROUTE, 'utf8');
    const app = readFileSync(APP, 'utf8');

    expect(app).toContain('if (d.config) setSmtpConfig');
    expect(app).toContain('body: JSON.stringify(smtpConfig)');
    expect(route).toContain('config,');
    expect(route).toContain('port: z.coerce.number().int().min(1).max(65535)');
  });
});
