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
import { openTwoFactorSecret, sealTwoFactorSecret } from '@/lib/two-factor-secret';
import { rateLimit } from '@/lib/rate-limit';
import { z } from 'zod/v4';

const twoFactorVerifySchema = z.object({
  code: z.string().regex(/^\d{6}$/),
});

const limiter = rateLimit({ windowMs: 60_000, maxRequests: 10, keyPrefix: '2fa-verify' });

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
        { error: 'Too many 2FA verification attempts. Please try again later.' },
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
    const parsed = twoFactorVerifySchema.safeParse(body);
    if (!parsed.success) {
      return authJson({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { code } = parsed.data;
    if (!isDbAvailable() || !db) return authJson({ error: 'Requires database.' }, { status: 503 });

    const settings = await safeDbQuery(() => db!.userSettings.findUnique({ where: { userId } }));
    if (!settings?.twoFactorSecret) return authJson({ error: '2FA not set up.' }, { status: 400 });

    const openedSecret = await openTwoFactorSecret(settings.twoFactorSecret, userId);
    if (!openedSecret) {
      return authJson({ error: '2FA secret protection service unavailable.' }, { status: 503 });
    }

    const abuseStatus = await getTwoFactorAbuseStatus(userId);
    if (!abuseStatus.available || abuseStatus.locked) {
      return twoFactorAbuseBlockedResponse(abuseStatus);
    }

    const otplib = await import('otplib');
    const isValid = otplib.verify({ token: code, secret: openedSecret.secret });
    if (!isValid) {
      const failed = await recordTwoFactorFailure(userId);
      if (!failed.available || failed.locked) return twoFactorAbuseBlockedResponse(failed);
      return authJson({ error: 'Invalid code.' }, { status: 401 });
    }

    const nextStoredSecret = openedSecret.needsUpgrade
      ? await sealTwoFactorSecret(openedSecret.secret, userId)
      : settings.twoFactorSecret;
    if (!nextStoredSecret) {
      return authJson({ error: '2FA secret protection service unavailable.' }, { status: 503 });
    }

    const enabled = await safeDbQuery(() =>
      db!.$transaction(async (tx) => {
        const claimed = await tx.userSettings.updateMany({
          where: {
            userId,
            twoFactorEnabled: false,
            twoFactorSecret: settings.twoFactorSecret,
          },
          data: { twoFactorEnabled: true, twoFactorSecret: nextStoredSecret },
        });

        if (claimed.count !== 1) {
          return false;
        }

        await clearTwoFactorFailuresInTransaction(tx, userId);
        await revokeAllAuthSessionsForUser(tx, userId, 'TWO_FACTOR_ENABLED');
        await revokeTwoFactorChallengesForUser(tx, userId);
        return true;
      })
    );

    if (enabled === undefined) {
      return authJson({ error: 'Failed to enable 2FA.' }, { status: 500 });
    }

    if (!enabled) {
      return authJson(
        { error: '2FA settings changed during verification. Restart setup and try again.' },
        { status: 409 }
      );
    }

    const response = authJson(
      {
        success: true,
        message: '2FA enabled. Please sign in again.',
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
