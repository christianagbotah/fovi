import { randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { db, isDbAvailable } from './db';
import { generateTwoFactorChallenge } from './auth';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

type TwoFactorChallengeClient = Pick<Prisma.TransactionClient, '$executeRaw'>;

export interface IssuedTwoFactorChallenge {
  token: string;
  expiresAt: Date;
}

/**
 * Invalidate every outstanding 2FA challenge for a user.
 *
 * Pass the same transaction client that performs a password, account-state,
 * or 2FA-configuration mutation so the security-state change and challenge
 * invalidation commit atomically.
 */
export async function revokeOutstandingTwoFactorChallenges(
  client: TwoFactorChallengeClient,
  userId: string,
  now = new Date(),
): Promise<number> {
  const revoked = await client.$executeRaw`
    UPDATE "TwoFactorChallenge"
    SET "consumedAt" = ${now}
    WHERE "userId" = ${userId}
      AND "consumedAt" IS NULL
  `;

  return revoked;
}

/**
 * Issue a server-tracked password-verified 2FA challenge.
 * The random challenge id is also carried as the signed JWT jti claim.
 *
 * Issuance is serialized per user with a transaction-scoped advisory lock.
 * A newer challenge supersedes every older unused challenge, so concurrent
 * password sign-ins can never leave multiple active challenges behind.
 */
export async function issueTwoFactorChallenge(
  userId: string,
  email: string,
): Promise<IssuedTwoFactorChallenge | null> {
  if (!isDbAvailable() || !db) return null;

  const challengeId = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);

  try {
    await db.$transaction(async (tx) => {
      // Serialize challenge issuance for this user. Without this lock, two
      // concurrent transactions could both revoke old rows and then each
      // insert a new active challenge under PostgreSQL READ COMMITTED.
      await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(hashtext(${userId}))
      `;

      await revokeOutstandingTwoFactorChallenges(tx, userId);

      await tx.$executeRaw`
        INSERT INTO "TwoFactorChallenge" ("id", "userId", "expiresAt")
        VALUES (${challengeId}, ${userId}, ${expiresAt})
      `;
    });

    // Best-effort housekeeping. Expired challenges are not accepted even if
    // cleanup fails, so housekeeping must never interrupt authentication.
    void db.$executeRaw`
      DELETE FROM "TwoFactorChallenge"
      WHERE "expiresAt" < ${new Date(Date.now() - 24 * 60 * 60 * 1000)}
    `.catch(() => undefined);

    return {
      token: await generateTwoFactorChallenge(userId, email, challengeId),
      expiresAt,
    };
  } catch {
    return null;
  }
}

/**
 * Atomically consume one challenge. Exactly one concurrent request can win.
 */
export async function consumeTwoFactorChallenge(
  challengeId: string,
  userId: string,
): Promise<boolean> {
  if (!isDbAvailable() || !db) return false;

  try {
    const consumed = await db.$executeRaw`
      UPDATE "TwoFactorChallenge"
      SET "consumedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${challengeId}
        AND "userId" = ${userId}
        AND "consumedAt" IS NULL
        AND "expiresAt" > CURRENT_TIMESTAMP
    `;
    return consumed === 1;
  } catch {
    return false;
  }
}
