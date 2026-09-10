import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const SIGNIN = join(ROOT, 'src/app/api/auth/signin/route.ts');

describe('Phase 3AT verified-email session boundary', () => {
  it('requires verified email after password proof and before any authenticated continuation', () => {
    const source = readFileSync(SIGNIN, 'utf8');

    const passwordCheck = source.indexOf('const valid = verifyPassword(password, user.passwordHash)');
    const clearFailures = source.indexOf('await clearSigninFailures(emailLower)');
    const verificationGuard = source.indexOf('if (!user.emailVerified)');
    const challengeIssue = source.indexOf('await issueTwoFactorChallenge(user.id, user.email)');
    const sessionIssue = source.indexOf('session = await replaceAuthSession(user.id, rememberMe, existingRefreshToken)');

    expect(passwordCheck).toBeGreaterThanOrEqual(0);
    expect(clearFailures).toBeGreaterThan(passwordCheck);
    expect(verificationGuard).toBeGreaterThan(clearFailures);
    expect(challengeIssue).toBeGreaterThan(verificationGuard);
    expect(sessionIssue).toBeGreaterThan(verificationGuard);
  });

  it('returns an explicit verification-required response without issuing tokens or cookies', () => {
    const source = readFileSync(SIGNIN, 'utf8');
    const guardIndex = source.indexOf('if (!user.emailVerified)');
    const nextAuthenticatedPath = source.indexOf('if (user.settings?.twoFactorEnabled)', guardIndex);
    const guardBlock = source.slice(guardIndex, nextAuthenticatedPath);

    expect(guardIndex).toBeGreaterThanOrEqual(0);
    expect(guardBlock).toContain("code: 'EMAIL_VERIFICATION_REQUIRED'");
    expect(guardBlock).toContain('{ status: 403 }');
    expect(guardBlock).not.toContain('issueTwoFactorChallenge');
    expect(guardBlock).not.toContain('replaceAuthSession');
    expect(guardBlock).not.toContain('generateAccessToken');
    expect(guardBlock).not.toContain('setRefreshCookie');
  });

  it('preserves same-origin, abuse, password, and active-account checks before the verification boundary', () => {
    const source = readFileSync(SIGNIN, 'utf8');

    const sameOrigin = source.indexOf('if (!isSameOriginMutation(request))');
    const abuse = source.indexOf('await getSigninAbuseStatus(emailLower)');
    const password = source.indexOf('const valid = verifyPassword(password, user.passwordHash)');
    const active = source.indexOf('if (!user.isActive)');
    const verification = source.indexOf('if (!user.emailVerified)');

    expect(sameOrigin).toBeGreaterThanOrEqual(0);
    expect(abuse).toBeGreaterThan(sameOrigin);
    expect(password).toBeGreaterThan(abuse);
    expect(active).toBeGreaterThan(password);
    expect(verification).toBeGreaterThan(active);
  });
});
