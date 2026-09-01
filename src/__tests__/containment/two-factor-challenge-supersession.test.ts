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
const PAGE = resolve(ROOT, 'src/app/page.tsx');
const GLOBALS = resolve(ROOT, 'src/app/globals.css');

describe('Phase 3O two-factor challenge supersession and shell scrolling', () => {
  it('serializes challenge issuance per user and revokes older active challenges first', () => {
    const source = readFileSync(CHALLENGES, 'utf8');

    expect(source).toContain('FOR UPDATE');
    expect(source).toContain('revokeTwoFactorChallengesForUser');
    expect(source).toContain('AND "consumedAt" IS NULL');
    expect(source).toContain('AND "expiresAt" > CURRENT_TIMESTAMP');

    const lockIndex = source.indexOf('FOR UPDATE');
    const revokeIndex = source.indexOf('await revokeTwoFactorChallengesForUser(tx, userId);');
    const insertIndex = source.indexOf('INSERT INTO "TwoFactorChallenge"');
    expect(lockIndex).toBeGreaterThan(-1);
    expect(revokeIndex).toBeGreaterThan(lockIndex);
    expect(insertIndex).toBeGreaterThan(revokeIndex);
  });

  it('revokes pending challenges when the password security state changes', () => {
    for (const path of [CHANGE_PASSWORD, RESET_PASSWORD]) {
      const source = readFileSync(path, 'utf8');
      expect(source).toContain("import { revokeTwoFactorChallengesForUser } from '@/lib/two-factor-challenges';");
      expect(source).toContain('db!.$transaction(async (tx) => {');
      expect(source).toContain('await revokeTwoFactorChallengesForUser(tx, user.id);');
    }
  });

  it('revokes pending challenges on every TOTP configuration transition', () => {
    const setup = readFileSync(TWO_FACTOR_SETUP, 'utf8');
    const verify = readFileSync(TWO_FACTOR_VERIFY, 'utf8');
    const disable = readFileSync(TWO_FACTOR_DISABLE, 'utf8');

    expect(setup).toContain('update: { twoFactorSecret: secret, twoFactorEnabled: false }');
    expect(setup).toContain('await revokeTwoFactorChallengesForUser(tx, user.id);');
    expect(verify).toContain('await revokeTwoFactorChallengesForUser(tx, userId);');
    expect(disable).toContain('await revokeTwoFactorChallengesForUser(tx, userId);');
  });

  it('keeps the dashboard viewport locked while sidebar and main scroll independently', () => {
    const page = readFileSync(PAGE, 'utf8');
    const globals = readFileSync(GLOBALS, 'utf8');

    expect(page).toContain('h-screen overflow-hidden flex flex-col bg-background');
    expect(page).toContain('flex-1 flex overflow-hidden min-h-0');
    expect(page).toContain('<main className="flex-1 overflow-y-auto min-h-0 pb-20 lg:pb-4">');
    expect(page).toContain('<nav className="flex-1 px-2 space-y-0.5 overflow-y-auto min-h-0">');

    expect(globals).toContain('@supports (height: 100dvh)');
    expect(globals).toContain('aside[class*="w-56"][class*="border-r"]');
    expect(globals).toContain('overscroll-behavior-y: contain;');
    expect(globals).toContain('main[class*="flex-1"][class*="overflow-y-auto"]');
  });
});
