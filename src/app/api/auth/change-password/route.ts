import { NextRequest } from 'next/server';
import { db, hasModel, isDbAvailable, safeDbQuery } from '@/lib/db';
import { extractBearerToken, hashPassword, verifyPassword, verifyToken } from '@/lib/auth';
import { authJson } from '@/lib/auth-response';
import { clearRefreshCookie } from '@/lib/auth-sessions';
import { revokeAllAuthSessionsForUser } from '@/lib/auth-session-revocation';
import { revokeTwoFactorChallengesForUser } from '@/lib/two-factor-challenges';
import { rateLimit } from '@/lib/rate-limit';
import { z } from 'zod/v4';

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

const limiter = rateLimit({ windowMs: 60_000, maxRequests: 5, keyPrefix: 'change-pw' });

export async function POST(request: NextRequest) {
  try {
    const rateResult = limiter(request);
    if (!rateResult.allowed) {
      return authJson(
        { error: 'Too many password change attempts. Please try again later.' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(rateResult.retryAfterMs / 1000)) },
        }
      );
    }

    const body = await request.json();
    const parsed = changePasswordSchema.safeParse(body);
    if (!parsed.success) {
      return authJson(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const bearerToken = extractBearerToken(request);
    if (!bearerToken) {
      return authJson({ error: 'Authentication required' }, { status: 401 });
    }

    const accessPayload = await verifyToken(bearerToken);
    if (!accessPayload || accessPayload.type !== 'access') {
      return authJson({ error: 'Invalid or expired token' }, { status: 401 });
    }
    const userId = accessPayload.sub;

    const { currentPassword, newPassword } = parsed.data;

    if (!isDbAvailable() || !db || !hasModel('user') || !hasModel('authSession')) {
      return authJson(
        { error: 'Password change is temporarily unavailable.' },
        { status: 503 }
      );
    }

    const user = await safeDbQuery(() =>
      db!.user.findUnique({ where: { id: userId } })
    );

    if (!user) {
      return authJson({ error: 'Authentication required' }, { status: 401 });
    }

    const currentPasswordValid = verifyPassword(currentPassword, user.passwordHash);
    if (!currentPasswordValid) {
      return authJson(
        { error: 'Current password is incorrect' },
        { status: 401 }
      );
    }

    const newHash = hashPassword(newPassword);

    const changed = await safeDbQuery(() =>
      db!.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: user.id },
          data: { passwordHash: newHash },
        });
        await revokeAllAuthSessionsForUser(tx, user.id, 'PASSWORD_CHANGED');
        await revokeTwoFactorChallengesForUser(tx, user.id);
        return true;
      })
    );

    if (!changed) {
      return authJson(
        { error: 'Failed to update password. Please try again.' },
        { status: 500 }
      );
    }

    const response = authJson(
      {
        success: true,
        message: 'Password has been changed successfully. Please sign in again.',
        reauthenticate: true,
      },
      { headers: { 'x-auth-session-invalidated': 'true' } },
    );
    clearRefreshCookie(response);
    return response;
  } catch {
    return authJson(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}
