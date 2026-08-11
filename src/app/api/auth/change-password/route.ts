import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel, isDbAvailable, safeDbQuery } from '@/lib/db';
import { hashPassword, verifyPassword } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token, currentPassword, newPassword } = body;

    if (!token || !currentPassword || !newPassword) {
      return NextResponse.json(
        { error: 'Token, current password, and new password are required' },
        { status: 400 }
      );
    }

    if (newPassword.length < 8) {
      return NextResponse.json(
        { error: 'New password must be at least 8 characters long' },
        { status: 400 }
      );
    }

    if (!isDbAvailable() || !db || !hasModel('user')) {
      return NextResponse.json(
        { error: 'Password change is not available in demo mode. This feature requires a database connection.' },
        { status: 503 }
      );
    }

    // For this endpoint we expect userId to be provided alongside the token
    const { userId } = body;

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      );
    }

    const user = await safeDbQuery(() =>
      db!.user.findUnique({
        where: { id: userId },
      })
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
