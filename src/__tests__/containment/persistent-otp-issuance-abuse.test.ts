import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const ABUSE = join(ROOT, 'src/lib/auth-abuse.ts');
const SMS_SEND = join(ROOT, 'src/app/api/auth/sms-otp/send/route.ts');
const EMAIL_SEND = join(ROOT, 'src/app/api/auth/email-otp/send/route.ts');

describe('Phase 3V persistent OTP issuance abuse controls', () => {
  it('keeps separate HMAC-keyed persistent namespaces for SMS and email issuance', () => {
    const source = readFileSync(ABUSE, 'utf8');

    expect(source).toContain("const SMS_OTP_ISSUANCE_ABUSE_PREFIX = 'auth-abuse:sms-otp-issuance:';");
    expect(source).toContain("const EMAIL_OTP_ISSUANCE_ABUSE_PREFIX = 'auth-abuse:email-otp-issuance:';");
    expect(source).toContain("createHmac('sha256', getPepper())");
    expect(source).toContain('recordSmsOtpIssuanceRequest');
    expect(source).toContain('recordEmailOtpIssuanceRequest');
    expect(source).toContain('pg_advisory_xact_lock');
  });

  it('reserves the SMS destination slot before delivery and fails closed when state is unavailable', () => {
    const source = readFileSync(SMS_SEND, 'utf8');
    const reserve = source.indexOf('recordSmsOtpIssuanceRequest(`${purpose}:${phoneNumber}`)');
    const deliver = source.indexOf('generateSmsOtp(userId, phoneNumber, purpose)');

    expect(reserve).toBeGreaterThan(-1);
    expect(deliver).toBeGreaterThan(reserve);
    expect(source).toContain('if (!issuance.available)');
    expect(source).toContain("status: 503");
    expect(source).toContain('if (issuance.locked)');
    expect(source).toContain("'Retry-After'");
  });

  it('normalizes email and reserves the destination slot before delivery', () => {
    const source = readFileSync(EMAIL_SEND, 'utf8');
    const normalize = source.indexOf('const normalizedEmail = email.toLowerCase().trim();');
    const reserve = source.indexOf('recordEmailOtpIssuanceRequest(`${purpose}:${normalizedEmail}`)');
    const deliver = source.indexOf('generateEmailOtp(normalizedEmail, userId, purpose)');

    expect(normalize).toBeGreaterThan(-1);
    expect(reserve).toBeGreaterThan(normalize);
    expect(deliver).toBeGreaterThan(reserve);
    expect(source).toContain('if (!issuance.available)');
    expect(source).toContain('if (issuance.locked)');
  });
});
