// ============================================================
// No Demo Identity Tests (Req 6)
// Verify that protected routes do NOT fall back to
// ensureDemoUser() or DEMO_USER_ID.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const ORIGINAL_ENV = process.env;

const ensureDemoUserSpy = vi.fn().mockResolvedValue(null);

vi.mock('@/lib/db', () => ({
  db: {
    tradingAccount: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
    bot: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]), create: vi.fn(), update: vi.fn(), delete: vi.fn(), findUnique: vi.fn() },
    tradeJournal: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn() },
    tradingSignal: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    backtest: { create: vi.fn() },
  },
  hasModel: () => true,
  ensureDemoUser: ensureDemoUserSpy,
}));

vi.mock('@/lib/broker/factory', () => ({
  createBrokerFromAccount: vi.fn().mockResolvedValue({
    getPositions: () => Promise.resolve([]),
    getAccountInfo: () => Promise.resolve({ accountId: 'x', balance: 10000, currency: 'USD', buyingPower: 10000, dayPnl: 0 }),
    getCandles: () => Promise.resolve([]),
    getPrice: () => Promise.resolve(50000),
  }),
  BrokerFactoryError: class extends Error { code: string; constructor(c: string, m: string) { super(m); this.code = c; } },
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
  return new NextRequest(new URL(url), { method: 'POST', headers: { 'x-user-id': userId, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

describe('no shared demo identity in protected routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => { process.env = ORIGINAL_ENV; });

  it('bots POST does not call ensureDemoUser', async () => {
    const { POST } = await import('@/app/api/trading/bots/route');
    await POST(authedReqPost('user_1', { name: 'Test Bot' }, 'http://localhost/api/trading/bots'));
    expect(ensureDemoUserSpy).not.toHaveBeenCalled();
  });

  it('bots GET does not call ensureDemoUser', async () => {
    const { GET } = await import('@/app/api/trading/bots/route');
    await GET(authedReq('user_1', 'http://localhost/api/trading/bots'));
    expect(ensureDemoUserSpy).not.toHaveBeenCalled();
  });

  it('journal POST does not call ensureDemoUser', async () => {
    const { POST } = await import('@/app/api/trading/journal/route');
    await POST(authedReqPost('user_1', { symbol: 'BTC' }, 'http://localhost/api/trading/journal'));
    expect(ensureDemoUserSpy).not.toHaveBeenCalled();
  });

  it('journal GET does not call ensureDemoUser', async () => {
    const { GET } = await import('@/app/api/trading/journal/route');
    await GET(authedReq('user_1', 'http://localhost/api/trading/journal'));
    expect(ensureDemoUserSpy).not.toHaveBeenCalled();
  });

  it('auto-trade GET does not call ensureDemoUser', async () => {
    const { GET } = await import('@/app/api/trading/auto-trade/route');
    await GET(authedReq('user_1', 'http://localhost/api/trading/auto-trade'));
    expect(ensureDemoUserSpy).not.toHaveBeenCalled();
  });

  it('auto-trade PUT does not call ensureDemoUser', async () => {
    const { PUT } = await import('@/app/api/trading/auto-trade/route');
    await PUT(authedReqPost('user_1', { enabled: true }, 'http://localhost/api/trading/auto-trade'));
    expect(ensureDemoUserSpy).not.toHaveBeenCalled();
  });

  it('signals GET does not call ensureDemoUser', async () => {
    const { GET } = await import('@/app/api/trading/signals/route');
    await GET(authedReq('user_1', 'http://localhost/api/trading/signals'));
    expect(ensureDemoUserSpy).not.toHaveBeenCalled();
  });
});
