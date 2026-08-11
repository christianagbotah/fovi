import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel, isDbAvailable, safeDbQuery } from '@/lib/db';
import { verifyPassword, generateToken } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    const emailLower = email.toLowerCase().trim();

    if (isDbAvailable() && db && hasModel('user')) {
      const user = await safeDbQuery(() =>
        db!.user.findUnique({
          where: { email: emailLower },
          include: {
            settings: {
              select: {
                twoFactorEnabled: true,
              },
            },
          },
        })
      );

      if (!user || !user.passwordHash) {
        return NextResponse.json(
          { error: 'Invalid email or password' },
          { status: 401 }
        );
      }

      const valid = verifyPassword(password, user.passwordHash);
      if (!valid) {
        return NextResponse.json(
          { error: 'Invalid email or password' },
          { status: 401 }
        );
      }

      if (!user.isActive) {
        return NextResponse.json(
          { error: 'Account is deactivated' },
          { status: 403 }
        );
      }

      // Check if 2FA is enabled — if so, require a second step
      if (user.settings?.twoFactorEnabled) {
        return NextResponse.json({
          success: true,
          requiresTwoFactor: true,
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
          },
        });
      }

      const token = generateToken();

      return NextResponse.json({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
        token,
      });
    }

    // Demo mode - accept demo@fovi.ai / password123
    if (emailLower === 'demo@fovi.ai' && password === 'password123') {
      return NextResponse.json({
        success: true,
        user: {
          id: 'demo-user',
          email: 'demo@fovi.ai',
          name: 'Demo User',
        },
        token: generateToken(),
      });
    }

    return NextResponse.json(
      { error: 'Invalid email or password' },
      { status: 401 }
    );
  } catch {
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}
