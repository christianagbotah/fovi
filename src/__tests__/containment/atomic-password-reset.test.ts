import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../..');
const RESET = resolve(ROOT, 'src/app/api/auth/reset-password/route.ts');

describe('Phase 3T atomic one-time password reset', () => {
  it('uses the hardened no-store auth response boundary for every reset response', () => {
    const source = readFileSync(RESET, 'utf8');

    expect(source).toContain("import { authJson } from '@/lib/auth-response';");
    expect(source).not.toContain('NextResponse.json');
    expect(source).not.toContain("import { NextRequest, NextResponse } from 'next/server';");
  });

  it('does not validate a reset token outside the consuming transaction', () => {
    const source = readFileSync(RESET, 'utf8');

    expect(source).not.toContain('db!.user.findFirst');
    expect(source).not.toContain('db!.user.findUnique');

    const transactionIndex = source.indexOf('db!.$transaction(async (tx) => {');
    const tokenSelectIndex = source.indexOf('WHERE "resetToken" = ${hashedToken}');
    expect(transactionIndex).toBeGreaterThan(-1);
    expect(tokenSelectIndex).toBeGreaterThan(transactionIndex);
  });

  it('locks the live reset-token row and fails closed unless exactly one candidate exists', () => {
    const source = readFileSync(RESET, 'utf8');

    expect(source).toContain('SELECT "id"');
    expect(source).toContain('AND "resetTokenExpiry" > CURRENT_TIMESTAMP');
    expect(source).toContain('FOR UPDATE');
    expect(source).toContain('if (candidates.length !== 1) return null;');
  });

  it('consumes the token with the token and expiry predicates still present', () => {
    const source = readFileSync(RESET, 'utf8');

    expect(source).toContain('UPDATE "User"');
    expect(source).toContain('"resetToken" = NULL');
    expect(source).toContain('"resetTokenExpiry" = NULL');
    expect(source).toContain('AND "resetToken" = ${hashedToken}');
    expect(source).toContain('AND "resetTokenExpiry" > CURRENT_TIMESTAMP');
    expect(source).toContain('if (consumed !== 1) return null;');
  });

  it('revokes sessions and outstanding 2FA challenges only after atomic token consumption', () => {
    const source = readFileSync(RESET, 'utf8');

    const consumedIndex = source.indexOf('if (consumed !== 1) return null;');
    const sessionIndex = source.indexOf("await revokeAllAuthSessionsForUser(tx, userId, 'PASSWORD_RESET');");
    const challengeIndex = source.indexOf('await revokeTwoFactorChallengesForUser(tx, userId);');

    expect(consumedIndex).toBeGreaterThan(-1);
    expect(sessionIndex).toBeGreaterThan(consumedIndex);
    expect(challengeIndex).toBeGreaterThan(sessionIndex);
  });

  it('distinguishes an invalid token from an unavailable database transaction and clears the browser refresh cookie on success', () => {
    const source = readFileSync(RESET, 'utf8');

    expect(source).toContain('if (resetUserId === undefined)');
    expect(source).toContain('if (resetUserId === null)');
    expect(source).toContain('clearRefreshCookie(response);');
  });
});
