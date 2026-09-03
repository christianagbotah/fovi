import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const ABUSE = join(ROOT, 'src/lib/auth-abuse.ts');
const SMS_VERIFY = join(ROOT, 'src/app/api/auth/sms-otp/verify/route.ts');
const EMAIL_VERIFY = join(ROOT, 'src/app/api/auth/email-otp/verify/route.ts');

describe('Phase 3W persistent OTP verification abuse controls', () => {
  it('keeps separate persistent SMS and email verification namespaces', () => {
    const source = readFileSync(ABUSE, 'utf8');

    expect(source).toContain("const SMS_OTP_VERIFICATION_ABUSE_PREFIX = 'auth-abuse:sms-otp-verification:';");
    expect(source).toContain("const EMAIL_OTP_VERIFICATION_ABUSE_PREFIX = 'auth-abuse:email-otp-verification:';");
    expect(source).toContain('getSmsOtpVerificationAbuseStatus');
    expect(source).toContain('recordSmsOtpVerificationFailure');
    expect(source).toContain('clearSmsOtpVerificationFailures');
    expect(source).toContain('getEmailOtpVerificationAbuseStatus');
    expect(source).toContain('recordEmailOtpVerificationFailure');
    expect(source).toContain('clearEmailOtpVerificationFailures');
  });

  it('checks SMS cooldown before verification, records invalid codes, and clears on success', () => {
    const source = readFileSync(SMS_VERIFY, 'utf8');
    const statusCheck = source.indexOf('getSmsOtpVerificationAbuseStatus(abuseIdentifier)');
    const verify = source.indexOf('verifySmsOtp(userId, phoneNumber, code, purpose)');
    const failure = source.indexOf('recordSmsOtpVerificationFailure(abuseIdentifier)');
    const clear = source.indexOf('clearSmsOtpVerificationFailures(abuseIdentifier)');
    const success = source.indexOf('return authJson({ success: true, verified: true });');

    expect(source).toContain('const abuseIdentifier = `${purpose}:${phoneNumber}`;');
    expect(statusCheck).toBeGreaterThan(-1);
    expect(verify).toBeGreaterThan(statusCheck);
    expect(failure).toBeGreaterThan(verify);
    expect(clear).toBeGreaterThan(failure);
    expect(success).toBeGreaterThan(clear);
    expect(source).toContain('if (!abuseStatus.available || abuseStatus.locked)');
    expect(source).toContain("'Retry-After'");
  });

  it('checks email cooldown before verification, records invalid codes, and clears on success', () => {
    const source = readFileSync(EMAIL_VERIFY, 'utf8');
    const statusCheck = source.indexOf('getEmailOtpVerificationAbuseStatus(abuseIdentifier)');
    const verify = source.indexOf('verifyEmailOtp(email, code, purpose, userId)');
    const failure = source.indexOf('recordEmailOtpVerificationFailure(abuseIdentifier)');
    const clear = source.indexOf('clearEmailOtpVerificationFailures(abuseIdentifier)');
    const success = source.indexOf('return authJson({ success: true, verified: true });');

    expect(source).toContain('const abuseIdentifier = `${purpose}:${email}`;');
    expect(statusCheck).toBeGreaterThan(-1);
    expect(verify).toBeGreaterThan(statusCheck);
    expect(failure).toBeGreaterThan(verify);
    expect(clear).toBeGreaterThan(failure);
    expect(success).toBeGreaterThan(clear);
    expect(source).toContain('if (!abuseStatus.available || abuseStatus.locked)');
    expect(source).toContain("'Retry-After'");
  });
});
