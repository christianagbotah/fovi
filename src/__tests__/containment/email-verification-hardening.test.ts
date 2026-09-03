import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const ABUSE = join(ROOT, 'src/lib/auth-abuse.ts');
const SIGNUP = join(ROOT, 'src/app/api/auth/signup/route.ts');
const RESEND = join(ROOT, 'src/app/api/auth/resend-verification/route.ts');
const VERIFY = join(ROOT, 'src/app/api/auth/verify-email/route.ts');

describe('Phase 3X email verification hardening', () => {
  it('routes all email-verification boundary responses through authJson', () => {
    for (const file of [SIGNUP, RESEND, VERIFY]) {
      const source = readFileSync(file, 'utf8');
      expect(source).toContain("import { authJson } from '@/lib/auth-response';");
      expect(source).not.toContain('NextResponse.json');
    }
  });

  it('persistently throttles resend requests before account lookup', () => {
    const abuse = readFileSync(ABUSE, 'utf8');
    const resend = readFileSync(RESEND, 'utf8');

    expect(abuse).toContain("const EMAIL_VERIFICATION_ISSUANCE_ABUSE_PREFIX = 'auth-abuse:email-verification-issuance:';");
    expect(abuse).toContain('recordEmailVerificationIssuanceRequest');

    const throttle = resend.indexOf('recordEmailVerificationIssuanceRequest(email)');
    const lookup = resend.indexOf('db.user.findUnique({ where: { email } })');
    expect(throttle).toBeGreaterThan(-1);
    expect(lookup).toBeGreaterThan(throttle);
    expect(resend).toContain('if (!issuance.available)');
    expect(resend).toContain('if (issuance.locked)');
    expect(resend).toContain("'Retry-After'");
  });

  it('does not reveal whether resend targets are missing or already verified', () => {
    const resend = readFileSync(RESEND, 'utf8');

    expect(resend).toContain("const GENERIC_MESSAGE = 'If the email exists, a verification link has been sent.';");
    expect(resend).toContain('if (!user || user.emailVerified)');
    expect(resend).not.toContain('Email is already verified.');
  });

  it('atomically consumes exactly one unexpired 64-hex email verification token', () => {
    const verify = readFileSync(VERIFY, 'utf8');

    expect(verify).toContain('token: z.string().regex(/^[a-f0-9]{64}$/i)');
    expect(verify).toContain('const updated = await db.user.updateMany({');
    expect(verify).toContain('emailVerifyToken: hashedToken');
    expect(verify).toContain('emailVerified: false');
    expect(verify).toContain('emailVerifyExpiry: { gt: now }');
    expect(verify).toContain('emailVerified: true');
    expect(verify).toContain('emailVerifyToken: null');
    expect(verify).toContain('emailVerifyExpiry: null');
    expect(verify).toContain('if (updated.count !== 1)');
    expect(verify).not.toContain('user.findFirst');
  });
});
