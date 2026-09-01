import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel, isDbAvailable, safeDbQuery } from '@/lib/db';
import { hashPassword, verifyPassword } from '@/lib/auth';
import { clearRefreshCookie } from '@/lib/auth-sessions';
import { revokeAllAuthSessionsForUser } from '@/lib/auth-session-revocation';
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
      return NextResponse.json(
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
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const userId = request.headers.get('X-User-Id');
    if (!userId) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const { currentPassword, newPassword } = parsed.data;

    if (!isDbAvailable() || !db || !hasModel('user') || !hasModel('authSession')) {
      return NextResponse.json(
        { error: 'Password change is not available in demo mode. This feature requires a database connection.' },
        { status: 503 }
      );
    }

    const user = await safeDbQuery(() =>
      db!.user.findUnique({ where: { id: userId } })
    );

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    const currentPasswordValid = verifyPassword(currentPassword, user.passwordHash);
    if (!currentPasswordValid) {
      return NextResponse.json(
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
        return true;
      })
    );

    if (!changed) {
      return NextResponse.json(
        { error: 'Failed to update password. Please try again.' },
        { status: 500 }
      );
    }

    const response = NextResponse.json(
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
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}
