import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { db, hasModel, isDbAvailable, safeDbQuery } from '@/lib/db';
import { invalidateSmtpCache } from '@/lib/email';
import { requireAdminPermission } from '@/lib/admin-authorization';
import { AUTHZ_PERMISSIONS } from '@/lib/rbac';

const saveSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  user: z.string().min(1),
  password: z.string().min(1),
  from: z.string().min(1),
});

function mask(val: string, n = 4): string {
  if (!val) return '';
  return val.length <= n ? '****' : val.slice(0, n) + '****';
}

export async function GET(request: NextRequest) {
  const authorization = await requireAdminPermission(
    request,
    AUTHZ_PERMISSIONS.ADMIN_CONFIG_READ,
  );
  if (!authorization.ok) return authorization.response;

  try {
    if (!isDbAvailable() || !db || !hasModel('systemConfig')) {
      return NextResponse.json({ configured: false });
    }

    const row = await safeDbQuery(() =>
      db!.systemConfig.findUnique({ where: { key: 'smtp' } })
    );

    if (!row) return NextResponse.json({ configured: false });

    const config = JSON.parse(row.config) as Record<string, unknown>;
    return NextResponse.json({
      configured: true,
      host: (config.host as string) || '',
      port: config.port || 587,
      user: (config.user as string) || '',
      password: mask((config.password as string) || ''),
      from: (config.from as string) || '',
    });
  } catch {
    return NextResponse.json({ configured: false });
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
    const parsed = saveSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    if (!isDbAvailable() || !db || !hasModel('systemConfig')) {
      return NextResponse.json({ error: 'Database is not available.' }, { status: 500 });
    }

    await db.systemConfig.upsert({
      where: { key: 'smtp' },
      create: { key: 'smtp', config: JSON.stringify(parsed.data) },
      update: { config: JSON.stringify(parsed.data) },
    });

    invalidateSmtpCache();
    return NextResponse.json({ success: true, message: 'SMTP config saved successfully.' });
  } catch (err) {
    console.error('[Admin] Failed to save SMTP config:', err);
    return NextResponse.json({ error: 'Failed to save config.' }, { status: 500 });
  }
}