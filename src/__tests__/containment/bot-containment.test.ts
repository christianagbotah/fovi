// ============================================================
// Bot Containment Tests (Task 10b-2)
// Verify bots cannot be enabled/running on non-demo accounts:
//   - bots POST with non-demo → created with enabled:false, status:'stopped'
//   - bots toggle POST to enable on non-demo → 403 PHASE1_LIVE_TRADING_DISABLED
//   - bots PUT on non-demo trying enabled:true → stays disabled
//   - auto-trade PUT with enabled:true on non-demo → 403
//   - engine/bots GET filters to only demo-account bots
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const ORIGINAL_ENV = process.env;

// ── Mock DB ──
const mockFindFirst = vi.fn();
const mockFindUnique = vi.fn();
const mockFindMany = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

vi.mock('@/lib/db', () => ({
  db: {
    tradingAccount: { findFirst: mockFindFirst, findMany: mockFindMany, update: mockUpdate },
    bot: { findFirst: mockFindFirst, findMany: mockFindMany, findUnique: mockFindUnique, create: mockCreate, update: mockUpdate, delete: mockDelete },
    botConfig: { findFirst: mockFindFirst, create: mockCreate, update: mockUpdate },
  },
  hasModel: (m: string) => ['tradingAccount', 'bot', 'botConfig'].includes(m),
}));

vi.mock('@/lib/broker/factory', () => ({
  createBrokerFromAccount: vi.fn().mockResolvedValue({
    getPositions: vi.fn().mockResolvedValue([]),
    getAccountInfo: vi.fn().mockResolvedValue({ accountId: 'x', balance: 10000, currency: 'USD', buyingPower: 10000, dayPnl: 0 }),
  }),
  BrokerFactoryError: class extends Error { code: string; constructor(c: string, m: string) { super(m); this.code = c; this.name = 'BrokerFactoryError'; } },
}));

vi.mock('@/lib/subscription-guard', () => ({
  checkSubscriptionLimit: () => ({ allowed: true, current: 0, limit: 10 }),
  getLimitMessage: () => 'Limit exceeded',
}));

vi.mock('@/lib/system-config', () => ({
  getGlobalAdminLevy: () => Promise.resolve(10),
}));

vi.mock('@/lib/demo-sltp-store', () => ({
  loadDemoPositionSLTP: () => new Map(),
  saveDemoPositionSLTP: () => {},
}));

vi.mock('@/lib/trading-policy', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    enforceInternalAuth: () => null,
  };
});

vi.mock('uuid', () => ({
  v4: () => 'test-uuid-00000000-0000-4000-8000-000000000000',
}));

