import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel, isDbAvailable, safeDbQuery } from '@/lib/db';
import { verifyPassword, generateAccessToken, generateTwoFactorChallenge } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { z } from 'zod/v4';

const signinSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
});

const limiter = rateLimit({ windowMs: 60_000, maxRequests: 5, keyPrefix: 'signin' });

export async function POST(request: NextRequest) {
  try {
    const rateResult = limiter(request);
    if (!rateResult.allowed) {
      return NextResponse.json(
        { error: 'Too many sign-in attempts. Please try again later.' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(rateResult.retryAfterMs / 1000)) },
        }
      );
    }

    const body = await request.json();
    const parsed = signinSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const { email, password } = parsed.data;
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

      if (user.settings?.twoFactorEnabled) {
        const twoFactorChallenge = await generateTwoFactorChallenge(user.id, user.email);
        return NextResponse.json({
          success: true,
          requiresTwoFactor: true,
          twoFactorChallenge,
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
          },
        });
      }

      const isAdmin = process.env.ADMIN_EMAIL && emailLower === process.env.ADMIN_EMAIL.toLowerCase();
      const token = await generateAccessToken(user.id, user.email, user.name || undefined, isAdmin ? 'admin' : undefined);

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

    // Local/demo authentication is opt-in and MUST never become a production
    // fallback when the database is missing or unavailable.
    const allowDemoAuth = process.env.NODE_ENV !== 'production' && process.env.ENABLE_DEMO_AUTH === 'true';
    if (allowDemoAuth && emailLower === 'demo@fovi.ai' && password === 'password123') {
      const token = await generateAccessToken('demo-user', 'demo@fovi.ai', 'Demo User');
      return NextResponse.json({
        success: true,
        user: {
          id: 'demo-user',
          email: 'demo@fovi.ai',
          name: 'Demo User',
        },
        token,
      });
    }

    return NextResponse.json(
      { error: 'Authentication service unavailable.' },
      { status: 503 }
    );
  } catch {
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}
