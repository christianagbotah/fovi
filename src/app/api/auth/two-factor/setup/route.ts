import { NextRequest } from 'next/server';
import { db, hasModel, isDbAvailable, safeDbQuery } from '@/lib/db';
import { extractBearerToken, verifyToken } from '@/lib/auth';
import { authJson } from '@/lib/auth-response';
import { revokeTwoFactorChallengesForUser } from '@/lib/two-factor-challenges';
import { rateLimit } from '@/lib/rate-limit';

const limiter = rateLimit({ windowMs: 60_000, maxRequests: 5, keyPrefix: '2fa-setup' });

export async function POST(request: NextRequest) {
  try {
    const rateResult = limiter(request);
    if (!rateResult.allowed) {
      return authJson(
        { error: 'Too many 2FA setup attempts. Please try again later.' },
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

    const body = await request.json().catch(() => ({}));
    if (body._check) {
      if (!isDbAvailable() || !db || !hasModel('userSettings')) {
        return authJson({ twoFactorEnabled: false });
      }
      const settings = await safeDbQuery(() =>
        db!.userSettings.findUnique({
          where: { userId },
          select: { twoFactorEnabled: true, twoFactorMethod: true, phoneNumber: true },
        })
      );
      return authJson({
        twoFactorEnabled: settings?.twoFactorEnabled ?? false,
        method: settings?.twoFactorMethod,
        phone: settings?.phoneNumber,
      });
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

    return authJson({
      success: true,
      secret,
      otpauth_url: otpauthUrl,
      qr_code_base64: qrCodeBase64,
    });
  } catch {
    return authJson({ error: 'An unexpected error occurred' }, { status: 500 });
  }
}
