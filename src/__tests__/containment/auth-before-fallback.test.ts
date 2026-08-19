// ============================================================
// auth-before-fallback.test.ts — CR4.1/CR4.2
// Tests that auth is required before fallback/demo data.
// When DB is unavailable, routes should return 401 (not demo data)
// when there is no auth.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock db as null/unavailable
vi.mock('@/lib/db', () => ({
  db: null,
  hasModel: vi.fn(() => false),
  isDbAvailable: vi.fn(() => false),
}));

vi.mock('@/lib/trading-policy', () => ({
  DEMO_PROVENANCE_HEADER: { 'x-environment': 'demo' },
  logSecurityEvent: vi.fn(),
  CONTAINMENT_CODES: {},
}));

vi.mock('@/lib/subscription-guard', () => ({
  checkSubscriptionLimit: vi.fn(() => Promise.resolve({ allowed: true, current: 0, limit: 10 })),
  getLimitMessage: vi.fn(() => 'limit'),
}));

// Auth mock — use vi.hoisted to avoid hoisting issues
const { mockGetUserIdSync, mockAuthRequiredResponse, AuthRequiredErrorCls } = vi.hoisted(() => {
  const mockGetUserIdSync = vi.fn<() => string>(() => {
    throw new Error('AuthRequiredError');
  });
  const AuthRequiredErrorCls = class extends Error {
    constructor() { super('Authentication required.'); this.name = 'AuthRequiredError'; }
  };
  const mockAuthRequiredResponse = vi.fn(() => new Response(
    JSON.stringify({ error: 'Authentication required.', code: 'AUTH_REQUIRED', remediationPhase: 'containment' }),
    { status: 401 },
  ));
  return { mockGetUserIdSync, mockAuthRequiredResponse, AuthRequiredErrorCls };
});

vi.mock('@/lib/get-user-id', () => ({
  getUserIdSync: mockGetUserIdSync,
  getUserId: vi.fn(() => Promise.resolve('user-123')),
  AuthRequiredError: AuthRequiredErrorCls,
  authRequiredResponse: mockAuthRequiredResponse,
  getUserIdOrNull: vi.fn(() => null),
}));

vi.mock('@/lib/demo-response', () => ({
  demoResponse: vi.fn(() => new Response('{}', { status: 200 })),
}));

vi.spyOn(console, 'warn').mockImplementation(() => {});

import { GET as botsGet } from '@/app/api/trading/bots/route';
import { GET as journalGet } from '@/app/api/trading/journal/route';

function makeRequest(url: string, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost${url}`, { headers });
}

describe('Auth before fallback — Bots GET', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('without auth when DB unavailable → 401 (not demo data)', async () => {
    mockGetUserIdSync.mockImplementation(() => {
      throw new Error('AuthRequiredError');
    });

    const req = makeRequest('/api/trading/bots', {});
    const res = await botsGet(req);
    const data = await res.json();

    expect(res.status).toBe(401);
    expect(data.code).toBe('AUTH_REQUIRED');
  });

  it('with auth when DB unavailable → 503 (not demo data)', async () => {
    mockGetUserIdSync.mockReturnValue('user-123');

    const req = makeRequest('/api/trading/bots', { 'x-user-id': 'user-123' });
    const res = await botsGet(req);
    const data = await res.json();

    expect(res.status).toBe(503);
    expect(data.code).toBe('SERVICE_UNAVAILABLE');
  });
});

describe('Auth before fallback — Journal GET', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('without auth when DB unavailable → 401', async () => {
    mockGetUserIdSync.mockImplementation(() => {
      throw new Error('AuthRequiredError');
    });

    const req = makeRequest('/api/trading/journal', {});
    const res = await journalGet(req);
    const data = await res.json();

    expect(res.status).toBe(401);
    expect(data.code).toBe('AUTH_REQUIRED');
  });
});
