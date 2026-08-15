// ============================================================
// tenant-scoped-predicates.test.ts — CR4.1
// Tests that DB queries use tenant predicates (userId in where clause).
// We mock db methods to spy on their call arguments and verify tenant scoping.
// Route handlers are REAL — only db is mocked.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Use vi.hoisted to define mock functions accessible inside vi.mock
const {
  mockBotFindFirst,
  mockBotUpdate,
  mockBotDeleteMany,
  mockBotFindUnique,
  mockOrderFindFirst,
  mockPositionFindFirst,
  mockPositionUpdate,
} = vi.hoisted(() => ({
  mockBotFindFirst: vi.fn(),
  mockBotUpdate: vi.fn(),
  mockBotDeleteMany: vi.fn(),
  mockBotFindUnique: vi.fn(),
  mockOrderFindFirst: vi.fn(),
  mockPositionFindFirst: vi.fn(),
  mockPositionUpdate: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    bot: {
      findFirst: mockBotFindFirst,
      update: mockBotUpdate,
      deleteMany: mockBotDeleteMany,
      findUnique: mockBotFindUnique,
    },
    order: {
      findFirst: mockOrderFindFirst,
      update: vi.fn(),
    },
    position: {
      findFirst: mockPositionFindFirst,
      update: mockPositionUpdate,
    },
  },
  hasModel: vi.fn(() => true),
  isDbAvailable: vi.fn(() => true),
}));

vi.mock('@/lib/get-user-id', () => ({
  getUserIdSync: vi.fn(() => 'user-abc'),
  getUserId: vi.fn(() => Promise.resolve('user-abc')),
  AuthRequiredError: class extends Error {
    constructor() { super('Authentication required.'); this.name = 'AuthRequiredError'; }
  },
  authRequiredResponse: vi.fn(() => new Response(JSON.stringify({ error: 'Authentication required.' }), { status: 401 })),
  getUserIdOrNull: vi.fn(() => 'user-abc'),
}));

vi.mock('@/lib/trading-policy', () => ({
  isExplicitlyDemo: vi.fn(() => true),
  CONTAINMENT_CODES: { PHASE1_LIVE_TRADING_DISABLED: 'PHASE1_LIVE_TRADING_DISABLED', LIVE_BLOCKED: 'LIVE_TRADING_DISABLED', CONFIGURATION_REQUIRED: 'CONFIGURATION_REQUIRED' },
  logSecurityEvent: vi.fn(),
  enforceLiveTradingPolicy: vi.fn(() => ({ blocked: false })),
  DEMO_PROVENANCE_HEADER: {},
}));

vi.mock('@/lib/subscription-guard', () => ({
  checkSubscriptionLimit: vi.fn(() => Promise.resolve({ allowed: true, current: 0, limit: 10 })),
  getLimitMessage: vi.fn(() => 'limit'),
}));

vi.mock('@/lib/broker/factory', () => ({
  createBrokerFromAccount: vi.fn(() => Promise.resolve({
    closePosition: vi.fn(() => Promise.resolve({ orderId: 'ord-1', symbol: 'BTC', side: 'sell', type: 'market', qty: 1, filledQty: 1, filledPrice: 67000, status: 'filled', timestamp: new Date().toISOString() })),
    cancelOrder: vi.fn(() => Promise.resolve()),
  })),
  BrokerFactoryError: class extends Error { code: string; constructor(c: string, m: string) { super(m); this.name = 'BrokerFactoryError'; this.code = c; } },
}));

vi.mock('@/lib/system-config', () => ({
  getGlobalAdminLevy: vi.fn(() => Promise.resolve(0)),
}));

vi.mock('@/lib/demo-sltp-store', () => ({
  saveDemoPositionSLTP: vi.fn(),
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'uuid-123'),
}));

vi.spyOn(console, 'warn').mockImplementation(() => {});

import { GET as botGet, PUT as botPut, DELETE as botDelete } from '@/app/api/trading/bots/[id]/route';
import { DELETE as orderDelete } from '@/app/api/trading/orders/[id]/route';
import { PATCH as positionPatch } from '@/app/api/trading/positions/[id]/route';

function makeRequest(url: string, userId = 'user-abc') {
  return new Request(`http://localhost${url}`, {
    headers: { 'x-user-id': userId },
  });
}

describe('Bot GET — tenant-scoped predicate', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('findFirst called with {id, userId} in where clause for owned resource', async () => {
    mockBotFindFirst.mockResolvedValue({ id: 'bot-1', userId: 'user-abc', name: 'Test Bot' });

    const req = makeRequest('/api/trading/bots/bot-1');
    const res = await botGet(req, { params: Promise.resolve({ id: 'bot-1' }) });

    expect(mockBotFindFirst).toHaveBeenCalledTimes(1);
    expect(mockBotFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'bot-1', userId: 'user-abc' } }),
    );
  });

  it('wrong tenant → 404 (not 403)', async () => {
    mockBotFindFirst.mockResolvedValue(null);

    const req = makeRequest('/api/trading/bots/bot-1', 'user-abc');
    const res = await botGet(req, { params: Promise.resolve({ id: 'bot-1' }) });
    const data = await res.json();

    expect(res.status).toBe(404);
    expect(data.error).toContain('not found');
  });
});

