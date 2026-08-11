import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel, isDbAvailable, safeDbQuery } from '@/lib/db';
import { hashPassword, hashToken } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { z } from 'zod/v4';

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8),
});

const limiter = rateLimit({ windowMs: 60_000, maxRequests: 5, keyPrefix: 'reset-pw' });

export async function POST(request: NextRequest) {
  try {
    // Rate limit check
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

    // Zod validation
    const body = await request.json();
    const parsed = resetPasswordSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const { token, newPassword } = parsed.data;

    if (!isDbAvailable() || !db || !hasModel('user')) {
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

    const updated = await safeDbQuery(() =>
      db!.user.update({
        where: { id: user.id },
        data: {
          passwordHash: newHash,
          resetToken: null,
          resetTokenExpiry: null,
        },
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
      message: 'Password has been reset successfully.',
    });
  } catch {
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}
