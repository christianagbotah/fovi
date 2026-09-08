import { NextRequest } from 'next/server';
import { db, isDbAvailable, safeDbQuery } from '@/lib/db';
import { extractBearerToken, verifyToken } from '@/lib/auth';
import { authJson } from '@/lib/auth-response';
import { clearRefreshCookie } from '@/lib/auth-sessions';
import { revokeAllAuthSessionsForUser } from '@/lib/auth-session-revocation';
import {
  clearTwoFactorFailuresInTransaction,
  getTwoFactorAbuseStatus,
  recordTwoFactorFailure,
  type AuthAbuseStatus,
} from '@/lib/auth-abuse';
import { revokeTwoFactorChallengesForUser } from '@/lib/two-factor-challenges';
import { openTwoFactorSecret } from '@/lib/two-factor-secret';
import { rateLimit } from '@/lib/rate-limit';
import { z } from 'zod/v4';

const twoFactorDisableSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
});

const limiter = rateLimit({ windowMs: 60_000, maxRequests: 10, keyPrefix: '2fa-disable' });

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
        { error: 'Too many 2FA disable attempts. Please try again later.' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(rateResult.retryAfterMs / 1000)) },
        }
      );
    }

    const bearerToken = extractBearerToken(request);
    if (!bearerToken) {
      return authJson({ error: 'Authentication required' }, { status: 401 });
    }

    const accessPayload = await verifyToken(bearerToken);
    if (!accessPayload || accessPayload.type !== 'access') {
      return authJson({ error: 'Invalid or expired token' }, { status: 401 });
    }
    const userId = accessPayload.sub;

    const body = await request.json();
    const parsed = twoFactorDisableSchema.safeParse(body);
    if (!parsed.success) {
      return authJson({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { code } = parsed.data;
    if (!isDbAvailable() || !db) return authJson({ error: 'Requires database.' }, { status: 503 });

    const settings = await safeDbQuery(() => db!.userSettings.findUnique({ where: { userId } }));
    if (!settings?.twoFactorEnabled || !settings.twoFactorSecret) {
      return authJson({ error: '2FA not enabled.' }, { status: 400 });
    }

    const openedSecret = await openTwoFactorSecret(settings.twoFactorSecret);
    if (!openedSecret) {
      return authJson({ error: '2FA secret protection service unavailable.' }, { status: 503 });
    }

    const abuseStatus = await getTwoFactorAbuseStatus(userId);
    if (!abuseStatus.available || abuseStatus.locked) {
      return twoFactorAbuseBlockedResponse(abuseStatus);
    }

    const otplib = await import('otplib');
    if (!otplib.verify({ token: code, secret: openedSecret.secret })) {
      const failed = await recordTwoFactorFailure(userId);
      if (!failed.available || failed.locked) return twoFactorAbuseBlockedResponse(failed);
      return authJson({ error: 'Invalid code.' }, { status: 401 });
    }

    const disabled = await safeDbQuery(() =>
      db!.$transaction(async (tx) => {
        const claimed = await tx.userSettings.updateMany({
          where: {
            userId,
            twoFactorEnabled: true,
            twoFactorSecret: settings.twoFactorSecret,
          },
          data: { twoFactorEnabled: false, twoFactorSecret: null },
        });

        if (claimed.count !== 1) {
          return false;
        }

        await clearTwoFactorFailuresInTransaction(tx, userId);
        await revokeAllAuthSessionsForUser(tx, userId, 'TWO_FACTOR_DISABLED');
        await revokeTwoFactorChallengesForUser(tx, userId);
        return true;
      })
    );

    if (disabled === undefined) {
      return authJson({ error: 'Failed to disable 2FA.' }, { status: 500 });
    }

    if (!disabled) {
      return authJson(
        { error: '2FA settings changed during disable. Refresh your security settings and try again.' },
        { status: 409 }
      );
    }

    const response = authJson(
      {
        success: true,
        message: '2FA disabled. Please sign in again.',
        reauthenticate: true,
      },
      { headers: { 'x-auth-session-invalidated': 'true' } },
    );
    clearRefreshCookie(response);
    return response;
  } catch {
    return authJson({ error: 'Unexpected error' }, { status: 500 });
  }
}
