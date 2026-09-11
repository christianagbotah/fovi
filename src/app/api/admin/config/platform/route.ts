import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { db, isDbAvailable, hasModel } from '@/lib/db';
import { getSystemConfig, saveSystemConfig } from '@/lib/system-config';
import { requireAdminPermission } from '@/lib/admin-authorization';
import { AUTHZ_PERMISSIONS } from '@/lib/rbac';

const DEFAULTS = {
  platformName: 'Fovi AI',
  supportEmail: 'support@fovi.ai',
  platformUrl: '',
};

const platformSchema = z.object({
  platformName: z.string().min(1).max(100),
  supportEmail: z.string().email().max(255),
  platformUrl: z.string().max(500),
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

    const config = await getSystemConfig<typeof DEFAULTS>('platform');
    if (!config) return NextResponse.json(DEFAULTS);

    return NextResponse.json({
      platformName: config.platformName ?? DEFAULTS.platformName,
      supportEmail: config.supportEmail ?? DEFAULTS.supportEmail,
      platformUrl: config.platformUrl ?? DEFAULTS.platformUrl,
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
    const parsed = platformSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    if (!isDbAvailable() || !db || !hasModel('systemConfig')) {
      return NextResponse.json({ error: 'Database is not available.' }, { status: 500 });
    }

    await saveSystemConfig('platform', parsed.data);
    return NextResponse.json({ success: true, message: 'Platform config saved successfully.' });
  } catch (err) {
    console.error('[Admin] Failed to save platform config:', err);
    return NextResponse.json({ error: 'Failed to save config.' }, { status: 500 });
  }
}