import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { verifyToken, extractBearerToken } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { verifySmsOtp } from '@/lib/sms-otp';

const verifySchema = z.object({
  code: z.string().length(6),
  phoneNumber: z.string().min(1),
  purpose: z.string().optional().default('login'),
});

// 10 requests per minute per IP
const limiter = rateLimit({ windowMs: 60_000, maxRequests: 10, keyPrefix: 'sms-otp-verify' });

export async function POST(request: NextRequest) {
  try {
    // Rate limit check
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

    // Parse and validate body
    const body = await request.json();
    const parsed = verifySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const { code, purpose } = parsed.data;

    // Auth required — need to identify the user
    // For signup, allow a userId in the body
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
      userId = body.userId || null;
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'User identifier is required.' },
        { status: 400 }
      );
    }

    const result = await verifySmsOtp(userId, code, purpose);

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
