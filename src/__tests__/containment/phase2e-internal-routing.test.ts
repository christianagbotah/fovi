import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = process.env;

vi.mock('@/lib/auth', () => ({
  verifyToken: vi.fn(),
  extractBearerToken: vi.fn(() => null),
}));

vi.mock('@/lib/trading-policy', () => ({
  constantTimeEqual: vi.fn((a: string, b: string) => a === b),
  CONTAINMENT_CODES: {
    AUTH_REQUIRED: 'AUTH_REQUIRED',
    INTERNAL_AUTH_REQUIRED: 'INTERNAL_AUTH_REQUIRED',
    INTERNAL_AUTH_INVALID: 'INTERNAL_AUTH_INVALID',
  },
}));

import { proxy } from '@/proxy';

function makeRequest(pathname: string, headers: Record<string, string> = {}) {
  const req = new Request(`http://localhost:3000${pathname}`, { headers });
  Object.defineProperty(req, 'nextUrl', { value: { pathname } });
  return req as never;
}

describe('Phase 2E exact internal execution routing', () => {
  const internalPaths = [
    '/api/trading/engine/execute',
    '/api/trading/engine/positions',
    '/api/trading/engine/close',
  ];

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, INTERNAL_SERVICE_SECRET: 's'.repeat(32) };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  for (const path of internalPaths) {
    it(`requires internal auth for ${path}`, async () => {
      const res = await proxy(makeRequest(path));
      expect(res.status).toBe(401);
      expect((await res.json()).code).toBe('INTERNAL_AUTH_INVALID');
    });

    it(`accepts the configured internal secret for ${path}`, async () => {
      const res = await proxy(makeRequest(path, {
        'x-internal-service-secret': 's'.repeat(32),
      }));
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(503);
    });
  }

  it('does not widen authorization to an unknown engine path', async () => {
    const res = await proxy(makeRequest('/api/trading/engine/not-authorized', {
      'x-internal-service-secret': 's'.repeat(32),
    }));
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('AUTH_REQUIRED');
  });
});
