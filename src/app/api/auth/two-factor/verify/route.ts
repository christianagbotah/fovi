import { NextRequest, NextResponse } from 'next/server';
import { db, isDbAvailable, safeDbQuery } from '@/lib/db';
import { revokeTwoFactorChallengesForUser } from '@/lib/two-factor-challenges';
import { rateLimit } from '@/lib/rate-limit';
import { z } from 'zod/v4';

const twoFactorVerifySchema = z.object({
  code: z.string().regex(/^\d{6}$/),
});

const limiter = rateLimit({ windowMs: 60_000, maxRequests: 10, keyPrefix: '2fa-verify' });

export async function POST(request: NextRequest) {
  try {
    // Rate limit check
    const rateResult = limiter(request);
    if (!rateResult.allowed) {
      return NextResponse.json(
        { error: 'Too many 2FA verification attempts. Please try again later.' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(rateResult.retryAfterMs / 1000)) },
        }
      );
    }

    // Use userId from middleware (set from verified JWT)
    const userId = request.headers.get('X-User-Id');
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    // Zod validation
    const body = await request.json();
    const parsed = twoFactorVerifySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { code } = parsed.data;
    if (!isDbAvailable() || !db) return NextResponse.json({ error: 'Requires database.' }, { status: 503 });

    const settings = await safeDbQuery(() => db!.userSettings.findUnique({ where: { userId } }));
    if (!settings?.twoFactorSecret) return NextResponse.json({ error: '2FA not set up.' }, { status: 400 });

    const otplib = await import('otplib');
    const isValid = otplib.verify({ token: code, secret: settings.twoFactorSecret });
    if (!isValid) return NextResponse.json({ error: 'Invalid code.' }, { status: 401 });

    const enabled = await safeDbQuery(() =>
      db!.$transaction(async (tx) => {
        await tx.userSettings.update({ where: { userId }, data: { twoFactorEnabled: true } });
        await revokeTwoFactorChallengesForUser(tx, userId);
        return true;
      })
    );
    if (!enabled) {
      return NextResponse.json({ error: 'Failed to enable 2FA.' }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: '2FA enabled.' });
  } catch {
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 });
  }
}
