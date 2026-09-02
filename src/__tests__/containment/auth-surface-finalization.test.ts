import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const OTP_POLICY = 'src/lib/otp-policy.ts';
const OTP_SERVICE = 'src/lib/sms-otp.ts';
const RATE_LIMIT = 'src/lib/rate-limit.ts';
const PROXY = 'src/proxy.ts';

const FINALIZED_AUTH_ROUTES = [
  'src/app/api/auth/sms-otp/send/route.ts',
  'src/app/api/auth/sms-otp/verify/route.ts',
  'src/app/api/auth/email-otp/send/route.ts',
  'src/app/api/auth/email-otp/verify/route.ts',
  'src/app/api/auth/forgot-password/route.ts',
  'src/app/api/auth/reset-password/route.ts',
  'src/app/api/auth/change-password/route.ts',
  'src/app/api/auth/signup/route.ts',
  'src/app/api/auth/resend-verification/route.ts',
  'src/app/api/auth/verify-email/route.ts',
  'src/app/api/auth/two-factor/setup/route.ts',
  'src/app/api/auth/two-factor/verify/route.ts',
  'src/app/api/auth/two-factor/disable/route.ts',
] as const;

describe('Phase 3Q auth surface finalization', () => {
  it('allowlists OTP purposes instead of accepting arbitrary strings', () => {
    const policy = read(OTP_POLICY);
    const service = read(OTP_SERVICE);

    expect(policy).toContain("export const OTP_PURPOSES = ['login', 'signup'] as const;");
    expect(policy).toContain('z.enum(OTP_PURPOSES)');
    expect(service).toContain("import type { OtpPurpose } from '@/lib/otp-policy';");

    for (const path of FINALIZED_AUTH_ROUTES.filter(path => path.includes('-otp/'))) {
      expect(read(path)).toContain('otpPurposeSchema');
    }
  });

  it('bounds OTP retention without weakening valid OTP operations', () => {
    const service = read(OTP_SERVICE);

    expect(service).toContain('const OTP_RETENTION_MS = 24 * 60 * 60 * 1000;');
    expect(service).toContain('cleanupSmsOtpRecords');
    expect(service).toContain('cleanupEmailOtpRecords');
    expect(service).toContain('smsOtp.deleteMany');
    expect(service).toContain('emailOtp.deleteMany');
    expect(service).toContain('Retention cleanup must never turn a valid OTP operation into a failure.');
  });

  it('provides an identity-aware limiter in addition to the IP limiter', () => {
    const limiter = read(RATE_LIMIT);
    expect(limiter).toContain('export function rateLimitByKey');
    expect(limiter).toContain('consumeRateLimit(`${keyPrefix}:identity:${normalized}`');

    for (const path of FINALIZED_AUTH_ROUTES) {
      expect(read(path)).toContain('rateLimitByKey');
    }
  });

  it('uses non-cacheable auth responses across the finalized sensitive routes', () => {
    for (const path of FINALIZED_AUTH_ROUTES) {
      const source = read(path);
      expect(source).toContain("import { authJson } from '@/lib/auth-response';");
      expect(source).toContain('authJson(');
      expect(source).not.toContain('NextResponse.json');
    }
  });

  it('keeps change-password identity server-established by the verified proxy boundary', () => {
    const proxy = read(PROXY);
    const changePassword = read('src/app/api/auth/change-password/route.ts');

    expect(proxy).toContain("'x-user-id'");
    expect(proxy).toContain('cleanedHeaders.delete(header);');
    expect(proxy).toContain("cleanedHeaders.set('X-User-Id', payload.sub);");
    expect(changePassword).toContain("request.headers.get('X-User-Id')");
  });

  it('keeps recovery and verification responses enumeration-resistant', () => {
    const forgot = read('src/app/api/auth/forgot-password/route.ts');
    const resend = read('src/app/api/auth/resend-verification/route.ts');

    expect(forgot).toContain('If an account with this email exists, a reset link has been sent.');
    expect(resend).toContain('If the email exists and still needs verification, a verification link has been sent.');
    expect(resend).not.toContain('User not found');
  });
});
