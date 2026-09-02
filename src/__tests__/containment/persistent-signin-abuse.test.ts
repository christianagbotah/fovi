import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../..');
const ABUSE = resolve(ROOT, 'src/lib/auth-abuse.ts');
const SIGNIN = resolve(ROOT, 'src/app/api/auth/signin/route.ts');

describe('Phase 3R persistent sign-in abuse controls', () => {
  it('stores only a peppered identifier key in persistent configuration state', () => {
    const source = readFileSync(ABUSE, 'utf8');

    expect(source).toContain("createHmac('sha256', getPepper()).update(normalized).digest('hex')");
    expect(source).toContain("const SIGNIN_ABUSE_PREFIX = 'auth-abuse:signin:';");
    expect(source).toContain("hasModel('systemConfig')");
    expect(source).not.toContain('config: identifier');
  });

  it('uses a bounded five-failure window and temporary cooldown', () => {
    const source = readFileSync(ABUSE, 'utf8');

    expect(source).toContain('const FAILURE_WINDOW_MS = 15 * 60 * 1000;');
    expect(source).toContain('const COOLDOWN_MS = 15 * 60 * 1000;');
    expect(source).toContain('const MAX_FAILURES = 5;');
    expect(source).toContain('failedAttempts >= MAX_FAILURES');
    expect(source).toContain('updatedAt: { lt: new Date(Date.now() - RETENTION_MS) }');
  });

  it('serializes concurrent failure updates for the same identifier', () => {
    const source = readFileSync(ABUSE, 'utf8');

    expect(source).toContain('pg_advisory_xact_lock');
    expect(source).toContain('await db.$transaction(async (tx) => {');
    expect(source).toContain('await tx.systemConfig.upsert({');
  });

  it('checks persistent lockout before account lookup and records both invalid-credential paths', () => {
    const source = readFileSync(SIGNIN, 'utf8');

    const statusIndex = source.indexOf('await getSigninAbuseStatus(emailLower)');
    const lookupIndex = source.indexOf('db!.user.findUnique');
    expect(statusIndex).toBeGreaterThan(-1);
    expect(lookupIndex).toBeGreaterThan(statusIndex);

    expect(source.match(/await recordSigninFailure\(emailLower\)/g)?.length).toBe(2);
    expect(source).toContain("{ error: 'Invalid email or password' }");
  });

  it('clears the persistent failure state only after a valid active-account password', () => {
    const source = readFileSync(SIGNIN, 'utf8');

    const passwordIndex = source.indexOf('const valid = verifyPassword(password, user.passwordHash);');
    const activeIndex = source.indexOf('if (!user.isActive)');
    const clearIndex = source.indexOf('await clearSigninFailures(emailLower)');
    const challengeIndex = source.indexOf('if (user.settings?.twoFactorEnabled)');

    expect(passwordIndex).toBeGreaterThan(-1);
    expect(activeIndex).toBeGreaterThan(passwordIndex);
    expect(clearIndex).toBeGreaterThan(activeIndex);
    expect(challengeIndex).toBeGreaterThan(clearIndex);
  });

  it('retains the existing per-IP limiter as an independent first layer', () => {
    const source = readFileSync(SIGNIN, 'utf8');

    expect(source).toContain("rateLimit({ windowMs: 60_000, maxRequests: 5, keyPrefix: 'signin' })");
    expect(source).toContain('const rateResult = limiter(request);');
  });
});
