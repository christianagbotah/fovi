import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel, isDbAvailable, safeDbQuery } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId } = body;
    if (!userId) return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
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
