import { NextRequest } from 'next/server';
import { db, hasModel, isDbAvailable, safeDbQuery } from '@/lib/db';
import { hashPassword, hashToken } from '@/lib/auth';
import { authJson } from '@/lib/auth-response';
import { clearRefreshCookie } from '@/lib/auth-sessions';
import { revokeAllAuthSessionsForUser } from '@/lib/auth-session-revocation';
import { revokeTwoFactorChallengesForUser } from '@/lib/two-factor-challenges';
import { rateLimit, rateLimitByKey } from '@/lib/rate-limit';
import { z } from 'zod/v4';

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8),
});

const ipLimiter = rateLimit({ windowMs: 60_000, maxRequests: 5, keyPrefix: 'reset-pw' });
const tokenLimiter = rateLimitByKey({ windowMs: 15 * 60_000, maxRequests: 5, keyPrefix: 'reset-pw' });

export async function POST(request: NextRequest) {
  try {
    const ipResult = ipLimiter(request);
    if (!ipResult.allowed) {
      return authJson(
        { error: 'Too many password reset attempts. Please try again later.' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(ipResult.retryAfterMs / 1000)) },
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
    const hashedToken = hashToken(token);

    const tokenResult = tokenLimiter(hashedToken);
    if (!tokenResult.allowed) {
      return authJson(
        { error: 'Too many password reset attempts. Please try again later.' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(tokenResult.retryAfterMs / 1000)) },
        }
      );
    }

    if (!isDbAvailable() || !db || !hasModel('user') || !hasModel('authSession')) {
      return authJson(
        { error: 'Password reset is not available in demo mode. This feature requires a database connection.' },
        { status: 503 }
      );
    }

    const now = new Date();
    const user = await safeDbQuery(() =>
      db!.user.findFirst({
        where: {
          resetToken: hashedToken,
          resetTokenExpiry: { gt: now },
        },
      })
    );

    if (!user) {
      return authJson(
        { error: 'Invalid or expired reset token' },
        { status: 400 }
      );
    }

    const newHash = hashPassword(newPassword);

    const reset = await safeDbQuery(() =>
      db!.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: user.id },
          data: {
            passwordHash: newHash,
            resetToken: null,
            resetTokenExpiry: null,
          },
        });
        await revokeAllAuthSessionsForUser(tx, user.id, 'PASSWORD_RESET');
        await revokeTwoFactorChallengesForUser(tx, user.id);
        return true;
      })
    );

    if (!reset) {
      return authJson(
        { error: 'Failed to update password. Please try again.' },
        { status: 500 }
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
    return authJson({ error: 'An unexpected error occurred' }, { status: 500 });
  }
}
