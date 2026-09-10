import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  INTEGRATION_SECRET_PREFIX_V1,
  INTEGRATION_SECRET_REDACTION,
  openIntegrationSecret,
  sealIntegrationSecret,
} from '@/lib/integration-secret';

const ROOT = process.cwd();
const SECRET = join(ROOT, 'src/lib/integration-secret.ts');
const HUBTEL = join(ROOT, 'src/lib/hubtel.ts');
const SMS_ROUTE = join(ROOT, 'src/app/api/admin/config/hubtel-sms/route.ts');
const PAYMENT_ROUTE = join(ROOT, 'src/app/api/admin/config/hubtel-payment/route.ts');
const APP = join(ROOT, 'src/app/page.tsx');

describe('Phase 3AV Hubtel credential protection', () => {
  it('round-trips credentials only under their authenticated purpose', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const plaintext = 'hubtel-secret-test-123!';
      const stored = await sealIntegrationSecret(plaintext, 'hubtel-sms-client-secret');

      expect(stored).toBeTruthy();
      expect(stored).toMatch(new RegExp(`^${INTEGRATION_SECRET_PREFIX_V1}`));
      expect(stored).not.toContain(plaintext);
      await expect(openIntegrationSecret(stored!, 'hubtel-sms-client-secret')).resolves.toBe(plaintext);
      await expect(openIntegrationSecret(stored!, 'hubtel-payment-client-secret')).resolves.toBeNull();
    } finally {
      warn.mockRestore();
    }
  });

  it('keeps legacy plaintext readable and rejects unknown encrypted versions', async () => {
    await expect(openIntegrationSecret('legacy-client-id', 'hubtel-sms-client-id')).resolves.toBe('legacy-client-id');
    await expect(openIntegrationSecret('enc:v99:opaque', 'hubtel-sms-client-id')).resolves.toBeNull();
  });

  it('uses distinct authenticated domains for every protected Hubtel field', () => {
    const source = readFileSync(SECRET, 'utf8');

    expect(source).toContain("'hubtel-sms-client-id'");
    expect(source).toContain("'hubtel-sms-client-secret'");
    expect(source).toContain("'hubtel-payment-client-id'");
    expect(source).toContain("'hubtel-payment-client-secret'");
    expect(source).toContain("'hubtel-payment-account-number'");
    expect(source).toContain("const INTEGRATION_SECRET_AAD_PREFIX = 'fovi:integration-secret:v1:';");
    expect(source).toContain('encrypt(value, integrationSecretAad(purpose))');
    expect(source).toContain('integrationSecretAad(purpose),');
  });

  it('opens protected runtime credentials before Hubtel API authorization is constructed', () => {
    const source = readFileSync(HUBTEL, 'utf8');
    const smsOpen = source.indexOf("openIntegrationSecret(parsed.clientSecret, 'hubtel-sms-client-secret')");
    const paymentOpen = source.indexOf("openIntegrationSecret(parsed.clientSecret, 'hubtel-payment-client-secret')");
    const smsAuth = source.indexOf('Buffer.from(`${config.clientId}:${config.clientSecret}`)');

    expect(smsOpen).toBeGreaterThanOrEqual(0);
    expect(paymentOpen).toBeGreaterThan(smsOpen);
    expect(smsAuth).toBeGreaterThan(paymentOpen);
    expect(source).toContain("openIntegrationSecret(parsed.accountNumber, 'hubtel-payment-account-number')");
  });

  it('encrypts all protected values before SystemConfig persistence', () => {
    const source = readFileSync(HUBTEL, 'utf8');
    const smsSeal = source.indexOf("sealIntegrationSecret(config.clientSecret, 'hubtel-sms-client-secret')");
    const smsStore = source.indexOf("where: { key: 'hubtel_sms' }", smsSeal);
    const paymentSeal = source.indexOf("sealIntegrationSecret(config.clientSecret, 'hubtel-payment-client-secret')");
    const accountSeal = source.indexOf("sealIntegrationSecret(config.accountNumber, 'hubtel-payment-account-number')");
    const paymentStore = source.indexOf("where: { key: 'hubtel_payment' }", accountSeal);

    expect(smsSeal).toBeGreaterThanOrEqual(0);
    expect(smsStore).toBeGreaterThan(smsSeal);
    expect(paymentSeal).toBeGreaterThan(smsStore);
    expect(accountSeal).toBeGreaterThan(paymentSeal);
    expect(paymentStore).toBeGreaterThan(accountSeal);
    expect(source).not.toContain('config: JSON.stringify(config)');
  });

  it('returns fixed redaction rather than credential prefixes from both admin GET handlers', () => {
    const sms = readFileSync(SMS_ROUTE, 'utf8');
    const payment = readFileSync(PAYMENT_ROUTE, 'utf8');

    expect(INTEGRATION_SECRET_REDACTION).toBe('********');
    for (const source of [sms, payment]) {
      expect(source).toContain('INTEGRATION_SECRET_REDACTION');
      expect(source).toContain('config: publicConfig');
      expect(source).not.toContain('slice(0, n)');
    }
  });

  it('preserves redacted UI values by reopening the current server-side credentials before save', () => {
    const sms = readFileSync(SMS_ROUTE, 'utf8');
    const payment = readFileSync(PAYMENT_ROUTE, 'utf8');

    const smsSentinel = sms.indexOf('parsed.data.clientSecret === INTEGRATION_SECRET_REDACTION');
    const smsCurrent = sms.indexOf('const current = await getHubtelSmsConfig();');
    const smsSave = sms.indexOf('await saveHubtelSmsConfig(configToSave);');
    expect(smsSentinel).toBeGreaterThanOrEqual(0);
    expect(smsCurrent).toBeGreaterThan(smsSentinel);
    expect(smsSave).toBeGreaterThan(smsCurrent);

    const paymentSentinel = payment.indexOf('parsed.data.clientSecret === INTEGRATION_SECRET_REDACTION');
    const paymentCurrent = payment.indexOf('const current = await getHubtelPaymentConfig();');
    const paymentSave = payment.indexOf('await saveHubtelPaymentConfig(configToSave);');
    expect(paymentSentinel).toBeGreaterThanOrEqual(0);
    expect(paymentCurrent).toBeGreaterThan(paymentSentinel);
    expect(paymentSave).toBeGreaterThan(paymentCurrent);
  });

  it('aligns both admin GET responses with the existing d.config UI contract', () => {
    const app = readFileSync(APP, 'utf8');
    const sms = readFileSync(SMS_ROUTE, 'utf8');
    const payment = readFileSync(PAYMENT_ROUTE, 'utf8');

    expect(app).toContain('if (smsRes.ok) { const d = await smsRes.json(); if (d.config) setHubtelSmsConfig');
    expect(app).toContain('if (payRes.ok) { const d = await payRes.json(); if (d.config) setHubtelPayConfig');
    expect(sms).toContain('config: publicConfig');
    expect(payment).toContain('config: publicConfig');
  });
});
