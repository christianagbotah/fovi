import { NextRequest, NextResponse } from 'next/server';
import { generateAccessToken } from '@/lib/auth';
import {
  clearRefreshCookie,
  isSameOriginMutation,
  readRefreshCookie,
  rotateAuthSession,
  setRefreshCookie,
} from '@/lib/auth-sessions';
import { rateLimit } from '@/lib/rate-limit';

const limiter = rateLimit({ windowMs: 60_000, maxRequests: 30, keyPrefix: 'auth-refresh' });

export async function POST(request: NextRequest) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: 'Cross-origin refresh is not allowed.' }, { status: 403 });
  }

  const rateResult = limiter(request);
  if (!rateResult.allowed) {
    return NextResponse.json(
      { error: 'Too many refresh attempts. Please try again later.' },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil(rateResult.retryAfterMs / 1000)) },
      },
    );
  }

  const refreshToken = readRefreshCookie(request);
  if (!refreshToken) {
    return NextResponse.json({ error: 'Refresh session is not available.' }, { status: 401 });
  }

  const rotation = await rotateAuthSession(refreshToken);

  if (rotation.status === 'unavailable') {
    return NextResponse.json({ error: 'Authentication session service unavailable.' }, { status: 503 });
  }

  if (rotation.status === 'inactive') {
    const response = NextResponse.json({ error: 'Account is deactivated.' }, { status: 403 });
    clearRefreshCookie(response);
    return response;
  }

  if (rotation.status === 'invalid' || rotation.status === 'reused') {
    const response = NextResponse.json({ error: 'Refresh session is invalid or expired.' }, { status: 401 });
    clearRefreshCookie(response);
    return response;
  }

  const isAdmin =
    !!process.env.ADMIN_EMAIL &&
    rotation.user.email.toLowerCase() === process.env.ADMIN_EMAIL.toLowerCase();
  const token = await generateAccessToken(
    rotation.user.id,
    rotation.user.email,
    rotation.user.name || undefined,
    isAdmin ? 'admin' : undefined,
  );

  const response = NextResponse.json({
    success: true,
    token,
    user: {
      id: rotation.user.id,
      email: rotation.user.email,
      name: rotation.user.name,
    },
  });
  setRefreshCookie(response, rotation);
  return response;
}
