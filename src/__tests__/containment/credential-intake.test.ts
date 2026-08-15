// ============================================================
// Credential Intake Tests (Req 3)
// Verify non-demo credential intake is unconditionally blocked.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const ORIGINAL_ENV = process.env;

vi.mock('@/lib/db', () => ({
  db: {
    tradingAccount: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({ id: 'new' }) },
  },
  hasModel: () => true,
}));

vi.mock('@/lib/subscription-guard', () => ({
  checkSubscriptionLimit: () => ({ allowed: true, current: 0, limit: 10 }),
  getLimitMessage: () => 'Limit exceeded',
}));

function authedReqPost(userId: string, body: unknown) {
  return new NextRequest(new URL('http://localhost/api/trading/accounts'), {
    method: 'POST',
    headers: { 'x-user-id': userId, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('credential intake containment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    process.env.BROKER_CREDENTIAL_INTAKE_ENABLED = 'true';
  });

  afterEach(() => { process.env = ORIGINAL_ENV; });

  it('blocks OKX credential intake even when BROKER_CREDENTIAL_INTAKE_ENABLED=true', async () => {
    const { POST } = await import('@/app/api/trading/accounts/route');
    const res = await POST(authedReqPost('user_1', {
      broker: 'okx', accountType: 'live',
      apiKey: 'real-key', apiSecret: 'real-secret',
    }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('PHASE1_LIVE_TRADING_DISABLED');
  });

  it('blocks Binance credential intake', async () => {
    const { POST } = await import('@/app/api/trading/accounts/route');
    const res = await POST(authedReqPost('user_1', {
      broker: 'binance', accountType: 'live',
      apiKey: 'key', apiSecret: 'secret',
    }));
    expect(res.status).toBe(403);
  });

  it('blocks Alpaca credential intake', async () => {
    const { POST } = await import('@/app/api/trading/accounts/route');
    const res = await POST(authedReqPost('user_1', {
      broker: 'alpaca', accountType: 'live',
      apiKey: 'key', apiSecret: 'secret',
    }));
    expect(res.status).toBe(403);
  });

  it('allows demo account creation', async () => {
    const { POST } = await import('@/app/api/trading/accounts/route');
    const res = await POST(authedReqPost('user_1', {
      broker: 'demo', accountType: 'demo',
    }));
    expect(res.status).toBe(200);
  });
});
