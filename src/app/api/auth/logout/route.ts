import { NextRequest, NextResponse } from 'next/server';
import {
  clearRefreshCookie,
  isSameOriginMutation,
  readRefreshCookie,
  revokeAuthSessionFamily,
} from '@/lib/auth-sessions';
import { rateLimit } from '@/lib/rate-limit';

const limiter = rateLimit({ windowMs: 60_000, maxRequests: 30, keyPrefix: 'auth-logout' });

export async function POST(request: NextRequest) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: 'Cross-origin logout is not allowed.' }, { status: 403 });
  }

  const rateResult = limiter(request);
  if (!rateResult.allowed) {
    return NextResponse.json(
      { error: 'Too many logout attempts. Please try again later.' },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil(rateResult.retryAfterMs / 1000)) },
      },
    );
  }

  const refreshToken = readRefreshCookie(request);
  if (refreshToken) {
    await revokeAuthSessionFamily(refreshToken, 'LOGOUT');
  }

  const response = NextResponse.json({ success: true });
  clearRefreshCookie(response);
  return response;
}
