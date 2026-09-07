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

    const setupResult = await safeDbQuery(() =>
      db!.$transaction(async (tx) => {
        const existingSettings = await tx.userSettings.findUnique({
          where: { userId: user.id },
          select: { twoFactorEnabled: true, twoFactorSecret: true },
        });

        if (existingSettings?.twoFactorEnabled) {
          return 'already_enabled' as const;
        }

        if (existingSettings) {
          const claimed = await tx.userSettings.updateMany({
            where: {
              userId: user.id,
              twoFactorEnabled: false,
              twoFactorSecret: existingSettings.twoFactorSecret,
            },
            data: { twoFactorSecret: secret },
          });

          if (claimed.count !== 1) {
            return 'conflict' as const;
          }
        } else {
          await tx.userSettings.create({
            data: { userId: user.id, twoFactorSecret: secret, twoFactorEnabled: false },
          });
        }

        await revokeTwoFactorChallengesForUser(tx, user.id);
        return 'updated' as const;
      })
    );

    if (setupResult === 'already_enabled') {
      return authJson(
        { error: '2FA is already enabled. Disable it with a valid code before starting a new setup.' },
        { status: 409 }
      );
    }

    if (setupResult === 'conflict') {
      return authJson(
        { error: '2FA settings changed during setup. Refresh your security settings and try again.' },
        { status: 409 }
      );
    }

    if (setupResult !== 'updated') {
      return authJson({ error: 'Failed to save 2FA secret.' }, { status: 500 });
    }

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
