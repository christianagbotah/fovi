import { NextRequest } from 'next/server';
import { z } from 'zod/v4';
import { verifyToken, extractBearerToken } from '@/lib/auth';
import {
  clearSmsOtpVerificationFailures,
  getSmsOtpVerificationAbuseStatus,
  recordSmsOtpVerificationFailure,
  type AuthAbuseStatus,
} from '@/lib/auth-abuse';
import { authJson } from '@/lib/auth-response';
import { otpPurposeSchema } from '@/lib/otp-purpose';
import { rateLimit } from '@/lib/rate-limit';
import { verifySmsOtp } from '@/lib/sms-otp';

const verifySchema = z.object({
  code: z.string().regex(/^\d{6}$/),
  phoneNumber: z.string().regex(/^\+\d{10,15}$/),
  purpose: otpPurposeSchema,
  userId: z.string().min(1).optional(),
});

const limiter = rateLimit({ windowMs: 60_000, maxRequests: 10, keyPrefix: 'sms-otp-verify' });

function otpVerificationAbuseBlockedResponse(status: AuthAbuseStatus) {
  const retryAfterMs = status.locked ? status.retryAfterMs : 60_000;
  return authJson(
    { error: status.available ? 'Too many verification attempts. Please try again later.' : 'OTP verification service unavailable.' },
    {
      status: status.available ? 429 : 503,
      headers: { 'Retry-After': String(Math.max(1, Math.ceil(retryAfterMs / 1000))) },
    },
  );
}

export async function POST(request: NextRequest) {
  try {
    const rateResult = limiter(request);
    if (!rateResult.allowed) {
      return authJson({ error: 'Too many verification attempts. Please try again later.' }, {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil(rateResult.retryAfterMs / 1000)) },
      });
    }

    const parsed = verifySchema.safeParse(await request.json());
    if (!parsed.success) return authJson({ error: parsed.error.issues[0].message }, { status: 400 });

    const { code, phoneNumber, purpose } = parsed.data;
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

    const abuseIdentifier = `${purpose}:${phoneNumber}`;
    const abuseStatus = await getSmsOtpVerificationAbuseStatus(abuseIdentifier);
    if (!abuseStatus.available || abuseStatus.locked) {
      return otpVerificationAbuseBlockedResponse(abuseStatus);
    }

    const result = await verifySmsOtp(userId, phoneNumber, code, purpose);
    if (!result.success) return authJson({ error: 'Verification failed. Please try again.' }, { status: 500 });
    if (!result.verified) {
      const failed = await recordSmsOtpVerificationFailure(abuseIdentifier);
      if (!failed.available || failed.locked) return otpVerificationAbuseBlockedResponse(failed);
      return authJson({ success: true, verified: false, error: 'Invalid or expired OTP code.' }, { status: 400 });
    }

    if (!(await clearSmsOtpVerificationFailures(abuseIdentifier))) {
      return authJson({ error: 'OTP verification service unavailable.' }, { status: 503 });
    }

    return authJson({ success: true, verified: true });
  } catch {
    return authJson({ error: 'An unexpected error occurred' }, { status: 500 });
  }
}
