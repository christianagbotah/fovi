import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { getHubtelPaymentConfig, saveHubtelPaymentConfig } from '@/lib/hubtel';
import { requireAdminPermission } from '@/lib/admin-authorization';
import { AUTHZ_PERMISSIONS } from '@/lib/rbac';

const saveSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  accountNumber: z.string().min(1),
  callbackUrl: z.string().min(1),
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
    const config = await getHubtelPaymentConfig();
    if (!config) return NextResponse.json({ configured: false });

    return NextResponse.json({
      configured: true,
      clientId: mask(config.clientId),
      clientSecret: mask(config.clientSecret),
      accountNumber: mask(config.accountNumber, 6),
      callbackUrl: config.callbackUrl,
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

    await saveHubtelPaymentConfig(parsed.data);
    return NextResponse.json({ success: true, message: 'Hubtel Payment config saved successfully.' });
  } catch (err) {
    console.error('[Admin] Failed to save Hubtel Payment config:', err);
    return NextResponse.json({ error: 'Failed to save config.' }, { status: 500 });
  }
}