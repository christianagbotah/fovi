import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, extractBearerToken } from '@/lib/auth';

/**
 * Routes that are always public (no JWT required, no header injection).
 */
const PUBLIC_PATHS = [
  '/api/auth/signin',
  '/api/auth/signup',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/auth/two-factor/authenticate',
  '/api/auth/sms-otp/send',
  '/api/auth/sms-otp/verify',
  '/api/auth/email-otp/send',
  '/api/auth/email-otp/verify',
  '/api/payments/hubtel/callback',
  '/api/trading/market/symbols',
  '/api/trading/leaderboard',
  '/api/trading/webhooks',
];

/**
 * Routes that support optional auth — work without a token (demo mode)
 * but if a valid JWT is present, we inject X-User-Id for the route handler.
 */
const OPTIONAL_AUTH_PREFIXES = [
  '/api/trading/',
];

/**
 * Routes that MUST have a valid JWT.
 */
const PROTECTED_PREFIXES = [
  '/api/auth/change-password',
  '/api/auth/two-factor/setup',
  '/api/auth/two-factor/verify',
  '/api/auth/two-factor/disable',
  '/api/auth/me',
  '/api/subscriptions/',
];

/**
 * Admin-only path prefixes.
 */
const ADMIN_PREFIXES = [
  '/api/admin/',
];

function matchesAny(pathname: string, prefixes: string[]): boolean {
  return prefixes.some(p => pathname.startsWith(p));
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only intercept /api/* routes
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // Allow fully public routes through
  if (matchesAny(pathname, PUBLIC_PATHS)) {
    return NextResponse.next();
  }

  // Try to extract and verify token
  const token = extractBearerToken(request);
  let payload: Awaited<ReturnType<typeof verifyToken>> = null;

  if (token) {
    payload = await verifyToken(token);
  }

  // If token is present but invalid, and this is a protected route, reject
  const isProtected = matchesAny(pathname, PROTECTED_PREFIXES);
  const isAdmin = matchesAny(pathname, ADMIN_PREFIXES);

  if (isProtected && !payload) {
    return NextResponse.json(
      { error: 'Authentication required. Please sign in.' },
      { status: 401 }
    );
  }

  if (isProtected && payload && payload.type !== 'access') {
    return NextResponse.json(
      { error: 'Invalid or expired token. Please sign in again.' },
      { status: 401 }
    );
  }

  // Admin access check
  if (isAdmin && payload && payload.role !== 'admin') {
    return NextResponse.json(
      { error: 'Admin access required.' },
      { status: 403 }
    );
  }

  // If we have a valid payload, inject user info headers for downstream routes
  if (payload && payload.type === 'access') {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('X-User-Id', payload.sub);
    requestHeaders.set('X-User-Email', payload.email || '');
    if (payload.role) {
      requestHeaders.set('X-User-Role', payload.role);
    }
    if (payload.name) {
      requestHeaders.set('X-User-Name', payload.name);
    }

    return NextResponse.next({
      request: { headers: requestHeaders },
    });
  }

  // No valid token — allow through for optional-auth routes (demo mode)
  return NextResponse.next();
}
