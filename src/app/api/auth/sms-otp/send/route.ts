import { NextRequest } from 'next/server';
import { z } from 'zod/v4';
import { verifyToken, extractBearerToken } from '@/lib/auth';
import { authJson } from '@/lib/auth-response';
import { recordSmsOtpIssuanceRequest } from '@/lib/auth-abuse';
import { otpPurposeSchema } from '@/lib/otp-purpose';
import { cleanupOtpRetention } from '@/lib/otp-retention';
import { rateLimit } from '@/lib/rate-limit';
import { generateSmsOtp } from '@/lib/sms-otp';

const sendSchema = z.object({
  phoneNumber: z.string().regex(/^\+\d{10,15}$/),
  purpose: otpPurposeSchema,
  userId: z.string().min(1).optional(),
});

const limiter = rateLimit({ windowMs: 60_000, maxRequests: 1, keyPrefix: 'sms-otp-send' });

export async function POST(request: NextRequest) {
  try {
    const rateResult = limiter(request);
    if (!rateResult.allowed) {
      return authJson({ error: 'Please wait before requesting another OTP.' }, {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil(rateResult.retryAfterMs / 1000)) },
      });
    }

    const parsed = sendSchema.safeParse(await request.json());
    if (!parsed.success) {
      return authJson({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { phoneNumber, purpose } = parsed.data;
    let userId: string | null = null;

    if (purpose !== 'signup') {
      const token = extractBearerToken(request);
      if (!token) return authJson({ error: 'Authentication required.' }, { status: 401 });

      const payload = await verifyToken(token);
      if (!payload || payload.type !== 'access') {
        return authJson({ error: 'Invalid or expired token.' }, { status: 401 });
      }
      userId = payload.sub;
    } else {
      userId = parsed.data.userId || null;
    }

    if (!userId) return authJson({ error: 'User identifier is required.' }, { status: 400 });

    const issuance = await recordSmsOtpIssuanceRequest(`${purpose}:${phoneNumber}`);
    if (!issuance.available) {
      return authJson({ error: 'OTP service temporarily unavailable.' }, { status: 503 });
    }
    if (issuance.locked) {
      return authJson({ error: 'Too many OTP requests. Please try again later.' }, {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil(issuance.retryAfterMs / 1000)) },
      });
    }

    const result = await generateSmsOtp(userId, phoneNumber, purpose);
    if (!result.success) {
      console.error('[SMS OTP Send] Failed:', result.error);
      return authJson({ error: 'Failed to send OTP. Please try again later.' }, { status: 500 });
    }

    await cleanupOtpRetention();
    return authJson({ success: true, message: 'OTP sent' });
  } catch {
    return authJson({ error: 'An unexpected error occurred' }, { status: 500 });
  }
}
