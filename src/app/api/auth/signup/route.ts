import { NextRequest } from 'next/server';
import { randomBytes } from 'crypto';
import { db, hasModel, isDbAvailable } from '@/lib/db';
import { hashPassword, hashToken } from '@/lib/auth';
import { authJson } from '@/lib/auth-response';
import { sendEmail } from '@/lib/email';
import { rateLimit, rateLimitByKey } from '@/lib/rate-limit';
import { z } from 'zod/v4';

const signupSchema = z.object({
  email: z.email(),
  name: z.string().min(1).optional(),
  password: z.string().min(8),
});

const ipLimiter = rateLimit({ windowMs: 60_000, maxRequests: 3, keyPrefix: 'signup' });
const identityLimiter = rateLimitByKey({ windowMs: 15 * 60_000, maxRequests: 3, keyPrefix: 'signup' });

export async function POST(request: NextRequest) {
  try {
    const ipResult = ipLimiter(request);
    if (!ipResult.allowed) {
      return authJson(
        { error: 'Too many sign-up attempts. Please try again later.' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(ipResult.retryAfterMs / 1000)) },
        }
      );
    }

    const body = await request.json();
    const parsed = signupSchema.safeParse(body);
    if (!parsed.success) {
      return authJson(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const { email, password, name: schemaName } = parsed.data;
    const name = schemaName || body.fullName || '';
    const emailLower = email.toLowerCase().trim();

    const identityResult = identityLimiter(emailLower);
    if (!identityResult.allowed) {
      return authJson(
        { error: 'Too many sign-up attempts. Please try again later.' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(identityResult.retryAfterMs / 1000)) },
        }
      );
    }

    if (isDbAvailable() && db && hasModel('user')) {
      const existing = await db.user.findUnique({ where: { email: emailLower } });
      if (existing) {
        return authJson(
          { error: 'An account with this email already exists' },
          { status: 409 }
        );
      }

      const passwordHash = hashPassword(password);
      const rawVerifyToken = randomBytes(32).toString('hex');
      const hashedVerifyToken = hashToken(rawVerifyToken);
      const verifyExpiry = new Date(Date.now() + 60 * 60 * 1000);

      const user = await db.user.create({
        data: {
          email: emailLower,
          name: name.trim(),
          passwordHash,
          emailVerifyToken: hashedVerifyToken,
          emailVerifyExpiry: verifyExpiry,
        },
      });

      await db.userSettings.create({
        data: {
          userId: user.id,
        },
      });

      if (hasModel('tradingAccount')) {
        try {
          await db.tradingAccount.create({
            data: {
              userId: user.id,
              broker: 'demo',
              accountType: 'demo',
              label: 'Demo Account',
              balance: 100000,
              currency: 'USD',
              isActive: true,
              isDefault: true,
              isDemo: true,
            },
          });
        } catch (accErr) {
          console.warn('[signup] Failed to create demo trading account (non-critical):', accErr);
        }
      }

      const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '';
      sendEmail({
        to: emailLower,
        subject: 'Verify your email address',
        html: `
          <h2>Welcome to Fovi!</h2>
          <p>Hi ${name.trim() || 'there'},</p>
          <p>Please verify your email address by clicking the link below:</p>
          <p><a href="${appUrl}/verify-email?token=${rawVerifyToken}" style="display:inline-block;padding:10px 20px;background:#10b981;color:#fff;border-radius:6px;text-decoration:none;">Verify Email</a></p>
          <p>This link expires in 1 hour.</p>
          <p>If you didn't create an account, you can safely ignore this email.</p>
        `.trim(),
        text: `Welcome to Fovi! Please verify your email: ${appUrl}/verify-email?token=${rawVerifyToken}`,
      }).catch(() => {});

      return authJson({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          emailVerified: false,
        },
      });
    }

    return authJson(
      { error: 'User registration is temporarily unavailable.', code: 'SERVICE_UNAVAILABLE', remediationPhase: 'containment' },
      { status: 503 },
    );
  } catch {
    return authJson({ error: 'An unexpected error occurred' }, { status: 500 });
  }
}
