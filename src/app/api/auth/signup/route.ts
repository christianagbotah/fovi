import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { db, hasModel, isDbAvailable } from '@/lib/db';
import { hashPassword, hashToken } from '@/lib/auth';
import { sendEmail } from '@/lib/email';
import { rateLimit } from '@/lib/rate-limit';
import { z } from 'zod/v4';

const signupSchema = z.object({
  email: z.email(),
  name: z.string().min(1).optional(),
  password: z.string().min(8),
});

const limiter = rateLimit({ windowMs: 60_000, maxRequests: 3, keyPrefix: 'signup' });

export async function POST(request: NextRequest) {
  try {
    // Rate limit check
    const rateResult = limiter(request);
    if (!rateResult.allowed) {
      return NextResponse.json(
        { error: 'Too many sign-up attempts. Please try again later.' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(rateResult.retryAfterMs / 1000)) },
        }
      );
    }

    // Zod validation
    const body = await request.json();
    const parsed = signupSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const { email, password, name: schemaName } = parsed.data;
    const name = schemaName || body.fullName || '';

    const emailLower = email.toLowerCase().trim();

    if (isDbAvailable() && db && hasModel('user')) {
      // Check if user already exists
      const existing = await db.user.findUnique({ where: { email: emailLower } });
      if (existing) {
        return NextResponse.json(
          { error: 'An account with this email already exists' },
          { status: 409 }
        );
      }

      const passwordHash = hashPassword(password);

      // Generate email verification token (1 hour expiry)
      const rawVerifyToken = randomBytes(32).toString('hex');
      const hashedVerifyToken = hashToken(rawVerifyToken);
      const verifyExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      const user = await db.user.create({
        data: {
          email: emailLower,
          name: name.trim(),
          passwordHash,
          emailVerifyToken: hashedVerifyToken,
          emailVerifyExpiry: verifyExpiry,
        },
      });

      // Create default settings
      await db.userSettings.create({
        data: {
          userId: user.id,
        },
      });

      // Auto-create demo trading account (5.5)
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

      // Send verification email (fire-and-forget)
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

      return NextResponse.json({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          emailVerified: false,
        },
      });
    }

    // When database or required models are unavailable, return truthful 503
    return NextResponse.json(
      { error: 'User registration is temporarily unavailable.', code: 'SERVICE_UNAVAILABLE', remediationPhase: 'containment' },
      { status: 503 },
    );
  } catch {
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}
