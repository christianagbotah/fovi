import { NextRequest } from 'next/server';
import { db, hasModel, isDbAvailable } from '@/lib/db';
import { hashToken } from '@/lib/auth';
import { authJson } from '@/lib/auth-response';
import { rateLimit, rateLimitByKey } from '@/lib/rate-limit';
import { z } from 'zod/v4';

const verifySchema = z.object({
  token: z.string().min(1),
});

const ipLimiter = rateLimit({ windowMs: 60_000, maxRequests: 10, keyPrefix: 'verify-email' });
const tokenLimiter = rateLimitByKey({ windowMs: 5 * 60_000, maxRequests: 10, keyPrefix: 'verify-email' });

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
    const parsed = verifySchema.safeParse(body);
    if (!parsed.success) {
      return authJson(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const hashedToken = hashToken(parsed.data.token);
    const tokenResult = tokenLimiter(hashedToken);
    if (!tokenResult.allowed) {
      return authJson(
        { error: 'Too many requests. Please try again later.' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(tokenResult.retryAfterMs / 1000)) },
        }
      );
    }

    if (!isDbAvailable() || !db || !hasModel('user')) {
      return authJson({ error: 'Database unavailable' }, { status: 503 });
    }

    const user = await db.user.findFirst({
      where: { emailVerifyToken: hashedToken },
    });

    if (!user) {
      return authJson(
        { error: 'Invalid or expired verification token' },
        { status: 400 }
      );
    }

    if (user.emailVerified) {
      return authJson({ success: true, message: 'Email already verified' });
    }

    if (user.emailVerifyExpiry && user.emailVerifyExpiry < new Date()) {
      return authJson(
        { error: 'Verification token has expired. Please request a new one.' },
        { status: 400 }
      );
    }

    await db.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        emailVerifyToken: null,
        emailVerifyExpiry: null,
      },
    });

    return authJson({ success: true, message: 'Email verified successfully' });
  } catch {
    return authJson({ error: 'An unexpected error occurred' }, { status: 500 });
  }
}
