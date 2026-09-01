import type { Prisma } from '@prisma/client';

export type AuthSessionRevocationReason =
  | 'PASSWORD_CHANGED'
  | 'PASSWORD_RESET'
  | 'ADMIN_PASSWORD_RESET'
  | 'ACCOUNT_INACTIVE';

type AuthSessionClient = Pick<Prisma.TransactionClient, 'authSession'>;

/**
 * Revoke every currently active refresh session for a user.
 *
 * Call this with the same Prisma transaction that performs the credential or
 * account-status mutation so the security change is atomic: either both the
 * user mutation and session invalidation commit, or neither does.
 */
export async function revokeAllAuthSessionsForUser(
  client: AuthSessionClient,
  userId: string,
  reason: AuthSessionRevocationReason,
  now = new Date(),
): Promise<number> {
  const result = await client.authSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: now, revokeReason: reason },
  });

  return result.count;
}
