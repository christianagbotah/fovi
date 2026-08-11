import { NextRequest, NextResponse } from 'next/server';
import { db, isDbAvailable, safeDbQuery } from '@/lib/db';
import { generateAccessToken } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { z } from 'zod/v4';

const twoFactorAuthSchema = z.object({
  email: z.email(),
  code: z.string().regex(/^\d{6}$/),
});

const limiter = rateLimit({ windowMs: 60_000, maxRequests: 10, keyPrefix: '2fa-auth' });

export async function POST(request: NextRequest) {
  try {
    // Rate limit check
    const rateResult = limiter(request);
    if (!rateResult.allowed) {
      return NextResponse.json(
        { error: 'Too many 2FA attempts. Please try again later.' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(rateResult.retryAfterMs / 1000)) },
        }
      );
    }

    // Zod validation
    const body = await request.json();
    const parsed = twoFactorAuthSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { email, code } = parsed.data;
    if (!isDbAvailable() || !db) return NextResponse.json({ error: 'Requires database.' }, { status: 503 });

    const user = await safeDbQuery(() =>
      db!.user.findUnique({
        where: { email: email.toLowerCase().trim() },
        include: { settings: { select: { twoFactorEnabled: true, twoFactorSecret: true } } },
      })
    );
    if (!user?.settings?.twoFactorEnabled || !user.settings.twoFactorSecret) {
      return NextResponse.json({ error: '2FA not enabled.' }, { status: 400 });
    }

    const otplib = await import('otplib');
    if (!otplib.verify({ token: code, secret: user.settings.twoFactorSecret })) {
      return NextResponse.json({ error: 'Invalid code.' }, { status: 401 });
    }
    if (!user.isActive) return NextResponse.json({ error: 'Account deactivated' }, { status: 403 });

    const isAdmin = process.env.ADMIN_EMAIL && user.email === process.env.ADMIN_EMAIL.toLowerCase();
    const token = await generateAccessToken(user.id, user.email, user.name || undefined, isAdmin ? 'admin' : undefined);

    return NextResponse.json({
      success: true,
      user: { id: user.id, email: user.email, name: user.name },
      token,
    });
  } catch {
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 });
  }
}
