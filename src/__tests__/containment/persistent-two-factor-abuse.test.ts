import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../..');
const ABUSE = resolve(ROOT, 'src/lib/auth-abuse.ts');
const TWO_FACTOR_AUTH = resolve(ROOT, 'src/app/api/auth/two-factor/authenticate/route.ts');
const SIGNIN = resolve(ROOT, 'src/app/api/auth/signin/route.ts');

describe('Phase 3S persistent two-factor abuse controls', () => {
  it('uses a separate persistent namespace for account-level TOTP failures', () => {
    const source = readFileSync(ABUSE, 'utf8');

    expect(source).toContain("const TWO_FACTOR_ABUSE_PREFIX = 'auth-abuse:two-factor:';");
    expect(source).toContain('getTwoFactorAbuseStatus(userId: string)');
    expect(source).toContain('recordTwoFactorFailure(userId: string)');
    expect(source).toContain('clearTwoFactorFailures(userId: string)');
    expect(source).toContain('return getAbuseStatus(TWO_FACTOR_ABUSE_PREFIX, userId);');
    expect(source).toContain('return recordAbuseFailure(TWO_FACTOR_ABUSE_PREFIX, userId);');
  });

  it('checks persistent 2FA cooldown after challenge-user binding but before TOTP verification', () => {
    const source = readFileSync(TWO_FACTOR_AUTH, 'utf8');

    const bindingIndex = source.indexOf("if (!user || user.email !== challengePayload.email)");
    const abuseIndex = source.indexOf('await getTwoFactorAbuseStatus(user.id)');
    const verifyIndex = source.indexOf("otplib.verify({ token: code, secret: user.settings.twoFactorSecret })");

    expect(bindingIndex).toBeGreaterThan(-1);
    expect(abuseIndex).toBeGreaterThan(bindingIndex);
    expect(verifyIndex).toBeGreaterThan(abuseIndex);
  });

  it('records invalid TOTP attempts against the user rather than the challenge', () => {
    const source = readFileSync(TWO_FACTOR_AUTH, 'utf8');

    expect(source).toContain('const failed = await recordTwoFactorFailure(user.id);');
    expect(source).not.toContain('recordTwoFactorFailure(challengePayload.jti)');
    expect(source).toContain("{ error: 'Invalid code.' }");
  });

  it('clears failed-TOTP history only after the one-time challenge is consumed', () => {
    const source = readFileSync(TWO_FACTOR_AUTH, 'utf8');

    const consumeIndex = source.indexOf('await consumeTwoFactorChallenge(challengePayload.jti, user.id)');
    const clearIndex = source.indexOf('await clearTwoFactorFailures(user.id)');
    const sessionIndex = source.indexOf('session = await createAuthSession(user.id, rememberMe);');

    expect(consumeIndex).toBeGreaterThan(-1);
    expect(clearIndex).toBeGreaterThan(consumeIndex);
    expect(sessionIndex).toBeGreaterThan(clearIndex);
  });

  it('does not reset 2FA failure history when sign-in merely issues a fresh challenge', () => {
    const signin = readFileSync(SIGNIN, 'utf8');

    expect(signin).toContain('await issueTwoFactorChallenge(user.id, user.email)');
    expect(signin).not.toContain('clearTwoFactorFailures');
  });

  it('retains the independent per-IP 2FA limiter', () => {
    const source = readFileSync(TWO_FACTOR_AUTH, 'utf8');

    expect(source).toContain("rateLimit({ windowMs: 60_000, maxRequests: 10, keyPrefix: '2fa-auth' })");
    expect(source).toContain('const rateResult = limiter(request);');
  });
});
