import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel, isDbAvailable, safeDbQuery } from '@/lib/db';
import { hashPassword, hashToken } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token, newPassword } = body;

    if (!token || !newPassword) {
      return NextResponse.json(
        { error: 'Token and new password are required' },
        { status: 400 }
      );
    }

    if (newPassword.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters long' },
        { status: 400 }
      );
    }

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
