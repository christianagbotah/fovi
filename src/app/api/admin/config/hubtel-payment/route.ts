import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { getHubtelPaymentConfig, saveHubtelPaymentConfig } from '@/lib/hubtel';
import { INTEGRATION_SECRET_REDACTION } from '@/lib/integration-secret';

const saveSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  accountNumber: z.string().min(1),
  callbackUrl: z.string().min(1),
});

// GET: return current payment config without exposing credential fragments.
export async function GET() {
  try {
    const config = await getHubtelPaymentConfig();
    if (!config) {
      return NextResponse.json({ configured: false });
    }

    const publicConfig = {
      clientId: config.clientId ? INTEGRATION_SECRET_REDACTION : '',
      clientSecret: config.clientSecret ? INTEGRATION_SECRET_REDACTION : '',
      accountNumber: config.accountNumber ? INTEGRATION_SECRET_REDACTION : '',
      callbackUrl: config.callbackUrl,
    };

    // `config` matches the current admin UI contract; retain top-level fields
    // for compatibility with older callers while keeping secrets fully redacted.
    return NextResponse.json({
      configured: true,
      config: publicConfig,
      ...publicConfig,
    });
  } catch {
    return NextResponse.json({ configured: false });
  }
}

// POST: save payment config
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = saveSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    let configToSave = parsed.data;
    if (
      parsed.data.clientId === INTEGRATION_SECRET_REDACTION
      || parsed.data.clientSecret === INTEGRATION_SECRET_REDACTION
      || parsed.data.accountNumber === INTEGRATION_SECRET_REDACTION
    ) {
      const current = await getHubtelPaymentConfig();
      if (!current) {
        return NextResponse.json({ error: 'Stored Hubtel payment credentials cannot be opened.' }, { status: 503 });
      }

      configToSave = {
        ...parsed.data,
        clientId: parsed.data.clientId === INTEGRATION_SECRET_REDACTION
          ? current.clientId
          : parsed.data.clientId,
        clientSecret: parsed.data.clientSecret === INTEGRATION_SECRET_REDACTION
          ? current.clientSecret
          : parsed.data.clientSecret,
        accountNumber: parsed.data.accountNumber === INTEGRATION_SECRET_REDACTION
          ? current.accountNumber
          : parsed.data.accountNumber,
      };
    }

    await saveHubtelPaymentConfig(configToSave);

    return NextResponse.json({ success: true, message: 'Hubtel Payment config saved successfully.' });
  } catch (err) {
    console.error('[Admin] Failed to save Hubtel Payment config:', err);
    const unavailable = err instanceof Error && err.message.includes('credential protection is unavailable');
    return NextResponse.json(
      { error: unavailable ? 'Credential protection is unavailable.' : 'Failed to save config.' },
      { status: unavailable ? 503 : 500 },
    );
  }
}
