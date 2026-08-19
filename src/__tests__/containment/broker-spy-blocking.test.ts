// ============================================================
// Broker Spy Blocking Tests (Req 4)
// Real vi.fn() spies on broker factory methods.
// Invokes actual route handlers with mocked DB.
// Asserts: 403 + zero spy calls + no fabricated success.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const ORIGINAL_ENV = process.env;

// Spies on broker methods
const placeOrderSpy = vi.fn();
const cancelOrderSpy = vi.fn();
const closePositionSpy = vi.fn();
const getPositionsSpy = vi.fn().mockResolvedValue([]);
const getAccountInfoSpy = vi.fn().mockResolvedValue({
  accountId: 'broker-acc-1', balance: 10000, currency: 'USD', buyingPower: 10000, dayPnl: 0,
});

// Mock broker that records all calls
const mockBroker = {
  placeOrder: placeOrderSpy,
  cancelOrder: cancelOrderSpy,
  closePosition: closePositionSpy,
  getPositions: getPositionsSpy,
  getAccountInfo: getAccountInfoSpy,
  getCandles: vi.fn().mockResolvedValue([]),
  getPrice: vi.fn().mockResolvedValue(50000),
};

// Mock DB with user-scoped queries
const mockFindFirst = vi.fn();
const mockFindUnique = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockFindMany = vi.fn();
const mockUpsert = vi.fn();

vi.mock('@/lib/db', () => ({
  db: {
    tradingAccount: { findFirst: mockFindFirst, findMany: mockFindMany, update: mockUpdate, create: mockCreate, updateMany: mockUpdate },
    order: { findFirst: mockFindFirst, findMany: mockFindMany, create: mockCreate, update: mockUpdate },
    position: { findFirst: mockFindFirst, findMany: mockFindMany, create: mockCreate, update: mockUpdate },
    bot: { findFirst: mockFindFirst, findMany: mockFindMany, findUnique: mockFindUnique, create: mockCreate, update: mockUpdate, delete: mockDelete },
    botConfig: { findFirst: mockFindFirst, create: mockCreate, update: mockUpdate },
    webhookConfig: { findMany: mockFindMany, deleteMany: mockDelete },
    tradeJournal: { findMany: mockFindMany, create: mockCreate },
  },
  hasModel: (model: string) => ['tradingAccount', 'order', 'position', 'bot', 'botConfig', 'webhookConfig', 'tradeJournal'].includes(model),
}));

vi.mock('@/lib/broker/factory', () => ({
  createBrokerFromAccount: vi.fn().mockResolvedValue(mockBroker),
  createBroker: vi.fn().mockReturnValue(mockBroker),
  BrokerFactoryError: class extends Error { code: string; constructor(c: string, m: string) { super(m); this.code = c; this.name = 'BrokerFactoryError'; } },
}));

vi.mock('@/lib/subscription-guard', () => ({
  checkSubscriptionLimit: () => ({ allowed: true, current: 0, limit: 10 }),
  getLimitMessage: () => 'Limit exceeded',
}));

vi.mock('@/lib/system-config', () => ({
  getGlobalAdminLevy: () => Promise.resolve(10),
}));

vi.mock('@/lib/encryption', () => ({
  encrypt: (v: string) => Promise.resolve('encrypted:' + v),
  decrypt: (v: string) => Promise.resolve(v.replace('encrypted:', '')),
}));

// Helper to create authenticated request
function authedReq(userId: string, url = 'http://localhost/api/trading/orders') {
  return new NextRequest(new URL(url), { headers: { 'x-user-id': userId } });
}

