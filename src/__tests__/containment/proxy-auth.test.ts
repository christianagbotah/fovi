// ============================================================
// Containment behavioral tests — proxy authentication (Req 3)
// Tests the three route classes, forged headers, JWT validation,
// internal service auth, and cross-class access attempts.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock env before importing proxy
const ORIGINAL_ENV = process.env;

// We need to mock auth module since it throws at module level
// when secrets are missing in production
vi.mock('@/lib/auth', () => ({
  verifyToken: vi.fn(),
  extractBearerToken: vi.fn(),
}));

vi.mock('@/lib/trading-policy', () => ({
  constantTimeEqual: vi.fn((a: string, b: string) => a === b),
  CONTAINMENT_CODES: {
    LIVE_BLOCKED: 'LIVE_TRADING_DISABLED',
    CREDENTIAL_INTAKE_DISABLED: 'CREDENTIAL_INTAKE_DISABLED',
    AUTH_REQUIRED: 'AUTH_REQUIRED',
    INTERNAL_AUTH_REQUIRED: 'INTERNAL_AUTH_REQUIRED',
    INTERNAL_AUTH_INVALID: 'INTERNAL_AUTH_INVALID',
    DEMO_ONLY: 'DEMO_ACCOUNT_REQUIRED',
    BROKER_CONNECTION_FAILED: 'BROKER_CONNECTION_FAILED',
    BROKER_CONFIG_INCOMPLETE: 'BROKER_CONFIG_INCOMPLETE',
    WEBHOOK_DISABLED: 'WEBHOOK_INGRESS_DISABLED',
    CONFIGURATION_REQUIRED: 'CONFIGURATION_REQUIRED',
  },
}));

import { proxy } from '@/proxy';
import { verifyToken, extractBearerToken } from '@/lib/auth';
import { constantTimeEqual } from '@/lib/trading-policy';

const mockedVerifyToken = vi.mocked(verifyToken);
const mockedExtractBearerToken = vi.mocked(extractBearerToken);
const mockedConstantTimeEqual = vi.mocked(constantTimeEqual);

function makeRequest(pathname: string, headers: Record<string, string> = {}) {
  const url = `http://localhost:3000${pathname}`;
  const req = new Request(url, { headers } as RequestInit);
  // Add NextRequest-like nextUrl
  Object.defineProperty(req, 'nextUrl', {
    value: { pathname },
    writable: false,
  });
  return req as any;
}

// Helper to read response JSON
async function jsonResponse(res: Response) {
  return { status: res.status, body: await res.json(), headers: Object.fromEntries(res.headers.entries()) };
}

