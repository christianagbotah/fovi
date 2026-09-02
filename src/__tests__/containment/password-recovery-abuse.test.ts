import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const ABUSE = join(ROOT, 'src/lib/auth-abuse.ts');
const FORGOT = join(ROOT, 'src/app/api/auth/forgot-password/route.ts');

describe('Phase 3U persistent password-recovery abuse controls', () => {
  it('uses a dedicated persistent HMAC-keyed recovery scope', () => {
    const source = readFileSync(ABUSE, 'utf8');

    expect(source).toContain("const PASSWORD_RECOVERY_ABUSE_PREFIX = 'auth-abuse:password-recovery:';");
    expect(source).toContain('createHmac(\'sha256\', getPepper()).update(normalized).digest(\'hex\')');
    expect(source).toContain('getPasswordRecoveryAbuseStatus');
    expect(source).toContain('recordPasswordRecoveryRequest');
    expect(source).toContain('getAbuseStatus(PASSWORD_RECOVERY_ABUSE_PREFIX, email)');
    expect(source).toContain('recordAbuseFailure(PASSWORD_RECOVERY_ABUSE_PREFIX, email)');
  });

  it('checks and records the normalized email before account lookup', () => {
    const source = readFileSync(FORGOT, 'utf8');

    expect(source).toContain('const emailLower = email.toLowerCase().trim();');
    const checkIndex = source.indexOf('await getPasswordRecoveryAbuseStatus(emailLower)');
    const recordIndex = source.indexOf('await recordPasswordRecoveryRequest(emailLower)');
    const lookupIndex = source.indexOf('db!.user.findUnique({ where: { email: emailLower } })');

    expect(checkIndex).toBeGreaterThanOrEqual(0);
    expect(recordIndex).toBeGreaterThan(checkIndex);
    expect(lookupIndex).toBeGreaterThan(recordIndex);
  });

  it('preserves the existing per-IP limiter as the first layer', () => {
    const source = readFileSync(FORGOT, 'utf8');

    expect(source).toContain("rateLimit({ windowMs: 60_000, maxRequests: 3, keyPrefix: 'forgot-pw' })");
    const ipCheck = source.indexOf('const rateResult = limiter(request);');
    const persistentCheck = source.indexOf('await getPasswordRecoveryAbuseStatus(emailLower)');
    expect(ipCheck).toBeGreaterThanOrEqual(0);
    expect(persistentCheck).toBeGreaterThan(ipCheck);
  });

  it('fails closed without exposing account existence when persistent state is unavailable', () => {
    const source = readFileSync(FORGOT, 'utf8');

    expect(source).toContain('if (!existingAbuse.available)');
    expect(source).toContain('if (!recordedAbuse.available)');
    expect(source).toContain('return genericRecoveryResponse();');
    expect(source).toContain('If an account with this email exists, a reset link has been sent.');
    expect(source).not.toContain('No account found');
    expect(source).not.toContain('User not found');
  });

  it('returns a bounded Retry-After when the email identifier is cooling down', () => {
    const source = readFileSync(FORGOT, 'utf8');

    expect(source).toContain('return recoveryRateLimited(existingAbuse.retryAfterMs);');
    expect(source).toContain('return recoveryRateLimited(recordedAbuse.retryAfterMs);');
    expect(source).toContain("status: 429");
    expect(source).toContain("'Retry-After': String(Math.max(1, Math.ceil(retryAfterMs / 1000)))");
  });
});
