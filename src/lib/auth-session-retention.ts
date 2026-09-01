import type { Prisma } from '@prisma/client';

export const AUTH_SESSION_POST_EXPIRY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

type AuthSessionClient = Pick<Prisma.TransactionClient, 'authSession'>;

export function authSessionCleanupCutoff(now = new Date()): Date {
  return new Date(now.getTime() - AUTH_SESSION_POST_EXPIRY_RETENTION_MS);
}

/**
 * Delete refresh-session history only after the family's absolute expiry has
 * been past for the full retention window. Every row in a family shares the
 * same absolute expiresAt, so rotation/reuse evidence remains available for
 * the entire valid lifetime plus 30 additional days.
 */
export async function cleanupExpiredAuthSessionHistory(
  client: AuthSessionClient,
  now = new Date(),
): Promise<number> {
  const result = await client.authSession.deleteMany({
    where: {
      expiresAt: { lt: authSessionCleanupCutoff(now) },
    },
  });

  return result.count;
}
