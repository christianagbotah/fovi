// ============================================================
// Fabricated Success Tests (Req 7)
// Verify that DB failures return typed non-2xx,
// never fake IDs, enabled status, or deletion success.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const ORIGINAL_ENV = process.env;

vi.mock('@/lib/db', () => ({
  db: null,
  hasModel: () => true, // Claims model exists but db is null
}));

vi.mock('@/lib/subscription-guard', () => ({
  checkSubscriptionLimit: () => ({ allowed: true, current: 0, limit: 10 }),
  getLimitMessage: () => 'Limit exceeded',
}));

vi.mock('@/lib/system-config', () => ({
  getGlobalAdminLevy: () => Promise.resolve(10),
}));

function authedReq(userId: string, url: string) {
  return new NextRequest(new URL(url), { headers: { 'x-user-id': userId } });
}

function authedReqPost(userId: string, body: unknown, url: string) {
  return new NextRequest(new URL(url), {
    method: 'POST',
    headers: { 'x-user-id': userId, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('no fabricated success on DB unavailable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => { process.env = ORIGINAL_ENV; });

  it('bots POST returns 503 when db is null (not fake bot with demo ID)', async () => {
    const { POST } = await import('@/app/api/trading/bots/route');
    const res = await POST(authedReqPost('user_1', { name: 'Test' }, 'http://localhost/api/trading/bots'));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBeDefined();
    // 503 error body should NOT contain a fake bot ID
    expect(body.id).toBeUndefined();
  });

  it('bots GET returns 503 (not demo fallback) when db is null', async () => {
    const { GET } = await import('@/app/api/trading/bots/route');
    const res = await GET(authedReq('user_1', 'http://localhost/api/trading/bots'));
    // CR4.1: Auth-gated 503, NOT demo fallback data
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBeDefined();
    expect(body.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('bots toggle returns 503 when db is null (not enabled:true)', async () => {
    const { POST } = await import('@/app/api/trading/bots/[id]/toggle/route');
    const res = await POST(
      authedReqPost('user_1', {}, 'http://localhost/api/trading/bots/bot_1/toggle'),
      { params: Promise.resolve({ id: 'bot_1' }) },
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.enabled).not.toBe(true);
  });

  it('bots DELETE returns 503 when db is null (not success:true)', async () => {
    const { DELETE } = await import('@/app/api/trading/bots/[id]/route');
    const res = await DELETE(
      new NextRequest(new URL('http://localhost/api/trading/bots/bot_1'), { method: 'DELETE', headers: { 'x-user-id': 'user_1' } }),
      { params: Promise.resolve({ id: 'bot_1' }) },
    );
    expect(res.status).toBe(503);
  });

  it('journal POST returns 503 when db is null (not fake entry)', async () => {
    const { POST } = await import('@/app/api/trading/journal/route');
    const res = await POST(authedReqPost('user_1', { symbol: 'BTC' }, 'http://localhost/api/trading/journal'));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBeDefined();
    // 503 body should NOT contain a fabricated journal ID
    expect(body.id).toBeUndefined();
  });

  it('auto-trade PUT returns 503 when db is null (not fake running status)', async () => {
    const { PUT } = await import('@/app/api/trading/auto-trade/route');
    const res = await PUT(authedReqPost('user_1', { enabled: true }, 'http://localhost/api/trading/auto-trade'));
    expect(res.status).toBe(503);
  });

  it('webhook DELETE returns 503 when db is null (not success:true)', async () => {
    const { DELETE } = await import('@/app/api/trading/webhooks/route');
    const res = await DELETE(
      new NextRequest(new URL('http://localhost/api/trading/webhooks?id=wh_1'), { method: 'DELETE', headers: { 'x-user-id': 'user_1' } }),
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.success).not.toBe(true);
  });
});
