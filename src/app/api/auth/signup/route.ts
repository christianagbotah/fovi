import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel, isDbAvailable } from '@/lib/db';
import { hashPassword } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { z } from 'zod/v4';

const signupSchema = z.object({
  email: z.email(),
  name: z.string().min(1).optional(),
  password: z.string().min(8),
});

const limiter = rateLimit({ windowMs: 60_000, maxRequests: 3, keyPrefix: 'signup' });

export async function POST(request: NextRequest) {
  try {
    // Rate limit check
    const rateResult = limiter(request);
    if (!rateResult.allowed) {
      return NextResponse.json(
        { error: 'Too many sign-up attempts. Please try again later.' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(rateResult.retryAfterMs / 1000)) },
        }
      );
    }

    // Zod validation
    const body = await request.json();
    const parsed = signupSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const { email, password, name: schemaName } = parsed.data;
    const name = schemaName || body.fullName || '';

    const emailLower = email.toLowerCase().trim();

    if (isDbAvailable() && db && hasModel('user')) {
      // Check if user already exists
      const existing = await db.user.findUnique({ where: { email: emailLower } });
      if (existing) {
        return NextResponse.json(
          { error: 'An account with this email already exists' },
          { status: 409 }
        );
      }

      const passwordHash = hashPassword(password);

      const profileData = JSON.stringify({
        phone: body.phone || null,
        country: body.country || null,
        tradingExperience: body.experienceLevel || null,
        tradedAssets: body.assetTypes || [],
        tradingConcerns: body.concerns || [],
        portfolioSize: body.portfolioRange || null,
        referralSource: body.referralSource || null,
      });

      const user = await db.user.create({
        data: {
          email: emailLower,
          name: name.trim(),
          passwordHash,
        },
      });

      // Create default settings
      await db.userSettings.create({
        data: {
          userId: user.id,
        },
      });

      return NextResponse.json({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
      });
    }

    // Demo mode - simulate successful signup
    return NextResponse.json({
      success: true,
      user: {
        id: 'new-user-' + Date.now(),
        email: emailLower,
        name: name.trim(),
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}