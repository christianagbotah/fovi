// ============================================================
// proxy.ts — Next.js 16 Request Boundary
// Phase 1: Emergency Containment (Correction Round 1)
// ============================================================
// Replaces middleware.ts entirely. All containment logic lives here.
// middleware.ts MUST NOT exist on disk.

import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, extractBearerToken } from '@/lib/auth';
import { constantTimeEqual, CONTAINMENT_CODES } from '@/lib/trading-policy';

/**
 * Strip ALL incoming identity/trust headers FIRST, before any auth logic.
 * This prevents any client from spoofing identity headers.
 */
const IDENTITY_HEADERS_TO_STRIP = [
  'x-user-id',
  'x-user-email',
  'x-user-role',
  'x-user-name',
  'x-internal-service',
] as const;

/**
 * Routes that are always public (exact match, no auth needed).
 */
const PUBLIC_PATHS: string[] = [
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
  '/api/health',
  '/api/trading/webhook', // single webhook ingress — returns 503 containment
];

/**
 * Routes that MUST have a valid browser JWT (not just internal service).
 */
const PROTECTED_PREFIXES: string[] = [
  '/api/auth/change-password',
  '/api/auth/two-factor/setup',
  '/api/auth/two-factor/verify',
  '/api/auth/two-factor/disable',
  '/api/auth/me',
  '/api/subscriptions/',
];

/**
 * Admin-only path prefixes — require valid admin JWT.
 */
const ADMIN_PREFIXES: string[] = [
  '/api/admin/',
];

function isExactMatch(pathname: string, paths: string[]): boolean {
  return paths.includes(pathname);
}

function matchesAny(pathname: string, prefixes: string[]): boolean {
  return prefixes.some(p => pathname.startsWith(p));
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only intercept /api/* routes
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // ── STEP 0: Strip ALL incoming identity/trust headers FIRST ──
  const cleanedHeaders = new Headers(request.headers);
  for (const header of IDENTITY_HEADERS_TO_STRIP) {
    cleanedHeaders.delete(header);
  }

  // ── STEP 1: Allow fully public routes through (no auth needed) ──
  if (isExactMatch(pathname, PUBLIC_PATHS)) {
    return NextResponse.next({ request: { headers: cleanedHeaders } });
  }

  // ── STEP 2: For ALL other /api/* routes, require authentication ──

  // 2a. Try JWT Bearer token
  const token = extractBearerToken(request);
  let payload: Awaited<ReturnType<typeof verifyToken>> = null;

  if (token) {
    payload = await verifyToken(token);
  }

  // If valid JWT access token, inject verified user headers
  if (payload && payload.type === 'access') {
    cleanedHeaders.set('X-User-Id', payload.sub);
    cleanedHeaders.set('X-User-Email', payload.email || '');
    if (payload.role) cleanedHeaders.set('X-User-Role', payload.role);
    if (payload.name) cleanedHeaders.set('X-User-Name', payload.name);

    // ── Protected prefixes: require valid JWT (already verified above) ──
    // If payload is invalid but we got here, the type check fails below.
    // But we already verified payload.type === 'access' above.

    // ── Admin prefixes: require valid admin JWT ──
    if (matchesAny(pathname, ADMIN_PREFIXES)) {
      if (payload.role !== 'admin') {
        return NextResponse.json(
          { error: 'Admin access required.', code: 'FORBIDDEN', remediationPhase: 'containment' },
          { status: 403 },
        );
      }
    }

    return NextResponse.next({ request: { headers: cleanedHeaders } });
  }

  // 2b. No valid JWT — try internal service secret
  const internalSecret = request.headers.get('x-internal-service-secret') || '';
  const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET;

  if (!INTERNAL_SECRET) {
    // Secret not configured → fail closed for non-public routes
    return NextResponse.json(
      {
        error: 'Internal service authentication not configured.',
        code: CONTAINMENT_CODES.INTERNAL_AUTH_REQUIRED,
        remediationPhase: 'containment',
      },
      { status: 503 },
    );
  }

  if (constantTimeEqual(internalSecret, INTERNAL_SECRET)) {
    // Valid internal service — set marker AFTER verification
    cleanedHeaders.set('X-Internal-Service', 'true');

    // Protected prefixes require valid JWT, not just internal service
    if (matchesAny(pathname, PROTECTED_PREFIXES)) {
      return NextResponse.json(
        { error: 'Authentication required. Please sign in.', code: CONTAINMENT_CODES.AUTH_REQUIRED, remediationPhase: 'containment' },
        { status: 401 },
      );
    }

    // Admin prefixes require valid JWT, not just internal service
    if (matchesAny(pathname, ADMIN_PREFIXES)) {
      return NextResponse.json(
        { error: 'Admin authentication required.', code: CONTAINMENT_CODES.AUTH_REQUIRED, remediationPhase: 'containment' },
        { status: 401 },
      );
    }

    return NextResponse.next({ request: { headers: cleanedHeaders } });
  }

  // 2c. Neither JWT nor valid internal secret → 401
  return NextResponse.json(
    { error: 'Authentication required.', code: CONTAINMENT_CODES.AUTH_REQUIRED, remediationPhase: 'containment' },
    { status: 401 },
  );
}
