import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../..');
const REVOCATION = resolve(ROOT, 'src/lib/auth-session-revocation.ts');
const VERIFY = resolve(ROOT, 'src/app/api/auth/two-factor/verify/route.ts');
const DISABLE = resolve(ROOT, 'src/app/api/auth/two-factor/disable/route.ts');
const API_FETCH = resolve(ROOT, 'src/lib/api-fetch.ts');

describe('Phase 3AE 2FA session invalidation', () => {
  it('defines explicit refresh-session revocation reasons for both factor transitions', () => {
    const source = readFileSync(REVOCATION, 'utf8');

    expect(source).toContain("| 'TWO_FACTOR_ENABLED'");
    expect(source).toContain("| 'TWO_FACTOR_DISABLED'");
  });

  it('enables 2FA and revokes all refresh sessions atomically before challenge cleanup', () => {
    const source = readFileSync(VERIFY, 'utf8');

    expect(source).toContain("import { revokeAllAuthSessionsForUser } from '@/lib/auth-session-revocation';");
    expect(source).toContain("import { clearRefreshCookie } from '@/lib/auth-sessions';");

    const transactionIndex = source.indexOf('db!.$transaction(async (tx) => {');
    const claimIndex = source.indexOf('const claimed = await tx.userSettings.updateMany({', transactionIndex);
    const sessionRevokeIndex = source.indexOf(
      "await revokeAllAuthSessionsForUser(tx, userId, 'TWO_FACTOR_ENABLED');",
      claimIndex,
    );
    const challengeRevokeIndex = source.indexOf(
      'await revokeTwoFactorChallengesForUser(tx, userId);',
      sessionRevokeIndex,
    );

    expect(transactionIndex).toBeGreaterThan(-1);
    expect(claimIndex).toBeGreaterThan(transactionIndex);
    expect(sessionRevokeIndex).toBeGreaterThan(claimIndex);
    expect(challengeRevokeIndex).toBeGreaterThan(sessionRevokeIndex);
  });

  it('disables 2FA and revokes all refresh sessions after the disable claim succeeds', () => {
    const source = readFileSync(DISABLE, 'utf8');

    expect(source).toContain("import { revokeAllAuthSessionsForUser } from '@/lib/auth-session-revocation';");
    expect(source).toContain("import { clearRefreshCookie } from '@/lib/auth-sessions';");

    const transactionIndex = source.indexOf('db!.$transaction(async (tx) => {');
    const disableIndex = source.indexOf('const claimed = await tx.userSettings.updateMany({', transactionIndex);
    const claimCheckIndex = source.indexOf('if (claimed.count !== 1) {', disableIndex);
    const sessionRevokeIndex = source.indexOf(
      "await revokeAllAuthSessionsForUser(tx, userId, 'TWO_FACTOR_DISABLED');",
      claimCheckIndex,
    );
    const challengeRevokeIndex = source.indexOf(
      'await revokeTwoFactorChallengesForUser(tx, userId);',
      sessionRevokeIndex,
    );

    expect(transactionIndex).toBeGreaterThan(-1);
    expect(disableIndex).toBeGreaterThan(transactionIndex);
    expect(claimCheckIndex).toBeGreaterThan(disableIndex);
    expect(sessionRevokeIndex).toBeGreaterThan(claimCheckIndex);
    expect(challengeRevokeIndex).toBeGreaterThan(sessionRevokeIndex);
  });

  it('forces browser reauthentication after either successful factor-state change', () => {
    const verify = readFileSync(VERIFY, 'utf8');
    const disable = readFileSync(DISABLE, 'utf8');
    const apiFetch = readFileSync(API_FETCH, 'utf8');

    for (const source of [verify, disable]) {
      expect(source).toContain('reauthenticate: true');
      expect(source).toContain("'x-auth-session-invalidated': 'true'");
      expect(source).toContain('clearRefreshCookie(response);');
    }

    expect(apiFetch).toContain("res.headers.get('x-auth-session-invalidated') === 'true'");
    expect(apiFetch).toContain('clearBrowserAccessState();');
  });
});
