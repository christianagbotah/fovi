import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { verifyToken, extractBearerToken } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { generateEmailOtp } from '@/lib/sms-otp';

const sendSchema = z.object({
  email: z.email(),
  purpose: z.string().min(1).max(64).optional().default('login'),
  userId: z.string().min(1).optional(),
});

// 1 request per 60 seconds per IP
const limiter = rateLimit({ windowMs: 60_000, maxRequests: 1, keyPrefix: 'email-otp-send' });

export async function POST(request: NextRequest) {
  try {
    const rateResult = limiter(request);
    if (!rateResult.allowed) {
      return NextResponse.json(
        { error: 'Please wait before requesting another OTP.' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(rateResult.retryAfterMs / 1000)) },
        }
      );
    }

    const body = await request.json();
    const parsed = sendSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const { email, purpose } = parsed.data;
    let userId: string | undefined;

    // Authenticated OTPs must be bound to the access-token subject. Signup is
    // the only anonymous flow and may optionally bind to an already-created id.
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
      userId = parsed.data.userId;
    }

    const result = await generateEmailOtp(email, userId, purpose);

    if (!result.success) {
      console.error('[Email OTP Send] Failed:', result.error);
      return NextResponse.json(
        { error: 'Failed to send OTP. Please try again later.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'OTP sent',
    });
  } catch {
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}
