import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel, isDbAvailable, safeDbQuery } from '@/lib/db';
import { hashPassword, verifyPassword } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { z } from 'zod/v4';

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

const limiter = rateLimit({ windowMs: 60_000, maxRequests: 5, keyPrefix: 'change-pw' });

export async function POST(request: NextRequest) {
  try {
    // Rate limit check
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

    // Zod validation
    const body = await request.json();
    const parsed = changePasswordSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    // Use userId from middleware (set from verified JWT)
    const userId = request.headers.get('X-User-Id');
    if (!userId) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const { currentPassword, newPassword } = parsed.data;

    if (!isDbAvailable() || !db || !hasModel('user')) {
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

    const updated = await safeDbQuery(() =>
      db!.user.update({
        where: { id: user.id },
        data: { passwordHash: newHash },
      })
    );

    if (!updated) {
      return NextResponse.json(
        { error: 'Failed to update password. Please try again.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Password has been changed successfully.',
    });
  } catch {
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}
