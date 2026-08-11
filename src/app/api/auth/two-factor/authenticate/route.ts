import { NextRequest, NextResponse } from 'next/server';
import { db, isDbAvailable, safeDbQuery } from '@/lib/db';
import { generateToken } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, code } = body;
    if (!email || !code) return NextResponse.json({ error: 'Email and code required' }, { status: 400 });
    if (!/^\d{6}$/.test(code)) return NextResponse.json({ error: 'Code must be 6 digits' }, { status: 400 });
    if (!isDbAvailable() || !db) return NextResponse.json({ error: 'Requires database.' }, { status: 503 });

    const user = await safeDbQuery(() =>
      db!.user.findUnique({
        where: { email: email.toLowerCase().trim() },
        include: { settings: { select: { twoFactorEnabled: true, twoFactorSecret: true } } },
      })
    );
    if (!user?.settings?.twoFactorEnabled || !user.settings.twoFactorSecret) {
      return NextResponse.json({ error: '2FA not enabled.' }, { status: 400 });
    }

    const otplib = await import('otplib');
    if (!otplib.verify({ token: code, secret: user.settings.twoFactorSecret })) {
      return NextResponse.json({ error: 'Invalid code.' }, { status: 401 });
    }
    if (!user.isActive) return NextResponse.json({ error: 'Account deactivated' }, { status: 403 });

    return NextResponse.json({
      success: true,
      user: { id: user.id, email: user.email, name: user.name },
      token: generateToken(),
    });
  } catch {
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 });
  }
}
