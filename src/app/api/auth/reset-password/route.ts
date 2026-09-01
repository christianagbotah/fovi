import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel, isDbAvailable, safeDbQuery } from '@/lib/db';
import { hashPassword, hashToken } from '@/lib/auth';
import { clearRefreshCookie } from '@/lib/auth-sessions';
import { revokeAllAuthSessionsForUser } from '@/lib/auth-session-revocation';
import { revokeOutstandingTwoFactorChallenges } from '@/lib/two-factor-challenges';
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
      return NextResponse.json(
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
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const { token, newPassword } = parsed.data;

    if (!isDbAvailable() || !db || !hasModel('user') || !hasModel('authSession')) {
      return NextResponse.json(
        { error: 'Password reset is not available in demo mode. This feature requires a database connection.' },
        { status: 503 }
      );
    }

    const hashedToken = hashToken(token);
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
      return NextResponse.json(
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
        await revokeOutstandingTwoFactorChallenges(tx, user.id);
        return true;
      })
    );

    if (!reset) {
      return NextResponse.json(
        { error: 'Failed to update password. Please try again.' },
        { status: 500 }
      );
    }

    const response = NextResponse.json({
      success: true,
      message: 'Password has been reset successfully. Please sign in again.',
      reauthenticate: true,
    });
    clearRefreshCookie(response);
    return response;
  } catch {
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}
