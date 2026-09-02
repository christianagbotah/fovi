import { NextRequest } from 'next/server';
import { randomBytes } from 'crypto';
import { db, hasModel, isDbAvailable } from '@/lib/db';
import { hashToken } from '@/lib/auth';
import { authJson } from '@/lib/auth-response';
import { sendEmail } from '@/lib/email';
import { rateLimit, rateLimitByKey } from '@/lib/rate-limit';
import { z } from 'zod/v4';

const resendSchema = z.object({
  email: z.email(),
});

const ipLimiter = rateLimit({ windowMs: 60_000, maxRequests: 3, keyPrefix: 'resend-verify' });
const identityLimiter = rateLimitByKey({ windowMs: 15 * 60_000, maxRequests: 3, keyPrefix: 'resend-verify' });

const genericSuccess = {
  success: true,
  message: 'If the email exists and still needs verification, a verification link has been sent.',
};

export async function POST(request: NextRequest) {
  try {
    const ipResult = ipLimiter(request);
    if (!ipResult.allowed) {
      return authJson(
        { error: 'Too many requests. Please try again later.' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(ipResult.retryAfterMs / 1000)) },
        }
      );
    }

    const body = await request.json();
    const parsed = resendSchema.safeParse(body);
    if (!parsed.success) {
      return authJson(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const email = parsed.data.email.toLowerCase().trim();
    const identityResult = identityLimiter(email);
    if (!identityResult.allowed) {
      return authJson(
        { error: 'Too many requests. Please try again later.' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(identityResult.retryAfterMs / 1000)) },
        }
      );
    }

    if (!isDbAvailable() || !db || !hasModel('user')) {
      return authJson({ error: 'Database unavailable' }, { status: 503 });
    }

    const user = await db.user.findUnique({ where: { email } });
    if (!user || user.emailVerified) {
      return authJson(genericSuccess);
    }

    const rawVerifyToken = randomBytes(32).toString('hex');
    const hashedVerifyToken = hashToken(rawVerifyToken);
    const verifyExpiry = new Date(Date.now() + 60 * 60 * 1000);

    await db.user.update({
      where: { id: user.id },
      data: {
        emailVerifyToken: hashedVerifyToken,
        emailVerifyExpiry: verifyExpiry,
      },
    });

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

    return authJson(genericSuccess);
  } catch {
    return authJson({ error: 'An unexpected error occurred' }, { status: 500 });
  }
}
