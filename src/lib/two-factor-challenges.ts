import { randomBytes } from 'node:crypto';
import { db, isDbAvailable } from './db';
import { generateTwoFactorChallenge } from './auth';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export interface IssuedTwoFactorChallenge {
  token: string;
  expiresAt: Date;
}

/**
 * Issue a server-tracked password-verified 2FA challenge.
 * The random challenge id is also carried as the signed JWT jti claim.
 */
export async function issueTwoFactorChallenge(
  userId: string,
  email: string,
): Promise<IssuedTwoFactorChallenge | null> {
  if (!isDbAvailable() || !db) return null;

  const challengeId = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);

  try {
    await db.$executeRaw`
      INSERT INTO "TwoFactorChallenge" ("id", "userId", "expiresAt")
      VALUES (${challengeId}, ${userId}, ${expiresAt})
    `;

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
