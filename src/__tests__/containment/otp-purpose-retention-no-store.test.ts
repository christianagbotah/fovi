import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../..');
const PURPOSE = resolve(ROOT, 'src/lib/otp-purpose.ts');
const RETENTION = resolve(ROOT, 'src/lib/otp-retention.ts');
const ROUTES = [
  'src/app/api/auth/sms-otp/send/route.ts',
  'src/app/api/auth/sms-otp/verify/route.ts',
  'src/app/api/auth/email-otp/send/route.ts',
  'src/app/api/auth/email-otp/verify/route.ts',
].map((path) => resolve(ROOT, path));

describe('Phase 3Q OTP purpose, retention, and response boundary', () => {
  it('allowlists only supported OTP purposes', () => {
    const source = readFileSync(PURPOSE, 'utf8');
    expect(source).toContain("['login', 'signup'] as const");
    expect(source).toContain('z.enum(OTP_PURPOSES)');
  });

  it('routes use the shared purpose schema and no-store auth response helper', () => {
    for (const path of ROUTES) {
      const source = readFileSync(path, 'utf8');
      expect(source).toContain("import { authJson } from '@/lib/auth-response';");
      expect(source).toContain("import { otpPurposeSchema } from '@/lib/otp-purpose';");
      expect(source).toContain('purpose: otpPurposeSchema');
      expect(source).not.toContain('NextResponse.json');
    }
  });

  it('bounds verified or expired OTP retention without making auth depend on cleanup', () => {
    const source = readFileSync(RETENTION, 'utf8');
    expect(source).toContain('OTP_RETENTION_MS = 24 * 60 * 60 * 1000');
    expect(source).toContain("hasModel('smsOtp')");
    expect(source).toContain("hasModel('emailOtp')");
    expect(source).toContain('createdAt: { lt: cutoff }');
    expect(source).toContain('Promise.allSettled(jobs)');
  });

  it('runs cleanup after successful issuance only', () => {
    for (const path of ROUTES.filter((path) => path.includes('/send/'))) {
      const source = readFileSync(path, 'utf8');
      expect(source).toContain("import { cleanupOtpRetention } from '@/lib/otp-retention';");
      const successCheck = source.indexOf('if (!result.success)');
      const cleanup = source.indexOf('await cleanupOtpRetention();');
      expect(successCheck).toBeGreaterThan(-1);
      expect(cleanup).toBeGreaterThan(successCheck);
    }
  });
});
