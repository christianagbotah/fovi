import { NextRequest } from 'next/server';
import { db, hasModel, isDbAvailable } from '@/lib/db';
import { hashToken } from '@/lib/auth';
import { authJson } from '@/lib/auth-response';
import { rateLimit } from '@/lib/rate-limit';
import { z } from 'zod/v4';

const verifySchema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/i),
});

const limiter = rateLimit({ windowMs: 60_000, maxRequests: 10, keyPrefix: 'verify-email' });

export async function POST(request: NextRequest) {
  try {
    const rateResult = limiter(request);
    if (!rateResult.allowed) {
      return authJson(
        { error: 'Too many requests. Please try again later.' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(rateResult.retryAfterMs / 1000)) },
        }
      );
    }

    if (!isDbAvailable() || !db || !hasModel('user')) {
      return authJson({ error: 'Verification service unavailable' }, { status: 503 });
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
    const now = new Date();
    const updated = await db.user.updateMany({
      where: {
        emailVerifyToken: hashedToken,
        emailVerified: false,
        emailVerifyExpiry: { gt: now },
      },
      data: {
        emailVerified: true,
        emailVerifyToken: null,
        emailVerifyExpiry: null,
      },
    });

    if (updated.count !== 1) {
      return authJson(
        { error: 'Invalid or expired verification token' },
        { status: 400 }
      );
    }

    return authJson({ success: true, message: 'Email verified successfully' });
  } catch {
    return authJson(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}
