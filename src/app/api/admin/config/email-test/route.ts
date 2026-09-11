import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { sendEmail, isEmailConfigured } from '@/lib/email';
import { requireAdminPermission } from '@/lib/admin-authorization';
import { AUTHZ_PERMISSIONS } from '@/lib/rbac';

const testSchema = z.object({
  to: z.email(),
});

export async function POST(request: NextRequest) {
  const authorization = await requireAdminPermission(
    request,
    AUTHZ_PERMISSIONS.ADMIN_CONFIG_WRITE,
  );
  if (!authorization.ok) return authorization.response;

  try {
    const body = await request.json();
    const parsed = testSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    if (!(await isEmailConfigured())) {
      return NextResponse.json(
        { error: 'SMTP is not configured. Please set up SMTP settings first.' },
        { status: 400 }
      );
    }

    const result = await sendEmail({
      to: parsed.data.to,
      subject: 'Fovi AI — Test Email',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #111;">Test Email from Fovi AI</h2>
          <p style="color: #555; font-size: 16px;">If you are seeing this, your SMTP integration is working correctly!</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
          <p style="color: #aaa; font-size: 12px;">This is an automated test email from Fovi AI.</p>
        </div>
      `,
      text: 'Test email from Fovi AI. Your SMTP integration is working!',
    });

    if (result.success) {
      return NextResponse.json({ success: true, message: 'Test email sent successfully.' });
    }

    return NextResponse.json({ error: 'Failed to send test email.' }, { status: 500 });
  } catch (err) {
    console.error('[Admin] Email test failed:', err);
    return NextResponse.json({ error: 'Failed to send test email.' }, { status: 500 });
  }
}