import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { db, hasModel, isDbAvailable } from '@/lib/db';
import { hashToken } from '@/lib/auth';
import { sendEmail } from '@/lib/email';
import { rateLimit } from '@/lib/rate-limit';
import { z } from 'zod/v4';

const resendSchema = z.object({
  email: z.email(),
});

const limiter = rateLimit({ windowMs: 60_000, maxRequests: 3, keyPrefix: 'resend-verify' });

export async function POST(request: NextRequest) {
  try {
    const rateResult = limiter(request);
    if (!rateResult.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(rateResult.retryAfterMs / 1000)) },
        }
      );
    }

    if (!isDbAvailable() || !db || !hasModel('user')) {
      return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });
    }

    const body = await request.json();
    const parsed = resendSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const email = parsed.data.email.toLowerCase().trim();

    const user = await db.user.findUnique({ where: { email } });
    if (!user) {
      // Don't reveal whether the email exists
      return NextResponse.json({ success: true, message: 'If the email exists, a verification link has been sent.' });
    }

    if (user.emailVerified) {
      return NextResponse.json({ success: true, message: 'Email is already verified.' });
    }

    // Generate new verification token
    const rawVerifyToken = randomBytes(32).toString('hex');
    const hashedVerifyToken = hashToken(rawVerifyToken);
    const verifyExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await db.user.update({
      where: { id: user.id },
      data: {
        emailVerifyToken: hashedVerifyToken,
        emailVerifyExpiry: verifyExpiry,
      },
    });

    // Send verification email (fire-and-forget)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '';
    sendEmail({
      to: email,
      subject: 'Verify your email address',
      html: `
        <h2>Verify your email</h2>
        <p>Hi ${user.name || 'there'},</p>
        <p>Please verify your email address by clicking the link below:</p>
        <p><a href="${appUrl}/verify-email?token=${rawVerifyToken}" style="display:inline-block;padding:10px 20px;background:#10b981;color:#fff;border-radius:6px;text-decoration:none;">Verify Email</a></p>
        <p>This link expires in 1 hour.</p>
      `.trim(),
      text: `Verify your email: ${appUrl}/verify-email?token=${rawVerifyToken}`,
    }).catch(() => {});

    return NextResponse.json({ success: true, message: 'If the email exists, a verification link has been sent.' });
  } catch {
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}
