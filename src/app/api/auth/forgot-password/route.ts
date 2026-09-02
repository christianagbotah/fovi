import { NextRequest } from 'next/server';
import { db, hasModel, isDbAvailable, safeDbQuery } from '@/lib/db';
import { generateResetToken, hashToken } from '@/lib/auth';
import { authJson } from '@/lib/auth-response';
import { sendEmail } from '@/lib/email';
import { rateLimit, rateLimitByKey } from '@/lib/rate-limit';
import { z } from 'zod/v4';

const forgotPasswordSchema = z.object({
  email: z.email(),
});

const ipLimiter = rateLimit({ windowMs: 60_000, maxRequests: 3, keyPrefix: 'forgot-pw' });
const identityLimiter = rateLimitByKey({ windowMs: 15 * 60_000, maxRequests: 3, keyPrefix: 'forgot-pw' });

const genericSuccess = {
  success: true,
  message: 'If an account with this email exists, a reset link has been sent.',
};

export async function POST(request: NextRequest) {
  try {
    const ipResult = ipLimiter(request);
    if (!ipResult.allowed) {
      return authJson(
        { error: 'Too many password reset attempts. Please try again later.' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(ipResult.retryAfterMs / 1000)) },
        }
      );
    }

    const body = await request.json();
    const parsed = forgotPasswordSchema.safeParse(body);
    if (!parsed.success) {
      return authJson(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const emailLower = parsed.data.email.toLowerCase().trim();
    const identityResult = identityLimiter(emailLower);
    if (!identityResult.allowed) {
      return authJson(
        { error: 'Too many password reset attempts. Please try again later.' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(identityResult.retryAfterMs / 1000)) },
        }
      );
    }

    if (isDbAvailable() && db && hasModel('user')) {
      const user = await safeDbQuery(() =>
        db!.user.findUnique({ where: { email: emailLower } })
      );

      if (user) {
        const resetToken = generateResetToken();
        const hashedToken = hashToken(resetToken);
        const expiry = new Date(Date.now() + 60 * 60 * 1000);

        await safeDbQuery(() =>
          db!.user.update({
            where: { id: user.id },
            data: {
              resetToken: hashedToken,
              resetTokenExpiry: expiry,
            },
          })
        );

        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3002';
        const resetLink = `${baseUrl}/auth/reset-password?token=${resetToken}`;

        await sendEmail({
          to: user.email,
          subject: 'Fovi AI — Password Reset',
          html: `
            <h2>Password Reset Request</h2>
            <p>Hi ${user.name || 'there'},</p>
            <p>We received a request to reset your password. Click the link below to proceed:</p>
            <p><a href="${resetLink}" style="display:inline-block;padding:10px 20px;background:#10b981;color:#fff;text-decoration:none;border-radius:6px;">Reset Password</a></p>
            <p>This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
            <p>— Fovi AI Team</p>
          `,
          text: `Reset your password here: ${resetLink}\n\nThis link expires in 1 hour. If you didn't request this, you can safely ignore this email.\n— Fovi AI Team`,
        });
      }
    }

    return authJson(genericSuccess);
  } catch {
    return authJson(genericSuccess);
  }
}
