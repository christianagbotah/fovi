import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../..');
const CHALLENGES = resolve(ROOT, 'src/lib/two-factor-challenges.ts');
const CHANGE_PASSWORD = resolve(ROOT, 'src/app/api/auth/change-password/route.ts');
const RESET_PASSWORD = resolve(ROOT, 'src/app/api/auth/reset-password/route.ts');
const TWO_FACTOR_SETUP = resolve(ROOT, 'src/app/api/auth/two-factor/setup/route.ts');
const TWO_FACTOR_VERIFY = resolve(ROOT, 'src/app/api/auth/two-factor/verify/route.ts');
const TWO_FACTOR_DISABLE = resolve(ROOT, 'src/app/api/auth/two-factor/disable/route.ts');
const ADMIN_USER = resolve(ROOT, 'src/app/api/admin/users/[id]/route.ts');
const GLOBALS = resolve(ROOT, 'src/app/globals.css');

function source(path: string) {
  return readFileSync(path, 'utf8');
}

describe('Phase 3O two-factor challenge revocation and dashboard scroll isolation', () => {
  it('serializes challenge issuance per user and supersedes older challenges before insert', () => {
    const challenges = source(CHALLENGES);

    expect(challenges).toContain('pg_advisory_xact_lock(hashtext(${userId}))');
    expect(challenges).toContain('revokeOutstandingTwoFactorChallenges(tx, userId)');
    expect(challenges).toContain('WHERE "userId" = ${userId}');
    expect(challenges).toContain('AND "consumedAt" IS NULL');

    const revokeIndex = challenges.indexOf('await revokeOutstandingTwoFactorChallenges(tx, userId)');
    const insertIndex = challenges.indexOf('INSERT INTO "TwoFactorChallenge"');
    expect(revokeIndex).toBeGreaterThan(-1);
    expect(insertIndex).toBeGreaterThan(revokeIndex);
  });

  it('revokes outstanding challenges in password security-state transactions', () => {
    for (const path of [CHANGE_PASSWORD, RESET_PASSWORD]) {
      const route = source(path);
      expect(route).toContain("import { revokeOutstandingTwoFactorChallenges } from '@/lib/two-factor-challenges';");
      expect(route).toContain('$transaction(async (tx) =>');
      expect(route).toMatch(/revokeOutstandingTwoFactorChallenges\(tx, user\.id\)/);
    }
  });

  it('revokes outstanding challenges whenever TOTP configuration changes', () => {
    const setup = source(TWO_FACTOR_SETUP);
    const verify = source(TWO_FACTOR_VERIFY);
    const disable = source(TWO_FACTOR_DISABLE);

    for (const route of [setup, verify, disable]) {
      expect(route).toContain("import { revokeOutstandingTwoFactorChallenges } from '@/lib/two-factor-challenges';");
      expect(route).toContain('$transaction(async (tx) =>');
      expect(route).toContain('revokeOutstandingTwoFactorChallenges(tx,');
    }

    expect(setup).toContain('update: { twoFactorSecret: secret, twoFactorEnabled: false }');
  });

  it('revokes challenges on admin password reset and account deactivation', () => {
    const route = source(ADMIN_USER);

    expect(route).toContain("import { revokeOutstandingTwoFactorChallenges } from '@/lib/two-factor-challenges';");
    expect(route.match(/revokeOutstandingTwoFactorChallenges\(tx, id\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(route).toContain("revokeAllAuthSessionsForUser(tx, id, 'ACCOUNT_INACTIVE')");
    expect(route).toContain("revokeAllAuthSessionsForUser(tx, id, 'ADMIN_PASSWORD_RESET')");
  });

  it('keeps desktop sidebar and main content as independent full-height scroll regions', () => {
    const css = source(GLOBALS);

    expect(css).toContain('height: 100dvh;');
    expect(css).toContain('aside.hidden.lg\\:flex.flex-col.w-56');
    expect(css).toContain('main.flex-1.overflow-y-auto.min-h-0');
    expect(css.match(/overscroll-behavior: contain;/g)?.length).toBeGreaterThanOrEqual(2);
    expect(css.match(/scrollbar-gutter: stable;/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
