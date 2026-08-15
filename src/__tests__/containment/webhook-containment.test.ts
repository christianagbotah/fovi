// ============================================================
// Webhook Containment Tests (Req 7)
// Verify webhook DELETE returns 503 when DB unavailable.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const ORIGINAL_ENV = process.env;

vi.mock('@/lib/db', () => ({
  db: null,
  hasModel: () => true,
}));

describe('webhook containment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => { process.env = ORIGINAL_ENV; });

  it('DELETE returns 503 when DB unavailable (not success:true)', async () => {
    const { DELETE } = await import('@/app/api/trading/webhooks/route');
    const res = await DELETE(
      new NextRequest(new URL('http://localhost/api/trading/webhooks?id=wh_1'), {
        method: 'DELETE',
        headers: { 'x-user-id': 'user_1' },
      }),
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.success).not.toBe(true);
  });

  it('POST always returns 503', async () => {
    const { POST } = await import('@/app/api/trading/webhooks/route');
    const res = await POST();
    expect(res.status).toBe(503);
  });
});
