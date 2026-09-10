import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { getHubtelSmsConfig, saveHubtelSmsConfig, sendSms } from '@/lib/hubtel';
import { INTEGRATION_SECRET_REDACTION } from '@/lib/integration-secret';

const saveSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  senderName: z.string().min(1),
});

const testSchema = z.object({
  to: z.string().min(1),
});

// GET: return current SMS config without exposing credential fragments.
export async function GET() {
  try {
    const config = await getHubtelSmsConfig();
    if (!config) {
      return NextResponse.json({ configured: false });
    }

    const publicConfig = {
      clientId: config.clientId ? INTEGRATION_SECRET_REDACTION : '',
      clientSecret: config.clientSecret ? INTEGRATION_SECRET_REDACTION : '',
      senderName: config.senderName,
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

// POST: save SMS config
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Check if this is a test request
    if (body._action === 'test') {
      const parsed = testSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
      }

      const result = await sendSms(parsed.data.to, 'This is a test SMS from Fovi AI. Your SMS integration is working!');
      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 500 });
      }

      return NextResponse.json({ success: true, message: 'Test SMS sent successfully.' });
    }

    // Otherwise, save the config
    const parsed = saveSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    let configToSave = parsed.data;
    if (
      parsed.data.clientId === INTEGRATION_SECRET_REDACTION
      || parsed.data.clientSecret === INTEGRATION_SECRET_REDACTION
    ) {
      const current = await getHubtelSmsConfig();
      if (!current) {
        return NextResponse.json({ error: 'Stored Hubtel SMS credentials cannot be opened.' }, { status: 503 });
      }

      configToSave = {
        ...parsed.data,
        clientId: parsed.data.clientId === INTEGRATION_SECRET_REDACTION
          ? current.clientId
          : parsed.data.clientId,
        clientSecret: parsed.data.clientSecret === INTEGRATION_SECRET_REDACTION
          ? current.clientSecret
          : parsed.data.clientSecret,
      };
    }

    await saveHubtelSmsConfig(configToSave);

    return NextResponse.json({ success: true, message: 'Hubtel SMS config saved successfully.' });
  } catch (err) {
    console.error('[Admin] Failed to save Hubtel SMS config:', err);
    const unavailable = err instanceof Error && err.message.includes('credential protection is unavailable');
    return NextResponse.json(
      { error: unavailable ? 'Credential protection is unavailable.' : 'Failed to save config.' },
      { status: unavailable ? 503 : 500 },
    );
  }
}
