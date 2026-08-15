// ============================================================
// Timing-Safe Comparison Tests (Req 10)
// Verify SHA-256 + timingSafeEqual implementation.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ORIGINAL_ENV = process.env;

vi.mock('@/lib/db', () => ({ db: null, hasModel: () => false }));

describe('constantTimeEqual (SHA-256 based)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => { process.env = ORIGINAL_ENV; });

  it('returns true for equal strings', async () => {
    const { constantTimeEqual } = await import('@/lib/trading-policy');
    expect(constantTimeEqual('abc123', 'abc123')).toBe(true);
  });

  it('returns true for empty strings', async () => {
    const { constantTimeEqual } = await import('@/lib/trading-policy');
    expect(constantTimeEqual('', '')).toBe(true);
  });

  it('returns true for same long string', async () => {
    const { constantTimeEqual } = await import('@/lib/trading-policy');
    const long = 'a'.repeat(1000);
    expect(constantTimeEqual(long, long)).toBe(true);
  });

  it('returns false for different strings of same length', async () => {
    const { constantTimeEqual } = await import('@/lib/trading-policy');
    expect(constantTimeEqual('abc123', 'abc124')).toBe(false);
  });

  it('returns false for different-length strings', async () => {
    const { constantTimeEqual } = await import('@/lib/trading-policy');
    expect(constantTimeEqual('short', 'much-longer-string')).toBe(false);
  });

  it('returns false for empty vs non-empty', async () => {
    const { constantTimeEqual } = await import('@/lib/trading-policy');
    expect(constantTimeEqual('', 'non-empty')).toBe(false);
  });

  it('returns false for non-empty vs empty', async () => {
    const { constantTimeEqual } = await import('@/lib/trading-policy');
    expect(constantTimeEqual('non-empty', '')).toBe(false);
  });

  it('handles Unicode correctly', async () => {
    const { constantTimeEqual } = await import('@/lib/trading-policy');
    expect(constantTimeEqual('café', 'café')).toBe(true);
    expect(constantTimeEqual('café', 'cafe')).toBe(false);
  });

  it('handles emoji correctly', async () => {
    const { constantTimeEqual } = await import('@/lib/trading-policy');
    expect(constantTimeEqual('🔑secret', '🔑secret')).toBe(true);
    expect(constantTimeEqual('🔑secret', '🔑secrét')).toBe(false);
  });

  it('handles null bytes in strings', async () => {
    const { constantTimeEqual } = await import('@/lib/trading-policy');
    expect(constantTimeEqual('ab\x00c', 'ab\x00c')).toBe(true);
  });

  it('does not log either secret', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { constantTimeEqual } = await import('@/lib/trading-policy');
    constantTimeEqual('my-secret-value', 'my-secret-value');
    constantTimeEqual('my-secret-value', 'wrong-value');
    // constantTimeEqual does not log at all
    const logCalls = warnSpy.mock.calls.map(c => c[0]);
    for (const call of logCalls) {
      if (typeof call === 'string') {
        expect(call).not.toContain('my-secret-value');
      }
    }
    warnSpy.mockRestore();
  });

  it('missing configured secret in enforceInternalAuth returns 503', async () => {
    delete process.env.INTERNAL_SERVICE_SECRET;
    vi.resetModules();
    const { enforceInternalAuth } = await import('@/lib/trading-policy');
    const req = new Request('http://localhost', {
      headers: { 'x-internal-service-secret': 'anything' },
    });
    const res = enforceInternalAuth(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(503);
  });
});
