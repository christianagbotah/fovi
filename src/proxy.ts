// ============================================================
// proxy.ts — Next.js 16 Request Boundary
// Phase 1 CR2 / Phase 2E: Three explicit route classes with strict partitioning.
//   1. PUBLIC_PATHS — exact match, no auth needed
//   2. INTERNAL_SERVICE_PATHS — exact match, internal secret only
//   3. Everything else — requires valid access JWT
// Admin routes require verified admin JWT.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, extractBearerToken } from '@/lib/auth';
import { constantTimeEqual, CONTAINMENT_CODES } from '@/lib/trading-policy';

/**
 * Strip ALL incoming identity/trust headers FIRST, before any auth logic.
 */
const IDENTITY_HEADERS_TO_STRIP = [
  'x-user-id',
  'x-user-email',
  'x-user-role',
  'x-user-name',
  'x-internal-service',
] as const;

// ── CLASS 1: Public routes (exact match, no auth) ──
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
  '/api/auth/refresh',
  '/api/auth/logout',
  '/api/auth/verify-email',
  '/api/auth/resend-verification',
  '/api/payments/hubtel/callback',
  '/api/trading/market/symbols',
  '/api/trading/leaderboard',
  '/api/health',
  // /api/trading/webhook is public but ALWAYS returns 503 containment.
  // It is intentionally listed here so unauthenticated callers get the
  // 503 response from the route handler, not a 401 from the proxy.
  '/api/trading/webhook',
];

// ── CLASS 2: Internal service routes (exact match, secret only) ──
// These routes accept ONLY internal service secret auth.
// A valid JWT must NOT authorize these routes.
// Caller-supplied X-User-Id is never trusted as internal-service identity.
// Keep this list exact: do not widen it to an /api/trading/engine/* prefix.
const INTERNAL_SERVICE_PATHS: string[] = [
  '/api/trading/engine/report',
  '/api/trading/engine/bots',
  '/api/trading/engine/execute',
  '/api/trading/engine/positions',
  '/api/trading/engine/close',
  '/api/trading/bots/engine/activity',
  '/api/trading/bots/engine/status',
  '/api/trading/bots/engine/trigger',
];

// ── CLASS 3: Admin routes (prefix match, admin JWT required) ──
const ADMIN_PREFIXES: string[] = [
  '/api/admin/',
];

function isExactMatch(pathname: string, paths: string[]): boolean {
  return paths.includes(pathname);
}

function matchesAnyPrefix(pathname: string, prefixes: string[]): boolean {
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

  // ── STEP 1: CLASS 1 — Public routes (no auth needed) ──
  if (isExactMatch(pathname, PUBLIC_PATHS)) {
    return NextResponse.next({ request: { headers: cleanedHeaders } });
  }

  // ── STEP 2: CLASS 2 — Internal service routes ──
  if (isExactMatch(pathname, INTERNAL_SERVICE_PATHS)) {
    const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET;

    // Missing secret configuration → 503
    if (!INTERNAL_SECRET) {
      return NextResponse.json(
        {
          error: 'Internal service authentication not configured.',
          code: CONTAINMENT_CODES.INTERNAL_AUTH_REQUIRED,
          remediationPhase: 'containment',
        },
        { status: 503 },
      );
    }

    const provided = request.headers.get('x-internal-service-secret') || '';
    if (!constantTimeEqual(provided, INTERNAL_SECRET)) {
      return NextResponse.json(
        {
          error: 'Invalid or missing internal service credential.',
          code: CONTAINMENT_CODES.INTERNAL_AUTH_INVALID,
          remediationPhase: 'containment',
        },
        { status: 401 },
      );
    }

    // Valid internal service — set marker AFTER verification
    cleanedHeaders.set('X-Internal-Service', 'true');
    // Do NOT set X-User-Id from the request. Internal services must
    // resolve user context server-side (e.g., from DB by accountId).
    return NextResponse.next({ request: { headers: cleanedHeaders } });
  }

  // ── STEP 3: CLASS 3 — All remaining routes require JWT ──

  const token = extractBearerToken(request);
  let payload: Awaited<ReturnType<typeof verifyToken>> = null;

  if (token) {
    payload = await verifyToken(token);
  }

  // 3a. No valid JWT → 401
  if (!payload || payload.type !== 'access') {
    return NextResponse.json(
      {
        error: 'Authentication required.',
        code: CONTAINMENT_CODES.AUTH_REQUIRED,
        remediationPhase: 'containment',
      },
      { status: 401 },
    );
  }

  // 3b. Valid access token — inject verified user headers
  cleanedHeaders.set('X-User-Id', payload.sub);
  cleanedHeaders.set('X-User-Email', payload.email || '');
  if (payload.role) cleanedHeaders.set('X-User-Role', payload.role);
  if (payload.name) cleanedHeaders.set('X-User-Name', payload.name);

  // 3c. Admin routes require admin role
  if (matchesAnyPrefix(pathname, ADMIN_PREFIXES)) {
    if (payload.role !== 'admin') {
      return NextResponse.json(
        {
          error: 'Admin access required.',
          code: 'FORBIDDEN',
          remediationPhase: 'containment',
        },
        { status: 403 },
      );
    }
  }

  return NextResponse.next({ request: { headers: cleanedHeaders } });
}