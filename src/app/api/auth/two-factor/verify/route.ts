import { NextRequest } from 'next/server';
import { db, isDbAvailable, safeDbQuery } from '@/lib/db';
import { extractBearerToken, verifyToken } from '@/lib/auth';
import { authJson } from '@/lib/auth-response';
import { revokeTwoFactorChallengesForUser } from '@/lib/two-factor-challenges';
import { rateLimit } from '@/lib/rate-limit';
import { z } from 'zod/v4';

const twoFactorVerifySchema = z.object({
  code: z.string().regex(/^\d{6}$/),
});

const limiter = rateLimit({ windowMs: 60_000, maxRequests: 10, keyPrefix: '2fa-verify' });

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

    const otplib = await import('otplib');
    const isValid = otplib.verify({ token: code, secret: settings.twoFactorSecret });
    if (!isValid) return authJson({ error: 'Invalid code.' }, { status: 401 });

    const enabled = await safeDbQuery(() =>
      db!.$transaction(async (tx) => {
        const claimed = await tx.userSettings.updateMany({
          where: {
            userId,
            twoFactorEnabled: false,
            twoFactorSecret: settings.twoFactorSecret,
          },
          data: { twoFactorEnabled: true },
        });

        if (claimed.count !== 1) {
          return false;
        }

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

    return authJson({ success: true, message: '2FA enabled.' });
  } catch {
    return authJson({ error: 'Unexpected error' }, { status: 500 });
  }
}
