import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, extractBearerToken } from '@/lib/auth';
import { CONTAINMENT_CODES } from '@/lib/trading-policy';

/**
 * Routes that are always public (no JWT required).
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
  '/api/auth/verify-email',
  '/api/auth/resend-verification',
  '/api/payments/hubtel/callback',
  '/api/trading/market/symbols',
  '/api/trading/leaderboard',
  '/api/health',
  '/api/subscriptions/plans',
];

/**
 * Trading routes that require authentication for write operations.
 * Read-only trading routes are optional-auth (demo mode allowed).
 * Write operations: POST, PUT, PATCH, DELETE on these prefixes.
 */
const TRADING_WRITE_PREFIXES = [
  '/api/trading/orders',
  '/api/trading/positions',
  '/api/trading/accounts',
  '/api/trading/bots',
  '/api/trading/webhook',
  '/api/trading/webhooks',
  '/api/trading/auto-trade',
  '/api/trading/journal',
  '/api/trading/signals',
];

/**
 * Engine routes require internal service auth (not browser JWT).
 */
const ENGINE_PREFIXES = [
  '/api/trading/bots/engine/',
];

/**
 * Routes that MUST have a valid browser JWT.
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

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function matchesAny(pathname: string, prefixes: string[]): boolean {
  return prefixes.some(p => pathname.startsWith(p));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only intercept /api/* routes
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // Allow fully public routes through (no auth needed)
  if (matchesAny(pathname, PUBLIC_PATHS)) {
    return NextResponse.next();
  }

  // ── Engine routes: require internal service secret ──
  if (matchesAny(pathname, ENGINE_PREFIXES)) {
    const internalSecret = request.headers.get('x-internal-service-secret') || '';
    const expected = process.env.INTERNAL_SERVICE_SECRET || '';
    if (!expected) {
      // No secret configured → fail closed
      return NextResponse.json(
        { error: 'Internal service not configured.', code: CONTAINMENT_CODES.INTERNAL_AUTH_REQUIRED, remediationPhase: 'containment' },
        { status: 503 },
      );
    }
    // Simple direct comparison for middleware (not a password-comparison endpoint).
    // The timing-safe version requires async and is used in trading-policy.enforceInternalAuth.
    if (internalSecret !== expected) {
      return NextResponse.json(
        { error: 'Unauthorized.', code: CONTAINMENT_CODES.INTERNAL_AUTH_INVALID, remediationPhase: 'containment' },
        { status: 401 },
      );
    }
    // Valid internal service — pass through with trusted marker
    const headers = new Headers(request.headers);
    headers.set('X-Internal-Service', 'true');
    return NextResponse.next({ request: { headers } });
  }

  // ── Try to extract and verify JWT ──
  const token = extractBearerToken(request);
  let payload: Awaited<ReturnType<typeof verifyToken>> = null;

  if (token) {
    payload = await verifyToken(token);
  }

  // ── Protected routes: require valid JWT ──
  const isProtected = matchesAny(pathname, PROTECTED_PREFIXES);
  if (isProtected && (!payload || payload.type !== 'access')) {
    return NextResponse.json(
      { error: 'Authentication required.', code: CONTAINMENT_CODES.AUTH_REQUIRED, remediationPhase: 'containment' },
      { status: 401 },
    );
  }

  // ── Admin routes: require valid admin JWT ──
  if (matchesAny(pathname, ADMIN_PREFIXES)) {
    if (!payload || payload.type !== 'access' || payload.role !== 'admin') {
      return NextResponse.json(
        { error: payload ? 'Admin access required.' : 'Authentication required.', code: payload ? 'FORBIDDEN' : CONTAINMENT_CODES.AUTH_REQUIRED, remediationPhase: 'containment' },
        { status: payload ? 403 : 401 },
      );
    }
  }

  // ── Trading write routes: require JWT or internal service ──
  const isTradingWrite =
    matchesAny(pathname, TRADING_WRITE_PREFIXES) &&
    WRITE_METHODS.has(request.method);

  const isInternalService = request.headers.get('x-internal-service') === 'true';

  if (isTradingWrite && !payload && !isInternalService) {
    return NextResponse.json(
      { error: 'Authentication required for this operation.', code: CONTAINMENT_CODES.AUTH_REQUIRED, remediationPhase: 'containment' },
      { status: 401 },
    );
  }

  // ── If valid JWT, inject verified user headers ──
  if (payload && payload.type === 'access') {
    const headers = new Headers(request.headers);
    headers.set('X-User-Id', payload.sub);
    headers.set('X-User-Email', payload.email || '');
    if (payload.role) headers.set('X-User-Role', payload.role);
    if (payload.name) headers.set('X-User-Name', payload.name);
    return NextResponse.next({ request: { headers } });
  }

  // ── No valid JWT: strip user-identity headers to prevent spoofing ──
  // This is critical: without this, any client could set X-User-Id
  // and impersonate any user.
  const spoofedHeaders = ['x-user-id', 'x-user-email', 'x-user-role', 'x-user-name'];
  const hasSpoofedHeader = spoofedHeaders.some(h => request.headers.has(h));

  if (hasSpoofedHeader) {
    const headers = new Headers(request.headers);
    for (const h of spoofedHeaders) {
      headers.delete(h);
    }
    return NextResponse.next({ request: { headers } });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*'],
};
