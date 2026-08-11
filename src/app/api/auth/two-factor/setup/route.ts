import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel, isDbAvailable, safeDbQuery } from '@/lib/db';
import { rateLimit } from '@/lib/rate-limit';

const limiter = rateLimit({ windowMs: 60_000, maxRequests: 5, keyPrefix: '2fa-setup' });

export async function POST(request: NextRequest) {
  try {
    // Rate limit check
    const rateResult = limiter(request);
    if (!rateResult.allowed) {
      return NextResponse.json(
        { error: 'Too many 2FA setup attempts. Please try again later.' },
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

    // Check if this is a status check (no actual setup)
    const body = await request.json().catch(() => ({}));
    if (body._check) {
      if (!isDbAvailable() || !db || !hasModel('userSettings')) {
        return NextResponse.json({ twoFactorEnabled: false });
      }
      const settings = await safeDbQuery(() =>
        db!.userSettings.findUnique({ where: { userId }, select: { twoFactorEnabled: true, twoFactorMethod: true, phoneNumber: true } })
      );
      return NextResponse.json({ twoFactorEnabled: settings?.twoFactorEnabled ?? false, method: settings?.twoFactorMethod, phone: settings?.phoneNumber });
    }

    if (!isDbAvailable() || !db || !hasModel('user') || !hasModel('userSettings')) {
      return NextResponse.json({ error: '2FA requires a database connection.' }, { status: 503 });
    }

    const user = await safeDbQuery(() =>
      db!.user.findUnique({ where: { id: userId }, select: { id: true, email: true } })
    );
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const otplib = await import('otplib');
    const QRCode = await import('qrcode');
    const secret = otplib.generateSecret();
    const otpauthUrl = `otpauth://totp/Fovi:${user.email}?secret=${secret}&issuer=Fovi+AI`;
    const qrCodeBase64 = await QRCode.toDataURL(otpauthUrl);

    const updated = await safeDbQuery(() =>
      db!.userSettings.upsert({
        where: { userId: user.id },
        create: { userId: user.id, twoFactorSecret: secret, twoFactorEnabled: false },
        update: { twoFactorSecret: secret },
      })
    );
    if (!updated) return NextResponse.json({ error: 'Failed to save 2FA secret.' }, { status: 500 });

    return NextResponse.json({ success: true, secret, otpauth_url: otpauthUrl, qr_code_base64: qrCodeBase64 });
  } catch {
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 });
  }
}