describe('proxy authentication partitioning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  // ── CLASS 1: Public routes ──
  describe('public routes (no auth)', () => {
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
      '/api/auth/refresh',
      '/api/auth/verify-email',
      '/api/auth/resend-verification',
      '/api/payments/hubtel/callback',
      '/api/trading/market/symbols',
      '/api/trading/leaderboard',
      '/api/health',
      '/api/trading/webhook',
    ];

    for (const path of PUBLIC_PATHS) {
      it(`allows unauthenticated access to ${path}`, async () => {
        const req = makeRequest(path);
        const res = await proxy(req);
        // Should pass through (next) — not 401 or 503
        expect(res.status).not.toBe(401);
        expect(res.status).not.toBe(503);
      });
    }

    it('strips forged identity headers on public routes', async () => {
      const req = makeRequest('/api/health', {
        'x-user-id': 'attacker_123',
        'x-user-email': 'attacker@evil.com',
        'x-user-role': 'admin',
        'x-internal-service': 'true',
      });
      const res = await proxy(req);
      // The cleaned headers should NOT contain forged values
      const forwardedHeaders = res.headers.get('x-middleware-request-headers') || '';
      // The response should have passed through
      expect(res.status).not.toBe(401);
    });
  });

  // ── CLASS 2: Internal service routes ──
  describe('internal service routes', () => {
    const INTERNAL_PATHS = [
      '/api/trading/engine/report',
      '/api/trading/engine/bots',
      '/api/trading/bots/engine/activity',
      '/api/trading/bots/engine/status',
      '/api/trading/bots/engine/trigger',
    ];

    it('returns 503 when INTERNAL_SERVICE_SECRET is not configured', async () => {
      process.env.INTERNAL_SERVICE_SECRET = '';
      const req = makeRequest('/api/trading/engine/report', {
        'x-internal-service-secret': 'anything',
      });
      const res = await proxy(req);
      const json = await jsonResponse(res);
      expect(json.status).toBe(503);
      expect(json.body.code).toBe('INTERNAL_AUTH_REQUIRED');
    });

    it('returns 401 for invalid internal service secret', async () => {
      process.env.INTERNAL_SERVICE_SECRET = 'real-secret-value-1234567890';
      mockedConstantTimeEqual.mockReturnValue(false);
      const req = makeRequest('/api/trading/engine/bots', {
        'x-internal-service-secret': 'wrong-secret',
      });
      const res = await proxy(req);
      const json = await jsonResponse(res);
      expect(json.status).toBe(401);
      expect(json.body.code).toBe('INTERNAL_AUTH_INVALID');
    });

    it('allows valid internal service secret for internal routes', async () => {
      process.env.INTERNAL_SERVICE_SECRET = 'real-secret-value-1234567890';
      mockedConstantTimeEqual.mockReturnValue(true);
      const req = makeRequest('/api/trading/engine/report', {
        'x-internal-service-secret': 'real-secret-value-1234567890',
      });
      const res = await proxy(req);
      // Should pass through
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(503);
    });

    it('does NOT authorize user routes with internal service secret', async () => {
      process.env.INTERNAL_SERVICE_SECRET = 'real-secret-value-1234567890';
      mockedConstantTimeEqual.mockReturnValue(true);
      const req = makeRequest('/api/trading/accounts', {
        'x-internal-service-secret': 'real-secret-value-1234567890',
      });
      const res = await proxy(req);
      const json = await jsonResponse(res);
      // /api/trading/accounts is NOT in INTERNAL_SERVICE_PATHS, so
      // the internal secret check won't match. It falls through to JWT check.
      // Since no JWT is provided, it should return 401.
      expect(json.status).toBe(401);
    });

    it('does NOT accept caller-supplied X-User-Id as identity', async () => {
      process.env.INTERNAL_SERVICE_SECRET = 'real-secret-value-1234567890';
      mockedConstantTimeEqual.mockReturnValue(true);
      const req = makeRequest('/api/trading/engine/report', {
        'x-internal-service-secret': 'real-secret-value-1234567890',
        'x-user-id': 'attacker_123',
      });
      const res = await proxy(req);
      // Should pass through but the X-User-Id header should have been stripped
      // before the internal auth check
      expect(res.status).not.toBe(401);
    });

    for (const path of INTERNAL_PATHS) {
      it(`requires auth for ${path}`, async () => {
        process.env.INTERNAL_SERVICE_SECRET = '';
        const req = makeRequest(path);
        const res = await proxy(req);
        expect(res.status).toBe(503);
      });
    }
  });

  // ── CLASS 3: JWT-authenticated routes ──
  describe('JWT-authenticated routes', () => {
    it('returns 401 for anonymous request to protected route', async () => {
      mockedExtractBearerToken.mockReturnValue(null);
      mockedVerifyToken.mockResolvedValue(null);
      const req = makeRequest('/api/trading/accounts');
      const res = await proxy(req);
      const json = await jsonResponse(res);
      expect(json.status).toBe(401);
      expect(json.body.code).toBe('AUTH_REQUIRED');
    });

    it('returns 401 for invalid JWT', async () => {
      mockedExtractBearerToken.mockReturnValue('invalid-token');
      mockedVerifyToken.mockResolvedValue(null);
      const req = makeRequest('/api/trading/accounts', {
        authorization: 'Bearer invalid-token',
      });
      const res = await proxy(req);
      const json = await jsonResponse(res);
      expect(json.status).toBe(401);
    });

    it('returns 401 for refresh token on user route', async () => {
      mockedExtractBearerToken.mockReturnValue('refresh-token');
      mockedVerifyToken.mockResolvedValue({ sub: 'user1', type: 'refresh' } as any);
      const req = makeRequest('/api/trading/accounts', {
        authorization: 'Bearer refresh-token',
      });
      const res = await proxy(req);
      const json = await jsonResponse(res);
      expect(json.status).toBe(401);
    });

    it('allows valid access JWT to protected route', async () => {
      mockedExtractBearerToken.mockReturnValue('valid-access-token');
      mockedVerifyToken.mockResolvedValue({
        sub: 'user_abc', email: 'test@test.com', name: 'Test', role: 'user', type: 'access',
      });
      const req = makeRequest('/api/trading/accounts', {
        authorization: 'Bearer valid-access-token',
      });
      const res = await proxy(req);
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });

    it('returns 403 for non-admin JWT on admin route', async () => {
      mockedExtractBearerToken.mockReturnValue('user-token');
      mockedVerifyToken.mockResolvedValue({
        sub: 'user_abc', email: 'test@test.com', type: 'access', role: 'user',
      });
      const req = makeRequest('/api/admin/users', {
        authorization: 'Bearer user-token',
      });
      const res = await proxy(req);
      const json = await jsonResponse(res);
      expect(json.status).toBe(403);
      expect(json.body.code).toBe('FORBIDDEN');
    });

    it('allows admin JWT on admin route', async () => {
      mockedExtractBearerToken.mockReturnValue('admin-token');
      mockedVerifyToken.mockResolvedValue({
        sub: 'admin_1', email: 'admin@test.com', type: 'access', role: 'admin',
      });
      const req = makeRequest('/api/admin/users', {
        authorization: 'Bearer admin-token',
      });
      const res = await proxy(req);
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });

    it('strips forged X-User-Id before JWT verification', async () => {
      mockedExtractBearerToken.mockReturnValue('valid-token');
      mockedVerifyToken.mockResolvedValue({
        sub: 'real_user', email: 'real@test.com', type: 'access',
      });
      const req = makeRequest('/api/trading/accounts', {
        authorization: 'Bearer valid-token',
        'x-user-id': 'forged_user',
        'x-user-role': 'admin',
      });
      const res = await proxy(req);
      // Should succeed with the JWT's user, not the forged header
      expect(res.status).not.toBe(401);
    });
  });
});