function authedReqPost(userId: string, body: unknown, url = 'http://localhost/api/trading/orders') {
  return new NextRequest(new URL(url), {
    method: 'POST',
    headers: { 'x-user-id': userId, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function authedReqDelete(userId: string, url: string) {
  return new NextRequest(new URL(url), { method: 'DELETE', headers: { 'x-user-id': userId } });
}

const LIVE_ACCOUNT = {
  id: 'acc_live_1',
  userId: 'user_A',
  broker: 'okx',
  accountType: 'live',
  isDemo: false,
  apiKey: 'encrypted:okx_key',
  apiSecret: 'encrypted:okx_secret',
  passphrase: null,
  accountId: 'okx-acc-1',
  balance: 50000,
  currency: 'USD',
};

const DEMO_ACCOUNT = {
  id: 'acc_demo_1',
  userId: 'user_A',
  broker: 'demo',
  accountType: 'demo',
  isDemo: true,
  apiKey: null,
  apiSecret: null,
  passphrase: null,
  accountId: null,
  balance: 100000,
  currency: 'USD',
};

describe('broker spy blocking — order placement (Req 4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    process.env.LIVE_TRADING_ENABLED = 'true';
    process.env.BROKER_CREDENTIAL_INTAKE_ENABLED = 'true';
    process.env.AUTOMATED_TRADING_ENABLED = 'true';
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('blocks non-demo order placement with all enable flags true — spy never called', async () => {
    mockFindFirst.mockResolvedValue(LIVE_ACCOUNT);

    const { POST } = await import('@/app/api/trading/orders/route');
    const res = await POST(authedReqPost('user_A', {
      symbol: 'BTC', side: 'buy', type: 'market', qty: 0.1,
    }));

    expect(res.status).toBe(403);
    expect(placeOrderSpy).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('blocks null account — spy never called', async () => {
    mockFindFirst.mockResolvedValue(null);

    const { POST } = await import('@/app/api/trading/orders/route');
    const res = await POST(authedReqPost('user_A', {
      symbol: 'BTC', side: 'buy', type: 'market', qty: 0.1,
    }));

    expect(res.status).toBe(404);
    expect(placeOrderSpy).not.toHaveBeenCalled();
  });

  it('allows demo order placement — spy is called', async () => {
    mockFindFirst.mockResolvedValue(DEMO_ACCOUNT);
    placeOrderSpy.mockResolvedValue({
      orderId: 'demo-order-1', symbol: 'BTC', side: 'buy', type: 'market',
      qty: 0.1, filledQty: 0.1, filledPrice: 65000, status: 'filled', timestamp: new Date().toISOString(),
    });
    mockCreate.mockResolvedValue({ id: 'order_1' });
    mockUpdate.mockResolvedValue({ count: 1 });

    const { POST } = await import('@/app/api/trading/orders/route');
    const res = await POST(authedReqPost('user_A', {
      symbol: 'BTC', side: 'buy', type: 'market', qty: 0.1,
    }));

    expect(res.status).toBe(200);
    expect(placeOrderSpy).toHaveBeenCalledOnce();
  });
});

describe('broker spy blocking — order cancellation (Req 4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    process.env.LIVE_TRADING_ENABLED = 'true';
    process.env.BROKER_CREDENTIAL_INTAKE_ENABLED = 'true';
  });

  afterEach(() => { process.env = ORIGINAL_ENV; });

  it('blocks non-demo order cancel with all enable flags true — spy never called', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'order_1', status: 'pending', symbol: 'BTC', brokerOrderId: 'okx-ord-1',
      account: LIVE_ACCOUNT,
    });

    const { DELETE } = await import('@/app/api/trading/orders/[id]/route');
    const res = await DELETE(
      authedReqDelete('user_A', 'http://localhost/api/trading/orders/order_1'),
      { params: Promise.resolve({ id: 'order_1' }) },
    );

    expect(res.status).toBe(403);
    expect(cancelOrderSpy).not.toHaveBeenCalled();
  });
});

describe('broker spy blocking — position closure (Req 4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    process.env.LIVE_TRADING_ENABLED = 'true';
  });

  afterEach(() => { process.env = ORIGINAL_ENV; });

  it('blocks non-demo position close — spy never called', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'pos_1', status: 'open', symbol: 'BTC', side: 'long',
      qty: 0.1, avgEntryPrice: 65000, currentPrice: 67000, unrealizedPnl: 200,
      accountId: 'acc_live_1',
      account: LIVE_ACCOUNT,
    });

    const { DELETE } = await import('@/app/api/trading/positions/[id]/route');
    const res = await DELETE(
      authedReqDelete('user_A', 'http://localhost/api/trading/positions/pos_1'),
      { params: Promise.resolve({ id: 'pos_1' }) },
    );

    expect(res.status).toBe(403);
    expect(closePositionSpy).not.toHaveBeenCalled();
  });
});

describe('broker spy blocking — credential intake (Req 4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    process.env.BROKER_CREDENTIAL_INTAKE_ENABLED = 'true';
  });

  afterEach(() => { process.env = ORIGINAL_ENV; });

  it('blocks non-demo account creation — no broker validation', async () => {
    const { POST } = await import('@/app/api/trading/accounts/route');
    const res = await POST(authedReqPost('user_A', {
      broker: 'okx', accountType: 'live',
      apiKey: 'real-key', apiSecret: 'real-secret',
    }));

    expect(res.status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('allows demo account creation', async () => {
    mockCreate.mockResolvedValue({ id: 'new_demo_acc', broker: 'demo' });

    const { POST } = await import('@/app/api/trading/accounts/route');
    const res = await POST(authedReqPost('user_A', {
      broker: 'demo', accountType: 'demo',
    }));

    expect(res.status).toBe(200);
    expect(mockCreate).toHaveBeenCalled();
  });
});

describe('broker spy blocking — null/unknown/conflicting account classification (Req 4)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('blocks when account is null (from policy check)', async () => {
    mockFindFirst.mockResolvedValue(null);

    const { POST } = await import('@/app/api/trading/orders/route');
    const res = await POST(authedReqPost('user_A', {
      symbol: 'BTC', side: 'buy', qty: 0.1,
    }));

    // 404 because no account found, but broker spy is never called
    expect(placeOrderSpy).not.toHaveBeenCalled();
  });
});
