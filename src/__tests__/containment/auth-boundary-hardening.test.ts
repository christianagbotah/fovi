import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const authLib = readFileSync(resolve(__dirname, '../../../src/lib/auth.ts'), 'utf8');
const signinRoute = readFileSync(resolve(__dirname, '../../../src/app/api/auth/signin/route.ts'), 'utf8');
const twoFactorRoute = readFileSync(resolve(__dirname, '../../../src/app/api/auth/two-factor/authenticate/route.ts'), 'utf8');
const signinPage = readFileSync(resolve(__dirname, '../../../src/app/auth/signin/page.tsx'), 'utf8');

describe('Phase 3E authentication boundary hardening', () => {
  it('never allows repository-known demo credentials to become a production fallback', () => {
    expect(signinRoute).toContain("process.env.NODE_ENV !== 'production'");
    expect(signinRoute).toContain("process.env.ENABLE_DEMO_AUTH === 'true'");
    expect(signinRoute).toContain("emailLower === 'demo@fovi.ai'");
    expect(signinRoute).toContain("password === 'password123'");
    expect(signinRoute).toContain("{ error: 'Authentication service unavailable.' }");
    expect(signinRoute).toContain('{ status: 503 }');

    const productionGuard = signinRoute.indexOf("process.env.NODE_ENV !== 'production'");
    const demoCredential = signinRoute.indexOf("emailLower === 'demo@fovi.ai'");
    expect(productionGuard).toBeGreaterThan(-1);
    expect(demoCredential).toBeGreaterThan(productionGuard);
  });

  it('issues a short-lived signed challenge only after password verification for 2FA users', () => {
    expect(authLib).toContain("type: 'two_factor'");
    expect(authLib).toContain('generateTwoFactorChallenge');
    expect(authLib).toContain(".setExpirationTime('5m')");
    expect(signinRoute).toContain('const valid = verifyPassword(password, user.passwordHash)');
    expect(signinRoute).toContain('const twoFactorChallenge = await generateTwoFactorChallenge(user.id, user.email)');
    expect(signinRoute).toContain('twoFactorChallenge,');

    const passwordVerification = signinRoute.indexOf('const valid = verifyPassword(password, user.passwordHash)');
    const challengeIssue = signinRoute.indexOf('const twoFactorChallenge = await generateTwoFactorChallenge(user.id, user.email)');
    expect(challengeIssue).toBeGreaterThan(passwordVerification);
  });

  it('requires the signed challenge instead of email-only TOTP authentication', () => {
    expect(twoFactorRoute).toContain('challenge: z.string().min(1)');
    expect(twoFactorRoute).not.toContain('email: z.email()');
    expect(twoFactorRoute).toContain('const challengePayload = await verifyToken(challenge)');
    expect(twoFactorRoute).toContain("challengePayload.type !== 'two_factor'");
    expect(twoFactorRoute).toContain('where: { id: challengePayload.sub }');
    expect(twoFactorRoute).toContain('user.email !== challengePayload.email');
  });

  it('carries the password-bound challenge through the browser 2FA step', () => {
    expect(signinPage).toContain("const [twoFactorChallenge, setTwoFactorChallenge] = useState('')");
    expect(signinPage).toContain('setTwoFactorChallenge(data.twoFactorChallenge)');
    expect(signinPage).toContain('JSON.stringify({ challenge: twoFactorChallenge, code: twoFactorCode, rememberMe })');
    expect(signinPage).not.toContain('JSON.stringify({ email: twoFactorUser?.email, code: twoFactorCode })');
  });

  it('compares password hashes with timingSafeEqual', () => {
    expect(authLib).toContain('timingSafeEqual');
    expect(authLib).toContain('if (stored.length !== computedHash.length) return false');
    expect(authLib).toContain('return timingSafeEqual(stored, computedHash)');
    expect(authLib).not.toContain('return hash === computedHash');
  });
});
