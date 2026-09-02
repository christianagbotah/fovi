import { NextRequest } from 'next/server';
import { db, hasModel, isDbAvailable, safeDbQuery } from '@/lib/db';
import { authJson } from '@/lib/auth-response';
import { revokeTwoFactorChallengesForUser } from '@/lib/two-factor-challenges';
import { rateLimit, rateLimitByKey } from '@/lib/rate-limit';

const ipLimiter = rateLimit({ windowMs: 60_000, maxRequests: 5, keyPrefix: '2fa-setup' });
const identityLimiter = rateLimitByKey({ windowMs: 15 * 60_000, maxRequests: 5, keyPrefix: '2fa-setup' });

export async function POST(request: NextRequest) {
  try {
    const ipResult = ipLimiter(request);
    if (!ipResult.allowed) {
      return authJson(
        { error: 'Too many 2FA setup attempts. Please try again later.' },
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
        { error: 'Too many 2FA setup attempts. Please try again later.' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(identityResult.retryAfterMs / 1000)) },
        }
      );
    }

    const body = await request.json().catch(() => ({}));
    if (body._check) {
      if (!isDbAvailable() || !db || !hasModel('userSettings')) {
        return authJson({ twoFactorEnabled: false });
      }
      const settings = await safeDbQuery(() =>
        db!.userSettings.findUnique({ where: { userId }, select: { twoFactorEnabled: true, twoFactorMethod: true, phoneNumber: true } })
      );
      return authJson({ twoFactorEnabled: settings?.twoFactorEnabled ?? false, method: settings?.twoFactorMethod, phone: settings?.phoneNumber });
    }

    if (!isDbAvailable() || !db || !hasModel('user') || !hasModel('userSettings')) {
      return authJson({ error: '2FA requires a database connection.' }, { status: 503 });
    }

    const user = await safeDbQuery(() =>
      db!.user.findUnique({ where: { id: userId }, select: { id: true, email: true } })
    );
    if (!user) return authJson({ error: 'User not found' }, { status: 404 });

    const otplib = await import('otplib');
    const QRCode = await import('qrcode');
    const secret = otplib.generateSecret();
    const otpauthUrl = `otpauth://totp/Fovi:${user.email}?secret=${secret}&issuer=Fovi+AI`;
    const qrCodeBase64 = await QRCode.toDataURL(otpauthUrl);

    const updated = await safeDbQuery(() =>
      db!.$transaction(async (tx) => {
        await tx.userSettings.upsert({
          where: { userId: user.id },
          create: { userId: user.id, twoFactorSecret: secret, twoFactorEnabled: false },
          update: { twoFactorSecret: secret, twoFactorEnabled: false },
        });
        await revokeTwoFactorChallengesForUser(tx, user.id);
        return true;
      })
    );
    if (!updated) return authJson({ error: 'Failed to save 2FA secret.' }, { status: 500 });

    return authJson({ success: true, secret, otpauth_url: otpauthUrl, qr_code_base64: qrCodeBase64 });
  } catch {
    return authJson({ error: 'An unexpected error occurred' }, { status: 500 });
  }
}
