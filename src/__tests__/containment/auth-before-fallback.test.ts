// ============================================================
// auth-before-fallback.test.ts — CR4.1
// Tests that auth is required before fallback/demo data.
// When DB is unavailable, routes should return 401 (not demo data)
// when there is no auth.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

// Auth mock that throws for missing user-id
const mockGetUserIdSync = vi.fn(() => {
  throw new Error('AuthRequiredError');
});

vi.mock('@/lib/get-user-id', () => ({
  getUserIdSync: (...args: unknown[]) => mockGetUserIdSync(...args),
  getUserId: vi.fn(() => Promise.resolve('user-123')),
  AuthRequiredError: class extends Error {
    constructor() { super('Authentication required.'); this.name = 'AuthRequiredError'; }
  },
  authRequiredResponse: vi.fn(() => new Response(
    JSON.stringify({ error: 'Authentication required.', code: 'AUTH_REQUIRED', remediationPhase: 'containment' }),
    { status: 401 },
  )),
  getUserIdOrNull: vi.fn(() => null),
}));

vi.mock('@/lib/demo-response', () => ({
  demoResponse: vi.fn(() => new Response('{}', { status: 200 })),
}));

vi.spyOn(console, 'warn').mockImplementation(() => {});

import { GET as botsGet } from '@/app/api/trading/bots/route';
import { GET as journalGet } from '@/app/api/trading/journal/route';

function makeRequest(url: string, headers: Record<string, string> = {}) {
  return new Request(`http://localhost${url}`, { headers });
}

describe('Auth before fallback — Bots GET', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('without auth when DB unavailable → 401 (not demo data)', async () => {
    // getUserIdSync will throw (no x-user-id header)
    mockGetUserIdSync.mockImplementation(() => {
      throw new Error('AuthRequiredError');
    });

    const req = makeRequest('/api/trading/bots', {}); // No x-user-id
    const res = await botsGet(req);
    const data = await res.json();

    expect(res.status).toBe(401);
    expect(data.code).toBe('AUTH_REQUIRED');
  });

  it('with auth when DB unavailable → 503 (not demo data)', async () => {
    mockGetUserIdSync.mockImplementation(() => 'user-123');

    const req = makeRequest('/api/trading/bots', { 'x-user-id': 'user-123' });
    const res = await botsGet(req);
    const data = await res.json();

    // DB unavailable + auth present → 503 SERVICE_UNAVAILABLE, NOT demo bots
    expect(res.status).toBe(503);
    expect(data.code).toBe('SERVICE_UNAVAILABLE');
    // Ensure it's not returning the demo bot array
    expect(Array.isArray(data)).toBe(false);
  });
});

describe('Auth before fallback — Journal GET', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('without auth when DB unavailable → 401 (not demo data)', async () => {
    mockGetUserIdSync.mockImplementation(() => {
      throw new Error('AuthRequiredError');
    });

    const req = makeRequest('/api/trading/journal', {});
    const res = await journalGet(req);
    const data = await res.json();

    expect(res.status).toBe(401);
    expect(data.code).toBe('AUTH_REQUIRED');
  });

  it('with auth when DB unavailable → 503 (not demo data)', async () => {
    mockGetUserIdSync.mockImplementation(() => 'user-123');

    const req = makeRequest('/api/trading/journal', { 'x-user-id': 'user-123' });
    const res = await journalGet(req);
    const data = await res.json();

    expect(res.status).toBe(503);
    expect(data.code).toBe('SERVICE_UNAVAILABLE');
    // Ensure it's not returning demo journal entries
    expect(Array.isArray(data)).toBe(false);
  });
});
