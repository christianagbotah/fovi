import { NextRequest, NextResponse } from 'next/server';
import { db, isDbAvailable, safeDbQuery } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { code, userId } = body;
    if (!userId || !code) return NextResponse.json({ error: 'User ID and code required' }, { status: 400 });
    if (!/^\d{6}$/.test(code)) return NextResponse.json({ error: 'Code must be 6 digits' }, { status: 400 });
    if (!isDbAvailable() || !db) return NextResponse.json({ error: 'Requires database.' }, { status: 503 });

    const settings = await safeDbQuery(() => db!.userSettings.findUnique({ where: { userId } }));
    if (!settings?.twoFactorEnabled || !settings.twoFactorSecret) {
      return NextResponse.json({ error: '2FA not enabled.' }, { status: 400 });
    }

    const otplib = await import('otplib');
    if (!otplib.verify({ token: code, secret: settings.twoFactorSecret })) {
      return NextResponse.json({ error: 'Invalid code.' }, { status: 401 });
    }

    await safeDbQuery(() =>
      db!.userSettings.update({ where: { userId }, data: { twoFactorEnabled: false, twoFactorSecret: null } })
    );
    return NextResponse.json({ success: true, message: '2FA disabled.' });
  } catch {
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 });
  }
}