describe('Bot PUT — tenant-scoped predicate', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('findFirst called with {id, userId} in where clause', async () => {
    mockBotFindFirst.mockResolvedValue({ id: 'bot-1', userId: 'user-abc', enabled: false, status: 'stopped', account: null });
    mockBotUpdate.mockResolvedValue({ id: 'bot-1', userId: 'user-abc', name: 'Updated' });

    const jsonReq = new Request('http://localhost/api/trading/bots/bot-1', {
      headers: { 'x-user-id': 'user-abc', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Updated Bot' }),
      method: 'PUT',
    });
    const res = await botPut(jsonReq, { params: Promise.resolve({ id: 'bot-1' }) });

    expect(mockBotFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'bot-1', userId: 'user-abc' } }),
    );
  });
});

describe('Bot DELETE — tenant-scoped predicate', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('deleteMany called with {id, userId} in where clause', async () => {
    mockBotDeleteMany.mockResolvedValue({ count: 1 });

    const req = makeRequest('/api/trading/bots/bot-1');
    const res = await botDelete(req, { params: Promise.resolve({ id: 'bot-1' }) });

    expect(mockBotDeleteMany).toHaveBeenCalledWith({ where: { id: 'bot-1', userId: 'user-abc' } });
  });

  it('wrong-tenant deleteMany returns count:0 → 404', async () => {
    mockBotDeleteMany.mockResolvedValue({ count: 0 });

    const req = makeRequest('/api/trading/bots/bot-1', 'user-other');
    const res = await botDelete(req, { params: Promise.resolve({ id: 'bot-1' }) });
    const data = await res.json();

    expect(res.status).toBe(404);
  });
});

describe('Order DELETE — tenant-scoped predicate via account relation', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('findFirst called with {id, account: {userId}} in where clause', async () => {
    mockOrderFindFirst.mockResolvedValue({
      id: 'ord-1',
      symbol: 'BTC',
      status: 'pending',
      account: { userId: 'user-abc', broker: 'demo', accountType: 'demo', isDemo: true },
    });

    const req = makeRequest('/api/trading/orders/ord-1');
    const res = await orderDelete(req, { params: Promise.resolve({ id: 'ord-1' }) });

    expect(mockOrderFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ord-1', account: { userId: 'user-abc' } },
      }),
    );
  });

  it('wrong tenant → 404', async () => {
    mockOrderFindFirst.mockResolvedValue(null);

    const req = makeRequest('/api/trading/orders/ord-1', 'user-other');
    const res = await orderDelete(req, { params: Promise.resolve({ id: 'ord-1' }) });
    const data = await res.json();

    expect(res.status).toBe(404);
  });
});

describe('Position PATCH — tenant-scoped predicate via account relation', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('findFirst called with {id, status: open, account: {userId}}', async () => {
    mockPositionFindFirst.mockResolvedValue({
      id: 'pos-1',
      symbol: 'BTC',
      status: 'open',
      account: { userId: 'user-abc', broker: 'demo', accountType: 'demo', isDemo: true },
    });

    const jsonReq = new Request('http://localhost/api/trading/positions/pos-1', {
      headers: { 'x-user-id': 'user-abc', 'content-type': 'application/json' },
      body: JSON.stringify({ stopLoss: 60000 }),
      method: 'PATCH',
    });
    const res = await positionPatch(jsonReq, { params: Promise.resolve({ id: 'pos-1' }) });

    expect(mockPositionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pos-1', status: 'open', account: { userId: 'user-abc' } },
      }),
    );
  });

  it('wrong tenant → 404', async () => {
    mockPositionFindFirst.mockResolvedValue(null);

    const jsonReq = new Request('http://localhost/api/trading/positions/pos-1', {
      headers: { 'x-user-id': 'user-other', 'content-type': 'application/json' },
      body: JSON.stringify({ stopLoss: 60000 }),
      method: 'PATCH',
    });
    const res = await positionPatch(jsonReq, { params: Promise.resolve({ id: 'pos-1' }) });
    const data = await res.json();

    expect(res.status).toBe(404);
  });
});

describe('Uniform 404 for missing AND wrong-tenant resources', () => {
  it('bot GET with correct userId but missing resource → 404', async () => {
    mockBotFindFirst.mockResolvedValue(null);
    const req = makeRequest('/api/trading/bots/nonexistent', 'user-abc');
    const res = await botGet(req, { params: Promise.resolve({ id: 'nonexistent' }) });
    expect(res.status).toBe(404);
  });

  it('bot GET with wrong userId → 404 (NOT 403)', async () => {
    mockBotFindFirst.mockResolvedValue(null);
    const req = makeRequest('/api/trading/bots/bot-1', 'user-other');
    const res = await botGet(req, { params: Promise.resolve({ id: 'bot-1' }) });
    expect(res.status).toBe(404);
    expect(res.status).not.toBe(403);
  });
});
