import { NextRequest } from 'next/server';
import { db, hasModel, isDbAvailable, safeDbQuery } from '@/lib/db';
import { hashPassword, hashToken } from '@/lib/auth';
import { authJson } from '@/lib/auth-response';
import { clearRefreshCookie } from '@/lib/auth-sessions';
import { revokeAllAuthSessionsForUser } from '@/lib/auth-session-revocation';
import { revokeTwoFactorChallengesForUser } from '@/lib/two-factor-challenges';
import { rateLimit } from '@/lib/rate-limit';
import { z } from 'zod/v4';

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8),
});

const limiter = rateLimit({ windowMs: 60_000, maxRequests: 5, keyPrefix: 'reset-pw' });

export async function POST(request: NextRequest) {
  try {
    const rateResult = limiter(request);
    if (!rateResult.allowed) {
      return authJson(
        { error: 'Too many password reset attempts. Please try again later.' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(rateResult.retryAfterMs / 1000)) },
        }
      );
    }

    const body = await request.json();
    const parsed = resetPasswordSchema.safeParse(body);
    if (!parsed.success) {
      return authJson(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const { token, newPassword } = parsed.data;

    if (!isDbAvailable() || !db || !hasModel('user') || !hasModel('authSession')) {
      return authJson(
        { error: 'Password reset is not available. This feature requires the authentication database.' },
        { status: 503 }
      );
    }

    const hashedToken = hashToken(token);
    const newHash = hashPassword(newPassword);

    const resetUserId = await safeDbQuery(() =>
      db!.$transaction(async (tx) => {
        const candidates = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM "User"
          WHERE "resetToken" = ${hashedToken}
            AND "resetTokenExpiry" > CURRENT_TIMESTAMP
          FOR UPDATE
        `;

        if (candidates.length !== 1) return null;
        const userId = candidates[0].id;

        const consumed = await tx.$executeRaw`
          UPDATE "User"
          SET "passwordHash" = ${newHash},
              "resetToken" = NULL,
              "resetTokenExpiry" = NULL,
              "updatedAt" = CURRENT_TIMESTAMP
          WHERE "id" = ${userId}
            AND "resetToken" = ${hashedToken}
            AND "resetTokenExpiry" > CURRENT_TIMESTAMP
        `;

        if (consumed !== 1) return null;

        await revokeAllAuthSessionsForUser(tx, userId, 'PASSWORD_RESET');
        await revokeTwoFactorChallengesForUser(tx, userId);
        return userId;
      })
    );

    if (resetUserId === undefined) {
      return authJson(
        { error: 'Password reset service unavailable. Please try again.' },
        { status: 503 }
      );
    }

    if (resetUserId === null) {
      return authJson(
        { error: 'Invalid or expired reset token' },
        { status: 400 }
      );
    }

    const response = authJson({
      success: true,
      message: 'Password has been reset successfully. Please sign in again.',
      reauthenticate: true,
    });
    clearRefreshCookie(response);
    return response;
  } catch {
    return authJson(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}