// ── Helpers ──
function authedReq(method: string, url: string, body?: unknown, userId = 'user_A') {
  return new NextRequest(new URL(url), {
    method,
    headers: { 'x-user-id': userId, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function internalAuthedReq(method: string, url: string, body?: unknown, userId = 'user_A') {
  return new NextRequest(new URL(url), {
    method,
    headers: { 'x-user-id': userId, 'x-internal-service-secret': 'test-secret-key', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

// ── Account fixtures ──
const LIVE_ACCOUNT = {
  id: 'acc_live_1', userId: 'user_A', broker: 'okx', accountType: 'live',
  isDemo: false, balance: 50000,
};

const DEMO_ACCOUNT = {
  id: 'acc_demo_1', userId: 'user_A', broker: 'demo', accountType: 'demo',
  isDemo: true, balance: 100000,
};

// ================================================================
// POST /api/trading/bots — bot creation
// ================================================================
describe('bot containment — POST /api/trading/bots', () => {
  beforeEach(() => { vi.clearAllMocks(); process.env = { ...ORIGINAL_ENV }; });
  afterEach(() => { process.env = ORIGINAL_ENV; });

  it('non-demo account → bot created with enabled:false, status:stopped (even if body says true)', async () => {
    mockFindFirst.mockResolvedValue(LIVE_ACCOUNT);
    mockCreate.mockImplementation(async (args: any) => ({ id: 'bot_new_1', ...args.data }));

    const { POST } = await import('@/app/api/trading/bots/route');
    const res = await POST(authedReq('POST', 'http://localhost/api/trading/bots', {
      name: 'My Bot', strategy: 'momentum', symbols: 'BTC',
      enabled: true, status: 'running',
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enabled).toBe(false);
    expect(body.status).toBe('stopped');

    const createArgs = mockCreate.mock.calls[0][0] as any;
    expect(createArgs.data.enabled).toBe(false);
    expect(createArgs.data.status).toBe('stopped');
  });

  it('demo account → bot can be created with enabled:true if requested', async () => {
    mockFindFirst.mockResolvedValue(DEMO_ACCOUNT);
    mockCreate.mockImplementation(async (args: any) => ({ id: 'bot_new_2', ...args.data }));

    const { POST } = await import('@/app/api/trading/bots/route');
    const res = await POST(authedReq('POST', 'http://localhost/api/trading/bots', {
      name: 'Demo Bot', strategy: 'momentum', symbols: 'BTC', enabled: true,
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enabled).toBe(true);
  });

  it('demo account with enabled not specified → defaults to false', async () => {
    mockFindFirst.mockResolvedValue(DEMO_ACCOUNT);
    mockCreate.mockImplementation(async (args: any) => ({ id: 'bot_new_3', ...args.data }));

    const { POST } = await import('@/app/api/trading/bots/route');
    const res = await POST(authedReq('POST', 'http://localhost/api/trading/bots', { name: 'Demo Bot 2' }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enabled).toBe(false);
  });
});

// ================================================================
// POST /api/trading/bots/[id]/toggle — enable/disable toggle
// ================================================================
describe('bot containment — POST /api/trading/bots/[id]/toggle', () => {
  beforeEach(() => { vi.clearAllMocks(); process.env = { ...ORIGINAL_ENV }; });
  afterEach(() => { process.env = ORIGINAL_ENV; });

  it('toggle to enable on non-demo account → 403 PHASE1_LIVE_TRADING_DISABLED', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'bot_1', userId: 'user_A', enabled: false, status: 'stopped',
      account: LIVE_ACCOUNT,
    });

    const { POST } = await import('@/app/api/trading/bots/[id]/toggle/route');
    const res = await POST(
      authedReq('POST', 'http://localhost/api/trading/bots/bot_1/toggle'),
      { params: Promise.resolve({ id: 'bot_1' }) },
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('PHASE1_LIVE_TRADING_DISABLED');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('toggle to disable on non-demo account → allowed (safe operation)', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'bot_2', userId: 'user_A', enabled: true, status: 'running',
      account: LIVE_ACCOUNT,
    });
    mockUpdate.mockResolvedValue({
      id: 'bot_2', userId: 'user_A', enabled: false, status: 'stopped',
    });

    const { POST } = await import('@/app/api/trading/bots/[id]/toggle/route');
    const res = await POST(
      authedReq('POST', 'http://localhost/api/trading/bots/bot_2/toggle'),
      { params: Promise.resolve({ id: 'bot_2' }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enabled).toBe(false);
    expect(body.status).toBe('stopped');
  });

  it('toggle to enable on demo account → allowed', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'bot_3', userId: 'user_A', enabled: false, status: 'stopped',
      account: DEMO_ACCOUNT,
    });
    mockUpdate.mockResolvedValue({
      id: 'bot_3', userId: 'user_A', enabled: true, status: 'running',
    });

    const { POST } = await import('@/app/api/trading/bots/[id]/toggle/route');
    const res = await POST(
      authedReq('POST', 'http://localhost/api/trading/bots/bot_3/toggle'),
      { params: Promise.resolve({ id: 'bot_3' }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enabled).toBe(true);
    expect(body.status).toBe('running');
  });
});

// ================================================================
// PUT /api/trading/bots/[id] — bot update
// ================================================================
describe('bot containment — PUT /api/trading/bots/[id]', () => {
  beforeEach(() => { vi.clearAllMocks(); process.env = { ...ORIGINAL_ENV }; });
  afterEach(() => { process.env = ORIGINAL_ENV; });

  it('non-demo account with running bot → force disabled/stopped on update', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'bot_5', userId: 'user_A', enabled: true, status: 'running',
      name: 'Live Bot', account: LIVE_ACCOUNT,
    });
    mockUpdate.mockImplementation(async (args: any) => ({
      id: 'bot_5', ...args.data,
    }));

    const { PUT } = await import('@/app/api/trading/bots/[id]/route');
    const res = await PUT(
      authedReq('PUT', 'http://localhost/api/trading/bots/bot_5', { name: 'Renamed' }),
      { params: Promise.resolve({ id: 'bot_5' }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enabled).toBe(false);
    expect(body.status).toBe('stopped');

    // Verify update was called with forced values
    const updateCallArgs = mockUpdate.mock.calls[0][0] as any;
    expect(updateCallArgs.data.enabled).toBe(false);
    expect(updateCallArgs.data.status).toBe('stopped');
  });
});

// ================================================================
// PUT /api/trading/auto-trade — auto-trade enable
// ================================================================
describe('bot containment — PUT /api/trading/auto-trade', () => {
  beforeEach(() => { vi.clearAllMocks(); process.env = { ...ORIGINAL_ENV }; });
  afterEach(() => { process.env = ORIGINAL_ENV; });

  it('enabled:true on non-demo account → 403 PHASE1_LIVE_TRADING_DISABLED', async () => {
    mockFindFirst.mockResolvedValue(LIVE_ACCOUNT);

    const { PUT } = await import('@/app/api/trading/auto-trade/route');
    const res = await PUT(
      authedReq('PUT', 'http://localhost/api/trading/auto-trade', { enabled: true }),
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('PHASE1_LIVE_TRADING_DISABLED');
  });

  it('enabled:false on non-demo account → allowed', async () => {
    mockFindFirst.mockResolvedValue(LIVE_ACCOUNT);
    mockUpdate.mockResolvedValue({
      id: 'cfg_1', accountId: 'acc_live_1', enabled: false, status: 'stopped',
    });

    const { PUT } = await import('@/app/api/trading/auto-trade/route');
    const res = await PUT(
      authedReq('PUT', 'http://localhost/api/trading/auto-trade', { enabled: false }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enabled).toBe(false);
  });

  it('enabled:true on demo account → allowed', async () => {
    mockFindFirst.mockResolvedValue(DEMO_ACCOUNT);
    mockUpdate.mockResolvedValue({
      id: 'cfg_2', accountId: 'acc_demo_1', enabled: true, status: 'running',
    });

    const { PUT } = await import('@/app/api/trading/auto-trade/route');
    const res = await PUT(
      authedReq('PUT', 'http://localhost/api/trading/auto-trade', { enabled: true }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enabled).toBe(true);
  });
});

// ================================================================
// GET /api/trading/engine/bots — filters demo-account bots only
// ================================================================
describe('bot containment — GET /api/trading/engine/bots', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    process.env.INTERNAL_SERVICE_SECRET = 'test-secret-key';
  });
  afterEach(() => { process.env = ORIGINAL_ENV; });

  it('filters to only explicitly demo-account bots (live-account bots excluded)', async () => {
    mockFindMany.mockResolvedValue([
      {
        id: 'bot_demo_A', enabled: true, status: 'running',
        account: { id: 'acc_demo_1', broker: 'demo', accountType: 'demo', isDemo: true, balance: 100000, isActive: true },
      },
      {
        id: 'bot_live_B', enabled: true, status: 'running',
        account: { id: 'acc_live_1', broker: 'okx', accountType: 'live', isDemo: false, balance: 50000, isActive: true },
      },
      {
        id: 'bot_ambiguous_C', enabled: true, status: 'running',
        account: { id: 'acc_amb_1', broker: 'demo', accountType: 'live', isDemo: null, balance: 5000, isActive: true },
      },
    ]);

    const { GET } = await import('@/app/api/trading/engine/bots/route');
    const res = await GET(internalAuthedReq('GET', 'http://localhost/api/trading/engine/bots'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('bot_demo_A');
  });

  it('returns empty when no bots have explicitly demo accounts', async () => {
    mockFindMany.mockResolvedValue([
      {
        id: 'bot_live_X', enabled: true, status: 'running',
        account: { id: 'acc_live_2', broker: 'binance', accountType: 'live', isDemo: false, balance: 50000, isActive: true },
      },
    ]);

    const { GET } = await import('@/app/api/trading/engine/bots/route');
    const res = await GET(internalAuthedReq('GET', 'http://localhost/api/trading/engine/bots'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(0);
  });
});
