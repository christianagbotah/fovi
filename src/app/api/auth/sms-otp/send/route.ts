import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { verifyToken, extractBearerToken } from '@/lib/auth';
import { db, hasModel, isDbAvailable, safeDbQuery } from '@/lib/db';
import { rateLimit } from '@/lib/rate-limit';
import { generateSmsOtp } from '@/lib/sms-otp';

const sendSchema = z.object({
  phoneNumber: z.string().min(1),
  purpose: z.string().optional().default('login'),
});

// 1 request per 60 seconds per IP
const limiter = rateLimit({ windowMs: 60_000, maxRequests: 1, keyPrefix: 'sms-otp-send' });

export async function POST(request: NextRequest) {
  try {
    // Rate limit check
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

    // Parse and validate body
    const body = await request.json();
    const parsed = sendSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const { phoneNumber, purpose } = parsed.data;

    // Validate phone format: must start with + and be 10-15 digits after the +
    const phoneRegex = /^\+\d{10,15}$/;
    if (!phoneRegex.test(phoneNumber)) {
      return NextResponse.json(
        { error: 'Invalid phone number format. Must start with + followed by 10-15 digits.' },
        { status: 400 }
      );
    }

    // Auth is required unless purpose is 'signup'
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
      // For signup, we need a userId — use a temporary one from body or generate
      // The caller should provide a userId for signup OTPs
      userId = body.userId || null;
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'User identifier is required.' },
        { status: 400 }
      );
    }

    // Generate and send the OTP
    const result = await generateSmsOtp(userId, phoneNumber, purpose);

    if (!result.success) {
      // Log the error internally but return a generic message to avoid leaking info
      console.error('[SMS OTP Send] Failed:', result.error);
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
