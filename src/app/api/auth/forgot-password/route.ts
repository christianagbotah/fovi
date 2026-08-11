import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel, isDbAvailable, safeDbQuery } from '@/lib/db';
import { generateResetToken, hashToken } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email } = body;

    if (!email) {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      );
    }

    const emailLower = email.toLowerCase().trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailLower)) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      );
    }

    if (isDbAvailable() && db && hasModel('user')) {
      const user = await safeDbQuery(() =>
        db!.user.findUnique({ where: { email: emailLower } })
      );

      if (user) {
        const resetToken = generateResetToken();
        const hashedToken = hashToken(resetToken);
        const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

        await safeDbQuery(() =>
          db!.user.update({
            where: { id: user.id },
            data: {
              resetToken: hashedToken,
              resetTokenExpiry: expiry,
            },
          })
        );

        // In production, send an email with `resetToken` here.
        // The token is NOT stored — only its hash is persisted.
      }
    }

    // Always return success to avoid email enumeration attacks
    return NextResponse.json({
      success: true,
      message: 'If an account with this email exists, a reset link has been sent.',
    });
  } catch {
    // Even on error, return success to prevent enumeration
    return NextResponse.json({
      success: true,
      message: 'If an account with this email exists, a reset link has been sent.',
    });
  }
}
