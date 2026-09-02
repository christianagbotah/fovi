import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const RESET = join(ROOT, 'src/app/api/auth/reset-password/route.ts');
const FORGOT = join(ROOT, 'src/app/api/auth/forgot-password/route.ts');

describe('Phase 3T one-time password-reset tokens', () => {
  it('claims and invalidates the reset token atomically with the password update', () => {
    const source = readFileSync(RESET, 'utf8');

    expect(source).toContain('UPDATE "User"');
    expect(source).toContain('SET "passwordHash" = ${newHash}');
    expect(source).toContain('"resetToken" = NULL');
    expect(source).toContain('"resetTokenExpiry" = NULL');
    expect(source).toContain('WHERE "resetToken" = ${hashedToken}');
    expect(source).toContain('AND "resetTokenExpiry" > CURRENT_TIMESTAMP');
    expect(source).toContain('RETURNING "id"');
    expect(source).not.toContain('user.findFirst');
  });

  it('revokes sessions and outstanding 2FA challenges inside the same transaction', () => {
    const source = readFileSync(RESET, 'utf8');
    const claim = source.indexOf('UPDATE "User"');
    const sessionRevoke = source.indexOf('await revokeAllAuthSessionsForUser(tx, userId');
    const challengeRevoke = source.indexOf('await revokeTwoFactorChallengesForUser(tx, userId)');

    expect(claim).toBeGreaterThanOrEqual(0);
    expect(sessionRevoke).toBeGreaterThan(claim);
    expect(challengeRevoke).toBeGreaterThan(sessionRevoke);
  });

  it('uses the hardened no-store auth response boundary for both recovery routes', () => {
    for (const file of [RESET, FORGOT]) {
      const source = readFileSync(file, 'utf8');
      expect(source).toContain("import { authJson } from '@/lib/auth-response';");
      expect(source).not.toContain('NextResponse.json');
    }
  });

  it('distinguishes invalid tokens from database failure after the atomic claim', () => {
    const source = readFileSync(RESET, 'utf8');

    expect(source).toContain('if (resetUserId === undefined)');
    expect(source).toContain("{ status: 503 }");
    expect(source).toContain('if (resetUserId === null)');
    expect(source).toContain("{ status: 400 }");
  });
});
