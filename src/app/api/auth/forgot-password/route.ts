import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel, isDbAvailable } from '@/lib/db';
import { generateResetToken } from '@/lib/auth';

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
      const user = await db.user.findUnique({ where: { email: emailLower } });

      if (user) {
        // In production, send an email with the reset token
        // For now, just return success to avoid email enumeration
        const _token = generateResetToken();
        void _token;
      }
    }

    // Always return success to avoid email enumeration attacks
    return NextResponse.json({
      success: true,
      message: 'If an account with this email exists, a reset link has been sent.',
    });
  } catch {
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}
