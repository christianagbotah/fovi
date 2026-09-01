import { NextRequest, NextResponse } from 'next/server';
import { db, isDbAvailable, safeDbQuery } from '@/lib/db';
import { generateAccessToken, verifyToken } from '@/lib/auth';
import {
  createAuthSession,
  readRefreshCookie,
  revokeAuthSessionFamily,
  setRefreshCookie,
} from '@/lib/auth-sessions';
import { rateLimit } from '@/lib/rate-limit';
import { z } from 'zod/v4';

const twoFactorAuthSchema = z.object({
  challenge: z.string().min(1),
  code: z.string().regex(/^\d{6}$/),
  rememberMe: z.boolean().optional().default(false),
});

const limiter = rateLimit({ windowMs: 60_000, maxRequests: 10, keyPrefix: '2fa-auth' });

export async function POST(request: NextRequest) {
  try {
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

    const body = await request.json();
    const parsed = twoFactorAuthSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { challenge, code, rememberMe } = parsed.data;
    const challengePayload = await verifyToken(challenge);
    if (!challengePayload || challengePayload.type !== 'two_factor') {
      return NextResponse.json({ error: 'Invalid or expired two-factor challenge.' }, { status: 401 });
    }

    if (!isDbAvailable() || !db) {
      return NextResponse.json({ error: 'Authentication service unavailable.' }, { status: 503 });
    }

    const user = await safeDbQuery(() =>
      db!.user.findUnique({
        where: { id: challengePayload.sub },
        include: { settings: { select: { twoFactorEnabled: true, twoFactorSecret: true } } },
      })
    );

    if (!user || user.email !== challengePayload.email) {
      return NextResponse.json({ error: 'Invalid two-factor challenge.' }, { status: 401 });
    }
    if (!user.settings?.twoFactorEnabled || !user.settings.twoFactorSecret) {
      return NextResponse.json({ error: '2FA not enabled.' }, { status: 400 });
    }
    if (!user.isActive) {
      return NextResponse.json({ error: 'Account deactivated' }, { status: 403 });
    }

    const otplib = await import('otplib');
    if (!otplib.verify({ token: code, secret: user.settings.twoFactorSecret })) {
      return NextResponse.json({ error: 'Invalid code.' }, { status: 401 });
    }

    const existingRefreshToken = readRefreshCookie(request);
    if (existingRefreshToken) {
      await revokeAuthSessionFamily(existingRefreshToken, 'REAUTHENTICATED');
    }

    let session;
    try {
      session = await createAuthSession(user.id, rememberMe);
    } catch {
      return NextResponse.json({ error: 'Authentication session service unavailable.' }, { status: 503 });
    }

    const isAdmin = process.env.ADMIN_EMAIL && user.email === process.env.ADMIN_EMAIL.toLowerCase();
    const token = await generateAccessToken(user.id, user.email, user.name || undefined, isAdmin ? 'admin' : undefined);

    const response = NextResponse.json({
      success: true,
      user: { id: user.id, email: user.email, name: user.name },
      token,
    });
    setRefreshCookie(response, session);
    return response;
  } catch {
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 });
  }
}
