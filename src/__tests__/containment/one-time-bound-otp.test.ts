import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../..');
const OTP_SERVICE = resolve(ROOT, 'src/lib/sms-otp.ts');
const SMS_SEND = resolve(ROOT, 'src/app/api/auth/sms-otp/send/route.ts');
const SMS_VERIFY = resolve(ROOT, 'src/app/api/auth/sms-otp/verify/route.ts');
const EMAIL_SEND = resolve(ROOT, 'src/app/api/auth/email-otp/send/route.ts');
const EMAIL_VERIFY = resolve(ROOT, 'src/app/api/auth/email-otp/verify/route.ts');

describe('Phase 3P one-time bound SMS and email OTPs', () => {
  it('protects low-entropy OTP hashes with the application pepper', () => {
    const source = readFileSync(OTP_SERVICE, 'utf8');

    expect(source).toContain("import { createHmac, randomInt } from 'crypto';");
    expect(source).toContain('const pepper = process.env.AUTH_PEPPER;');
    expect(source).toContain("createHmac('sha256', pepper).update(code).digest('hex')");
  });

  it('serializes successful issuance and supersedes older active codes', () => {
    const source = readFileSync(OTP_SERVICE, 'utf8');

    expect(source).toContain('pg_advisory_xact_lock');
    expect(source).toContain("await acquireOtpIssueLock(tx, `sms-otp:${userId}:${purpose}`);");
    expect(source).toContain("await acquireOtpIssueLock(tx, `email-otp:${identityKey}:${purpose}`);");
    expect(source).toContain('where: { userId, purpose, verified: false }');
    expect(source).toContain('where: { userId: null, email: normalizedEmail, purpose, verified: false }');
    expect(source).toContain('data: { verified: true }');

    const smsDelivery = source.indexOf('const delivery = await sendOtpViaSms(phoneNumber, code);');
    const smsPersist = source.indexOf('await db.$transaction(async (tx) => {');
    expect(smsDelivery).toBeGreaterThan(-1);
    expect(smsPersist).toBeGreaterThan(smsDelivery);
  });

  it('atomically consumes the newest code and retires legacy active rows', () => {
    const source = readFileSync(OTP_SERVICE, 'utf8');

    expect(source).toContain('WITH candidate AS (');
    expect(source).toContain('FOR UPDATE');
    expect(source).toContain('UPDATE "SmsOtp"');
    expect(source).toContain('UPDATE "EmailOtp"');
    expect(source).toContain('AND "verified" = FALSE');
    expect(source).toContain('AND "expiresAt" > CURRENT_TIMESTAMP');
    expect(source).toContain('verified: consumed > 0');
    expect(source).not.toContain('smsOtp.findFirst');
    expect(source).not.toContain('emailOtp.findFirst');
  });

  it('binds SMS verification to user, newest phone number, purpose, and numeric code', () => {
    const send = readFileSync(SMS_SEND, 'utf8');
    const verify = readFileSync(SMS_VERIFY, 'utf8');
    const service = readFileSync(OTP_SERVICE, 'utf8');

    expect(send).toContain("phoneNumber: z.string().regex(/^\\+\\d{10,15}$/)");
    expect(verify).toContain("code: z.string().regex(/^\\d{6}$/)");
    expect(verify).toContain("phoneNumber: z.string().regex(/^\\+\\d{10,15}$/)");
    expect(verify).toContain('const { code, phoneNumber, purpose } = parsed.data;');
    expect(verify).toContain('const result = await verifySmsOtp(userId, phoneNumber, code, purpose);');
    expect(service).toContain('candidate."phoneNumber" = ${phoneNumber}');
  });

  it('binds authenticated email OTP issuance and verification to the access-token subject', () => {
    const send = readFileSync(EMAIL_SEND, 'utf8');
    const verify = readFileSync(EMAIL_VERIFY, 'utf8');
    const service = readFileSync(OTP_SERVICE, 'utf8');

    expect(send).toContain('userId = payload.sub;');
    expect(send).toContain('const normalizedEmail = email.toLowerCase().trim();');
    expect(send).toContain('const result = await generateEmailOtp(normalizedEmail, userId, purpose);');
    expect(verify).toContain("code: z.string().regex(/^\\d{6}$/)");
    expect(verify).toContain('userId = payload.sub;');
    expect(verify).toContain('const result = await verifyEmailOtp(email, code, purpose, userId);');
    expect(service).toContain('candidate."email" = ${normalizedEmail}');
  });
});
