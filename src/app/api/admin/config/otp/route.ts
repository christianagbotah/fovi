import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { db, isDbAvailable, hasModel } from '@/lib/db';
import { getSystemConfig, saveSystemConfig } from '@/lib/system-config';
import { requireAdminPermission } from '@/lib/admin-authorization';
import { AUTHZ_PERMISSIONS } from '@/lib/rbac';

const DEFAULTS = {
  codeLength: 6,
  expiryMinutes: 10,
  maxAttempts: 5,
};

const otpSchema = z.object({
  codeLength: z.number().int().min(1).max(10),
  expiryMinutes: z.number().int().min(1).max(60),
  maxAttempts: z.number().int().min(1).max(20),
});

export async function GET(request: NextRequest) {
  const authorization = await requireAdminPermission(
    request,
    AUTHZ_PERMISSIONS.ADMIN_CONFIG_READ,
  );
  if (!authorization.ok) return authorization.response;

  try {
    if (!isDbAvailable() || !db || !hasModel('systemConfig')) {
      return NextResponse.json(DEFAULTS);
    }

    const config = await getSystemConfig<typeof DEFAULTS>('otp');
    if (!config) return NextResponse.json(DEFAULTS);

    return NextResponse.json({
      codeLength: config.codeLength ?? DEFAULTS.codeLength,
      expiryMinutes: config.expiryMinutes ?? DEFAULTS.expiryMinutes,
      maxAttempts: config.maxAttempts ?? DEFAULTS.maxAttempts,
    });
  } catch {
    return NextResponse.json(DEFAULTS);
  }
}

export async function POST(request: NextRequest) {
  const authorization = await requireAdminPermission(
    request,
    AUTHZ_PERMISSIONS.ADMIN_CONFIG_WRITE,
  );
  if (!authorization.ok) return authorization.response;

  try {
    const body = await request.json();
    const parsed = otpSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    if (!isDbAvailable() || !db || !hasModel('systemConfig')) {
      return NextResponse.json({ error: 'Database is not available.' }, { status: 500 });
    }

    await saveSystemConfig('otp', parsed.data);
    return NextResponse.json({ success: true, message: 'OTP config saved successfully.' });
  } catch (err) {
    console.error('[Admin] Failed to save OTP config:', err);
    return NextResponse.json({ error: 'Failed to save config.' }, { status: 500 });
  }
}