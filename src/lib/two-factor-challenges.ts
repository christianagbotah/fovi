import { randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { db, isDbAvailable } from './db';
import { generateTwoFactorChallenge } from './auth';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

type ChallengeTransaction = Pick<Prisma.TransactionClient, '$executeRaw'>;

export interface IssuedTwoFactorChallenge {
  token: string;
  expiresAt: Date;
}

/**
 * Invalidate every still-active password-verified 2FA challenge for a user.
 * We intentionally reuse consumedAt as the terminal marker so Phase 3O does
 * not introduce another acceptance state: consumed and superseded challenges
 * are both permanently unusable.
 */
export async function revokeTwoFactorChallengesForUser(
  client: ChallengeTransaction,
  userId: string,
): Promise<number> {
  return client.$executeRaw`
    UPDATE "TwoFactorChallenge"
    SET "consumedAt" = CURRENT_TIMESTAMP
    WHERE "userId" = ${userId}
      AND "consumedAt" IS NULL
      AND "expiresAt" > CURRENT_TIMESTAMP
  `;
}

/**
 * Issue a server-tracked password-verified 2FA challenge.
 * The random challenge id is also carried as the signed JWT jti claim.
 *
 * A per-user row lock serializes concurrent issuance. Each new challenge
 * invalidates all older active challenges before its own record is inserted,
 * leaving exactly one usable challenge for that user.
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
      const users = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "User"
        WHERE "id" = ${userId}
        FOR UPDATE
      `;
      if (users.length !== 1) {
        throw new Error('Cannot issue 2FA challenge for an unknown user.');
      }

      await revokeTwoFactorChallengesForUser(tx, userId);

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
