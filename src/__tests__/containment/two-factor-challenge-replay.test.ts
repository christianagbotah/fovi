import { decodeJwt } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../..');
const AUTH = resolve(ROOT, 'src/lib/auth.ts');
const CHALLENGES = resolve(ROOT, 'src/lib/two-factor-challenges.ts');
const SIGNIN = resolve(ROOT, 'src/app/api/auth/signin/route.ts');
const AUTHENTICATE = resolve(ROOT, 'src/app/api/auth/two-factor/authenticate/route.ts');
const SCHEMA = resolve(ROOT, 'prisma/schema.prisma');
const MIGRATION = resolve(ROOT, 'prisma/migrations/20260901162500_one_time_two_factor_challenges/migration.sql');

const ORIGINAL_ENV = process.env;
const TEST_JWT = 'phase3n-test-jwt-secret-32chars!!';
const TEST_PEPPER = 'phase3n-test-pepper-minimum';

describe('Phase 3N one-time two-factor challenges', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
      JWT_SECRET: TEST_JWT,
      AUTH_PEPPER: TEST_PEPPER,
    };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('binds each 5-minute challenge JWT to a server challenge id', async () => {
    const auth = await import('@/lib/auth');
    const token = await auth.generateTwoFactorChallenge(
      'phase3n-user',
      'phase3n@example.test',
      'phase3n-challenge-id',
    );
    const payload = decodeJwt(token);

    expect(payload.type).toBe('two_factor');
    expect(payload.jti).toBe('phase3n-challenge-id');
    expect((payload.exp as number) - (payload.iat as number)).toBe(5 * 60);
  });

  it('persists a challenge store with user cascade and expiry indexes', () => {
    const schema = readFileSync(SCHEMA, 'utf8');
    const migration = readFileSync(MIGRATION, 'utf8');

    expect(schema).toContain('twoFactorChallenges TwoFactorChallenge[]');
    expect(schema).toContain('model TwoFactorChallenge {');
    expect(schema).toContain('user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)');
    expect(migration).toContain('CREATE TABLE "TwoFactorChallenge"');
    expect(migration).toContain('CREATE INDEX "TwoFactorChallenge_expiresAt_idx"');
  });

  it('issues challenges only through the server-tracked challenge service', () => {
    const signin = readFileSync(SIGNIN, 'utf8');
    expect(signin).toContain("import { issueTwoFactorChallenge } from '@/lib/two-factor-challenges';");
    expect(signin).toContain('const issuedChallenge = await issueTwoFactorChallenge(user.id, user.email);');
    expect(signin).toContain('twoFactorChallenge: issuedChallenge.token');
    expect(signin).not.toContain('generateTwoFactorChallenge(user.id, user.email)');
  });

  it('atomically rejects consumed or expired challenge records', () => {
    const source = readFileSync(CHALLENGES, 'utf8');
    expect(source).toContain('AND "consumedAt" IS NULL');
    expect(source).toContain('AND "expiresAt" > CURRENT_TIMESTAMP');
    expect(source).toContain('return consumed === 1;');
  });

  it('consumes a valid challenge before creating any refresh session', () => {
    const route = readFileSync(AUTHENTICATE, 'utf8');
    expect(route).toContain('!challengePayload.jti');
    expect(route).toContain('const consumed = await consumeTwoFactorChallenge(challengePayload.jti, user.id);');
    expect(route).toContain('Two-factor challenge was already used or expired.');

    const consumeIndex = route.indexOf('const consumed = await consumeTwoFactorChallenge');
    const sessionIndex = route.indexOf('session = await createAuthSession');
    expect(consumeIndex).toBeGreaterThan(-1);
    expect(sessionIndex).toBeGreaterThan(consumeIndex);
  });
});
