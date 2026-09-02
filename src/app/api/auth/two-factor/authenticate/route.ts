import { NextRequest } from 'next/server';
import { db, isDbAvailable, safeDbQuery } from '@/lib/db';
import { generateAccessToken, verifyToken } from '@/lib/auth';
import {
  createAuthSession,
  readRefreshCookie,
  revokeAuthSessionFamily,
  setRefreshCookie,
} from '@/lib/auth-sessions';
import { authJson } from '@/lib/auth-response';
import {
  clearTwoFactorFailures,
  getTwoFactorAbuseStatus,
  recordTwoFactorFailure,
  type AuthAbuseStatus,
} from '@/lib/auth-abuse';
import { consumeTwoFactorChallenge } from '@/lib/two-factor-challenges';
import { rateLimit } from '@/lib/rate-limit';
import { z } from 'zod/v4';

const twoFactorAuthSchema = z.object({
  challenge: z.string().min(1),
  code: z.string().regex(/^\d{6}$/),
  rememberMe: z.boolean().optional().default(false),
});

const limiter = rateLimit({ windowMs: 60_000, maxRequests: 10, keyPrefix: '2fa-auth' });

function twoFactorAbuseBlockedResponse(status: AuthAbuseStatus) {
  const retryAfterMs = status.locked ? status.retryAfterMs : 60_000;
  return authJson(
    { error: status.available ? 'Too many 2FA attempts. Please try again later.' : 'Authentication service unavailable.' },
    {
      status: status.available ? 429 : 503,
      headers: { 'Retry-After': String(Math.max(1, Math.ceil(retryAfterMs / 1000))) },
    },
  );
}

export async function POST(request: NextRequest) {
  try {
    const rateResult = limiter(request);
    if (!rateResult.allowed) {
      return authJson(
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
      return authJson({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { challenge, code, rememberMe } = parsed.data;
    const challengePayload = await verifyToken(challenge);
    if (
      !challengePayload ||
      challengePayload.type !== 'two_factor' ||
      !challengePayload.jti
    ) {
      return authJson({ error: 'Invalid or expired two-factor challenge.' }, { status: 401 });
    }

    if (!isDbAvailable() || !db) {
      return authJson({ error: 'Authentication service unavailable.' }, { status: 503 });
    }

    const user = await safeDbQuery(() =>
      db!.user.findUnique({
        where: { id: challengePayload.sub },
        include: { settings: { select: { twoFactorEnabled: true, twoFactorSecret: true } } },
      })
    );

    if (!user || user.email !== challengePayload.email) {
      return authJson({ error: 'Invalid two-factor challenge.' }, { status: 401 });
    }
    if (!user.settings?.twoFactorEnabled || !user.settings.twoFactorSecret) {
      return authJson({ error: '2FA not enabled.' }, { status: 400 });
    }
    if (!user.isActive) {
      return authJson({ error: 'Account deactivated' }, { status: 403 });
    }

    const abuseStatus = await getTwoFactorAbuseStatus(user.id);
    if (!abuseStatus.available || abuseStatus.locked) {
      return twoFactorAbuseBlockedResponse(abuseStatus);
    }

    const otplib = await import('otplib');
    if (!otplib.verify({ token: code, secret: user.settings.twoFactorSecret })) {
      const failed = await recordTwoFactorFailure(user.id);
      if (!failed.available || failed.locked) return twoFactorAbuseBlockedResponse(failed);
      return authJson({ error: 'Invalid code.' }, { status: 401 });
    }

    // Consume only after a valid TOTP so ordinary mistakes do not burn the
    // password-verified challenge. The atomic UPDATE guarantees only one
    // concurrent successful request can create a session from this challenge.
    const consumed = await consumeTwoFactorChallenge(challengePayload.jti, user.id);
    if (!consumed) {
      return authJson({ error: 'Two-factor challenge was already used or expired.' }, { status: 401 });
    }

    if (!(await clearTwoFactorFailures(user.id))) {
      return authJson({ error: 'Authentication service unavailable. Please sign in again.' }, { status: 503 });
    }

    const existingRefreshToken = readRefreshCookie(request);
    if (existingRefreshToken) {
      await revokeAuthSessionFamily(existingRefreshToken, 'REAUTHENTICATED');
    }

    let session;
    try {
      session = await createAuthSession(user.id, rememberMe);
    } catch {
      return authJson({ error: 'Authentication session service unavailable. Please sign in again.' }, { status: 503 });
    }

    const isAdmin = process.env.ADMIN_EMAIL && user.email === process.env.ADMIN_EMAIL.toLowerCase();
    const token = await generateAccessToken(user.id, user.email, user.name || undefined, isAdmin ? 'admin' : undefined);

    const response = authJson({
      success: true,
      user: { id: user.id, email: user.email, name: user.name },
      token,
    });
    setRefreshCookie(response, session);
    return response;
  } catch {
    return authJson({ error: 'Unexpected error' }, { status: 500 });
  }
}
