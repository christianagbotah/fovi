import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { verifyToken, extractBearerToken } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { verifyEmailOtp } from '@/lib/sms-otp';

const verifySchema = z.object({
  code: z.string().regex(/^\d{6}$/),
  email: z.email(),
  purpose: z.string().min(1).max(64).optional().default('login'),
  userId: z.string().min(1).optional(),
});

// 10 requests per minute per IP
const limiter = rateLimit({ windowMs: 60_000, maxRequests: 10, keyPrefix: 'email-otp-verify' });

export async function POST(request: NextRequest) {
  try {
    const rateResult = limiter(request);
    if (!rateResult.allowed) {
      return NextResponse.json(
        { error: 'Too many verification attempts. Please try again later.' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(rateResult.retryAfterMs / 1000)) },
        }
      );
    }

    const body = await request.json();
    const parsed = verifySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const { code, email, purpose } = parsed.data;
    let userId: string | null = null;

    if (purpose !== 'signup') {
      const token = extractBearerToken(request);
      if (!token) {
        return NextResponse.json(
          { error: 'Authentication required.' },
          { status: 401 }
        );
      }

      const payload = await verifyToken(token);
      if (!payload || payload.type !== 'access') {
        return NextResponse.json(
          { error: 'Invalid or expired token.' },
          { status: 401 }
        );
      }

      userId = payload.sub;
    } else {
      userId = parsed.data.userId || null;
    }

    const result = await verifyEmailOtp(email, code, purpose, userId);

    if (!result.success) {
      return NextResponse.json(
        { error: 'Verification failed. Please try again.' },
        { status: 500 }
      );
    }

    if (!result.verified) {
      return NextResponse.json(
        { success: true, verified: false, error: 'Invalid or expired OTP code.' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      verified: true,
    });
  } catch {
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}
