import { NextRequest } from 'next/server';
import { db, isDbAvailable, safeDbQuery } from '@/lib/db';
import { authJson } from '@/lib/auth-response';
import { revokeTwoFactorChallengesForUser } from '@/lib/two-factor-challenges';
import { rateLimit, rateLimitByKey } from '@/lib/rate-limit';
import { z } from 'zod/v4';

const twoFactorVerifySchema = z.object({
  code: z.string().regex(/^\d{6}$/),
});

const ipLimiter = rateLimit({ windowMs: 60_000, maxRequests: 10, keyPrefix: '2fa-verify' });
const identityLimiter = rateLimitByKey({ windowMs: 5 * 60_000, maxRequests: 6, keyPrefix: '2fa-verify' });

export async function POST(request: NextRequest) {
  try {
    const ipResult = ipLimiter(request);
    if (!ipResult.allowed) {
      return authJson(
        { error: 'Too many 2FA verification attempts. Please try again later.' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(ipResult.retryAfterMs / 1000)) },
        }
      );
    }

    const userId = request.headers.get('X-User-Id');
    if (!userId) {
      return authJson({ error: 'Authentication required' }, { status: 401 });
    }

    const identityResult = identityLimiter(userId);
    if (!identityResult.allowed) {
      return authJson(
        { error: 'Too many 2FA verification attempts. Please try again later.' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(identityResult.retryAfterMs / 1000)) },
        }
      );
    }

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
        await tx.userSettings.update({ where: { userId }, data: { twoFactorEnabled: true } });
        await revokeTwoFactorChallengesForUser(tx, userId);
        return true;
      })
    );
    if (!enabled) {
      return authJson({ error: 'Failed to enable 2FA.' }, { status: 500 });
    }

    return authJson({ success: true, message: '2FA enabled.' });
  } catch {
    return authJson({ error: 'Unexpected error' }, { status: 500 });
  }
}
