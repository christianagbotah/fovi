// ============================================================
// cr43b-auth-tenant.test.ts — CR4.3B Correction Round 1
// Auth-first adversarial tests + tenant-scoped mutation predicate tests.
// All route handlers are REAL; only dependencies (db, config, etc.) are mocked.
//
// ZERO false-positive patterns:
//   - No expect(true).toBe(true)
//   - No conditional assertion branches (if calls.length > 0 ... else pass)
//   - Every "NOT called" claim uses actual .not.toHaveBeenCalled()
//   - Every required boundary is FORCED to execute
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── All mock functions must be in vi.hoisted to be accessible in vi.mock ──

const {
  mockGetUserId, mockGetUserIdSync, AuthRequiredErrorCls, mockAuthRequiredResponse,
  mockGetGlobalAdminLevy, mockCheckSubscriptionLimit,
  mockGetDemoCandles, mockRunBacktest, mockBacktestCreate,
  mockGenerateSignals,
  mockBrokerGetPositions,
  mockTradingAccountFindFirst, mockBotConfigFindFirst, mockBotConfigCreate,
  mockBotConfigFindMany, mockBotConfigDeleteMany, mockBotConfigUpdateMany,
  mockTradingAccountUpdateMany, mockOrderFindMany,
  mockPositionFindFirst, mockPositionUpdateMany,
  mockBotFindFirst, mockBotUpdateMany,
  mockDb,
} = vi.hoisted(() => {
  const mockGetUserId = vi.fn();
  const mockGetUserIdSync = vi.fn();
  const AuthRequiredErrorCls = class extends Error {
    constructor() { super('Authentication required.'); this.name = 'AuthRequiredError'; }
  };
  const mockAuthRequiredResponse = vi.fn(() => new Response(
    JSON.stringify({ error: 'Authentication required.', code: 'AUTH_REQUIRED', remediationPhase: 'containment' }),
    { status: 401 },
  ));

  // System config / subscription mocks (exposed for NOT-called assertions)
  const mockGetGlobalAdminLevy = vi.fn();
  const mockCheckSubscriptionLimit = vi.fn();

  // Demo / engine mocks (exposed for NOT-called assertions)
  const mockGetDemoCandles = vi.fn();
  const mockGenerateSignals = vi.fn();
  const mockRunBacktest = vi.fn();
  const mockBacktestCreate = vi.fn();

  // Broker mock (exposed for positions sync test)
  const mockBrokerGetPositions = vi.fn();

  // DB mocks
  const mockTradingAccountFindFirst = vi.fn();
  const mockBotConfigFindFirst = vi.fn();
  const mockBotConfigCreate = vi.fn();
  const mockBotConfigFindMany = vi.fn();
  const mockBotConfigDeleteMany = vi.fn();
  const mockBotConfigUpdateMany = vi.fn();
  const mockTradingAccountUpdateMany = vi.fn();
  const mockOrderFindMany = vi.fn();
  const mockPositionFindFirst = vi.fn();
  const mockPositionUpdateMany = vi.fn();
  const mockBotFindFirst = vi.fn();
  const mockBotUpdateMany = vi.fn();

  const mockDb = {
    tradingAccount: {
      findFirst: mockTradingAccountFindFirst,
      updateMany: mockTradingAccountUpdateMany,
      findMany: vi.fn(() => Promise.resolve([])),
    },
    botConfig: {
      findFirst: mockBotConfigFindFirst,
      create: mockBotConfigCreate,
      findMany: mockBotConfigFindMany,
      deleteMany: mockBotConfigDeleteMany,
      updateMany: mockBotConfigUpdateMany,
    },
    bot: {
      findFirst: mockBotFindFirst,
      updateMany: mockBotUpdateMany,
      deleteMany: vi.fn(() => Promise.resolve({ count: 1 })),
      findUnique: vi.fn(),
    },
    position: {
      findFirst: mockPositionFindFirst,
      updateMany: mockPositionUpdateMany,
      upsert: vi.fn(() => Promise.resolve({})),
      create: vi.fn(() => Promise.resolve({})),
      findMany: vi.fn(() => Promise.resolve([])),
    },
    order: {
      findMany: mockOrderFindMany,
      create: vi.fn(() => Promise.resolve({ id: 'ord-1' })),
    },
    tradingSignal: {
      findMany: vi.fn(() => Promise.resolve([])),
    },
    backtest: {
      create: mockBacktestCreate,
    },
    subscription: { findFirst: vi.fn() },
    subscriptionPlan: { findFirst: vi.fn() },
    systemConfig: { findUnique: vi.fn(), upsert: vi.fn() },
  };

  return {
    mockGetUserId, mockGetUserIdSync, AuthRequiredErrorCls, mockAuthRequiredResponse,
    mockGetGlobalAdminLevy, mockCheckSubscriptionLimit,
    mockGetDemoCandles, mockRunBacktest, mockBacktestCreate,
    mockGenerateSignals,
    mockBrokerGetPositions,
    mockTradingAccountFindFirst, mockBotConfigFindFirst, mockBotConfigCreate,
    mockBotConfigFindMany, mockBotConfigDeleteMany, mockBotConfigUpdateMany,
    mockTradingAccountUpdateMany, mockOrderFindMany,
    mockPositionFindFirst, mockPositionUpdateMany,
    mockBotFindFirst, mockBotUpdateMany,
    mockDb,
  };
});

// ── Mock modules ──

vi.mock('@/lib/db', () => ({
  db: mockDb,
  hasModel: vi.fn(() => true),
  isDbAvailable: vi.fn(() => true),
  safeDbQuery: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  DEMO_USER_ID: '__demo__',
}));

vi.mock('@/lib/get-user-id', () => ({
  getUserId: mockGetUserId,
  getUserIdSync: mockGetUserIdSync,
  AuthRequiredError: AuthRequiredErrorCls,
  authRequiredResponse: mockAuthRequiredResponse,
  getUserIdOrNull: vi.fn(() => null),
}));

vi.mock('@/lib/trading-policy', () => ({
  isExplicitlyDemo: vi.fn(() => true),
  CONTAINMENT_CODES: {
    AUTH_REQUIRED: 'AUTH_REQUIRED',
    PHASE1_LIVE_TRADING_DISABLED: 'PHASE1_LIVE_TRADING_DISABLED',
    LIVE_BLOCKED: 'LIVE_TRADING_DISABLED',
    BROKER_CONNECTION_FAILED: 'BROKER_CONNECTION_FAILED',
  },
  logSecurityEvent: vi.fn(),
  enforceLiveTradingPolicy: vi.fn(() => ({ blocked: false })),
  safeAccountDTO: vi.fn((a: Record<string, unknown>) => a),
  DEMO_PROVENANCE_HEADER: { 'x-environment': 'demo' },
}));

vi.mock('@/lib/subscription-guard', () => ({
  checkSubscriptionLimit: mockCheckSubscriptionLimit,
  getLimitMessage: vi.fn(() => 'limit'),
}));

vi.mock('@/lib/system-config', () => ({
  getGlobalAdminLevy: mockGetGlobalAdminLevy,
  getSystemConfig: vi.fn(() => Promise.resolve(null)),
  invalidateSystemConfigCache: vi.fn(),
}));

vi.mock('@/lib/broker/demo', () => ({
  getDemoCandles: mockGetDemoCandles,
  getAssetType: vi.fn(() => 'crypto'),
  getDemoPrice: vi.fn(() => 50000),
}));

vi.mock('@/lib/ai/signals', () => ({
  generateSignals: mockGenerateSignals,
}));

vi.mock('@/lib/trading-engine', () => ({
  runBacktest: mockRunBacktest,
}));

vi.mock('@/lib/broker/factory', () => ({
  createBrokerFromAccount: vi.fn(() => Promise.resolve({
    closePosition: vi.fn(() => Promise.resolve({ orderId: 'ord-1', status: 'filled' })),
    getPositions: mockBrokerGetPositions,
    placeOrder: vi.fn(() => Promise.resolve({ orderId: 'ord-1', filledQty: 1, filledPrice: 50000, status: 'filled' })),
    getAccountInfo: vi.fn(() => Promise.resolve({ balance: 100000 })),
  })),
  BrokerFactoryError: class extends Error { code: string; constructor(c: string, m: string) { super(m); this.name = 'BrokerFactoryError'; this.code = c; } },
}));

vi.mock('@/lib/demo-sltp-store', () => ({
  saveDemoPositionSLTP: vi.fn(),
  loadDemoPositionSLTP: vi.fn(() => new Map()),
}));

vi.mock('@/lib/encryption', () => ({
  encrypt: (v: string) => Promise.resolve('encrypted:' + v),
  decrypt: (v: string) => Promise.resolve(v.replace('encrypted:', '')),
}));

vi.mock('uuid', () => ({ v4: vi.fn(() => 'uuid-123') }));

vi.spyOn(console, 'warn').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

// Spy on global fetch for signals/generate auth-first proof (item 5)
const fetchSpy = vi.spyOn(globalThis, 'fetch');

// ── Import route handlers AFTER mocks ──

import { GET as autoTradeGet, PUT as autoTradePut } from '@/app/api/trading/auto-trade/route';
import { GET as autoTradeActivityGet } from '@/app/api/trading/auto-trade/activity/route';
import { GET as analyticsGet } from '@/app/api/trading/analytics/route';
import { GET as signalsGet } from '@/app/api/trading/signals/route';
import { POST as signalsGeneratePost } from '@/app/api/trading/signals/generate/route';
import { POST as backtestPost } from '@/app/api/trading/backtest/route';
import { PATCH as accountPatch } from '@/app/api/trading/accounts/[id]/route';
import { PUT as botPut } from '@/app/api/trading/bots/[id]/route';
import { PATCH as positionPatch } from '@/app/api/trading/positions/[id]/route';
import { DELETE as positionDelete } from '@/app/api/trading/positions/[id]/route';
import { GET as positionsGet } from '@/app/api/trading/positions/route';
import { POST as ordersPost } from '@/app/api/trading/orders/route';

function makeRequest(url: string, headers: Record<string, string> = {}, body?: object, method = 'GET') {
  return new NextRequest(`http://localhost${url}`, {
    headers,
    body: body ? JSON.stringify(body) : undefined,
    method,
  });
}

const AUTHED_HEADERS = { 'x-user-id': 'user-abc' };

// ============================================================
// §20: AUTH-FIRST ADVERSARIAL TESTS
// ============================================================

// ── Item 3: auto-trade GET auth-first proof ──
describe('CR4.3B §20A — auto-trade GET unauthenticated: auth BEFORE getGlobalAdminLevy, tradingAccount, botConfig', () => {
  beforeEach(() => { vi.clearAllMocks(); mockGetUserId.mockRejectedValue(new AuthRequiredErrorCls()); });

  it('returns 401; getGlobalAdminLevy NOT called; tradingAccount.findFirst NOT called; botConfig.findFirst NOT called', async () => {
    const req = makeRequest('/api/trading/auto-trade');
    const res = await autoTradeGet(req);
    expect(res.status).toBe(401);
    expect(mockGetGlobalAdminLevy).not.toHaveBeenCalled();
    expect(mockTradingAccountFindFirst).not.toHaveBeenCalled();
    expect(mockBotConfigFindFirst).not.toHaveBeenCalled();
  });
});

// ── Item 4: auto-trade PUT auth-first proof ──
describe('CR4.3B §20B — auto-trade PUT unauthenticated: auth BEFORE all downstream work', () => {
  beforeEach(() => { vi.clearAllMocks(); mockGetUserId.mockRejectedValue(new AuthRequiredErrorCls()); });

  it('returns 401; getGlobalAdminLevy/checkSubscriptionLimit/tradingAccount/botConfig/updateMany/create all NOT called', async () => {
    const req = makeRequest('/api/trading/auto-trade', { 'content-type': 'application/json' }, { enabled: true }, 'PUT');
    const res = await autoTradePut(req);
    expect(res.status).toBe(401);
    expect(mockGetGlobalAdminLevy).not.toHaveBeenCalled();
    expect(mockCheckSubscriptionLimit).not.toHaveBeenCalled();
    expect(mockTradingAccountFindFirst).not.toHaveBeenCalled();
    expect(mockBotConfigFindFirst).not.toHaveBeenCalled();
    expect(mockBotConfigUpdateMany).not.toHaveBeenCalled();
    expect(mockBotConfigCreate).not.toHaveBeenCalled();
  });
});

describe('CR4.3B §20C — analytics GET unauthenticated', () => {
  beforeEach(() => { vi.clearAllMocks(); mockGetUserIdSync.mockImplementation(() => { throw new AuthRequiredErrorCls(); }); });

  it('returns 401, NOT demo analytics', async () => {
    const req = makeRequest('/api/trading/analytics');
    const res = await analyticsGet(req);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.code).toBe('AUTH_REQUIRED');
  });
});

describe('CR4.3B §20D — signals GET unauthenticated', () => {
  beforeEach(() => { vi.clearAllMocks(); mockGetUserId.mockRejectedValue(new AuthRequiredErrorCls()); });

  it('returns 401, NOT 503', async () => {
    const req = makeRequest('/api/trading/signals');
    const res = await signalsGet(req);
    expect(res.status).toBe(401);
    expect(mockTradingAccountFindFirst).not.toHaveBeenCalled();
  });
});

// ── Item 5: signals/generate auth-first proof ──
describe('CR4.3B §20E — signals/generate POST unauthenticated: auth BEFORE fetch, generateSignals', () => {
  beforeEach(() => { vi.clearAllMocks(); mockGetUserId.mockRejectedValue(new AuthRequiredErrorCls()); });

  it('returns 401; global fetch NOT called; generateSignals NOT called', async () => {
    const req = makeRequest('/api/trading/signals/generate', { 'content-type': 'application/json' }, { symbol: 'BTC' }, 'POST');
    const res = await signalsGeneratePost(req);
    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockGenerateSignals).not.toHaveBeenCalled();
  });
});

// ── Item 6: backtest auth-first proof ──
describe('CR4.3B §20F — backtest POST unauthenticated: auth BEFORE getDemoCandles, runBacktest, db.backtest.create', () => {
  beforeEach(() => { vi.clearAllMocks(); mockGetUserId.mockRejectedValue(new AuthRequiredErrorCls()); });

  it('returns 401; getDemoCandles NOT called; runBacktest NOT called; db.backtest.create NOT called', async () => {
    const req = makeRequest('/api/trading/backtest', { 'content-type': 'application/json' }, { symbol: 'BTC' }, 'POST');
    const res = await backtestPost(req);
    expect(res.status).toBe(401);
    expect(mockGetDemoCandles).not.toHaveBeenCalled();
    expect(mockRunBacktest).not.toHaveBeenCalled();
    expect(mockBacktestCreate).not.toHaveBeenCalled();
  });
});

describe('CR4.3B §20G — auto-trade/activity uses centralized auth', () => {
  beforeEach(() => { vi.clearAllMocks(); mockGetUserIdSync.mockImplementation(() => { throw new AuthRequiredErrorCls(); }); });

  it('mock getUserIdSync to reject; even with raw x-user-id header → 401', async () => {
    const req = makeRequest('/api/trading/auto-trade/activity', { 'x-user-id': 'attacker-id' });
    const res = await autoTradeActivityGet(req);
    expect(res.status).toBe(401);
    expect(mockTradingAccountFindFirst).not.toHaveBeenCalled();
    expect(mockOrderFindMany).not.toHaveBeenCalled();
  });
});

// ============================================================
// §21: TENANT-PREDICATE ADVERSARIAL TESTS
// ============================================================

describe('CR4.3B §21A — account PATCH post-read includes { id, userId }', () => {
  beforeEach(() => { vi.clearAllMocks(); mockGetUserIdSync.mockReturnValue('user-abc'); });

  it('post-update findFirst predicate contains userId', async () => {
    mockTradingAccountFindFirst
      .mockResolvedValueOnce({ id: 'acct-1', userId: 'user-abc' })
      .mockResolvedValueOnce({ id: 'acct-1', userId: 'user-abc', label: 'Updated' });
    mockTradingAccountUpdateMany.mockResolvedValue({ count: 1 });

    const req = makeRequest('/api/trading/accounts/acct-1', { ...AUTHED_HEADERS, 'content-type': 'application/json' }, { label: 'Updated' }, 'PATCH');
    const res = await accountPatch(req, { params: Promise.resolve({ id: 'acct-1' }) });

    expect(mockTradingAccountFindFirst).toHaveBeenCalledTimes(2);
    expect(mockTradingAccountFindFirst).toHaveBeenNthCalledWith(2,
      expect.objectContaining({ where: { id: 'acct-1', userId: 'user-abc' } }),
    );
  });
});

describe('CR4.3B §21B — bot PUT post-read includes { id, userId }', () => {
  beforeEach(() => { vi.clearAllMocks(); mockGetUserIdSync.mockReturnValue('user-abc'); });

  it('post-update findFirst predicate contains userId', async () => {
    mockBotFindFirst
      .mockResolvedValueOnce({ id: 'bot-1', userId: 'user-abc', enabled: false, status: 'stopped', account: null })
      .mockResolvedValueOnce({ id: 'bot-1', userId: 'user-abc', name: 'Updated' });
    mockBotUpdateMany.mockResolvedValue({ count: 1 });

    const req = makeRequest('/api/trading/bots/bot-1', { ...AUTHED_HEADERS, 'content-type': 'application/json' }, { name: 'Updated' }, 'PUT');
    const res = await botPut(req, { params: Promise.resolve({ id: 'bot-1' }) });

    expect(mockBotFindFirst).toHaveBeenCalledTimes(2);
    expect(mockBotFindFirst).toHaveBeenNthCalledWith(2,
      expect.objectContaining({ where: { id: 'bot-1', userId: 'user-abc' } }),
    );
  });
});

// ── Item 9: position PATCH all three boundaries ──
describe('CR4.3B §21C — position PATCH: initial lookup, updateMany, and post-update read all tenant-scoped via account', () => {
  beforeEach(() => { vi.clearAllMocks(); mockGetUserIdSync.mockReturnValue('user-abc'); });

  it('asserts all three DB boundaries: findFirst(lookup), updateMany, findFirst(post-read)', async () => {
    const demoAccount = { userId: 'user-abc', broker: 'demo', accountType: 'demo', isDemo: true };

    // Call 1: initial lookup (with status:'open' and include:{account:true})
    // Call 2: post-update read (without status, without include)
    mockPositionFindFirst
      .mockResolvedValueOnce({
        id: 'pos-1', symbol: 'BTC', status: 'open', stopLoss: null, takeProfit: null,
        account: demoAccount,
      })
      .mockResolvedValueOnce({
        id: 'pos-1', symbol: 'BTC', stopLoss: 60000, takeProfit: null,
      });
    mockPositionUpdateMany.mockResolvedValue({ count: 1 });

    const req = makeRequest('/api/trading/positions/pos-1', { ...AUTHED_HEADERS, 'content-type': 'application/json' }, { stopLoss: 60000 }, 'PATCH');
    const res = await positionPatch(req, { params: Promise.resolve({ id: 'pos-1' }) });

    expect(res.status).toBe(200);

    // Boundary 1: initial lookup — { id, status:'open', account: { userId } }
    expect(mockPositionFindFirst).toHaveBeenNthCalledWith(1,
      expect.objectContaining({
        where: { id: 'pos-1', status: 'open', account: { userId: 'user-abc' } },
        include: { account: true },
      }),
    );

    // Boundary 2: updateMany — { id, account: { userId } }
    expect(mockPositionUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pos-1', account: { userId: 'user-abc' } },
      }),
    );

    // Boundary 3: post-update read — { id, account: { userId } }
    expect(mockPositionFindFirst).toHaveBeenNthCalledWith(2,
      expect.objectContaining({
        where: { id: 'pos-1', account: { userId: 'user-abc' } },
      }),
    );
  });
});

describe('CR4.3B §21D — position DELETE related-account mutation includes userId', () => {
  beforeEach(() => { vi.clearAllMocks(); mockGetUserIdSync.mockReturnValue('user-abc'); });

  it('TradingAccount updateMany predicate contains { id, userId }', async () => {
    mockPositionFindFirst.mockResolvedValue({
      id: 'pos-1', symbol: 'BTC', status: 'open', accountId: 'acct-1', avgEntryPrice: 65000,
      currentPrice: 67000, side: 'long', qty: 1,
      account: { userId: 'user-abc', broker: 'demo', accountType: 'demo', isDemo: true, id: 'acct-1' },
    });
    mockPositionUpdateMany.mockResolvedValue({ count: 1 });
    mockTradingAccountUpdateMany.mockResolvedValue({ count: 1 });

    const req = makeRequest('/api/trading/positions/pos-1', AUTHED_HEADERS, {}, 'DELETE');
    const res = await positionDelete(req, { params: Promise.resolve({ id: 'pos-1' }) });

    expect(mockTradingAccountUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'acct-1', userId: 'user-abc' },
      }),
    );
  });
});

// ── Item 2: positions GET sync mutation MUST execute real mutation ──
describe('CR4.3B §21E — positions GET sync: broker returns position, DB finds existing, updateMany executes with { id, accountId }', () => {
  beforeEach(() => { vi.clearAllMocks(); mockGetUserIdSync.mockReturnValue('user-abc'); });

  it('position updateMany is called with exact { id: existing.id, accountId: authenticatedAccount.id }', async () => {
    const authenticatedAccount = {
      id: 'acct-1', userId: 'user-abc', broker: 'demo', accountType: 'demo',
      isDemo: true, balance: 100000,
    };

    mockTradingAccountFindFirst.mockResolvedValue(authenticatedAccount);

    // Broker returns at least one position → triggers sync loop
    mockBrokerGetPositions.mockResolvedValue([{
      symbol: 'BTC', side: 'long', qty: 0.1,
      avgEntryPrice: 65000, currentPrice: 67000, unrealizedPnl: 200,
    }]);

    // DB finds an existing position for this symbol → triggers updateMany branch (NOT create)
    const existingPosition = { id: 'pos-1', accountId: 'acct-1', symbol: 'BTC', status: 'open' };
    mockPositionFindFirst.mockResolvedValue(existingPosition);
    mockPositionUpdateMany.mockResolvedValue({ count: 1 });

    const req = makeRequest('/api/trading/positions', AUTHED_HEADERS);
    const res = await positionsGet(req);

    // updateMany MUST have been called (the sync mutation path was executed)
    expect(mockPositionUpdateMany).toHaveBeenCalledTimes(1);
    expect(mockPositionUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pos-1', accountId: 'acct-1' },
      }),
    );
  });
});

describe('CR4.3B §21F — orders POST lastSyncedAt account mutation includes userId', () => {
  beforeEach(() => { vi.clearAllMocks(); mockGetUserId.mockResolvedValue('user-abc'); });

  it('lastSyncedAt updateMany predicate contains { id, userId }', async () => {
    const acct = { id: 'acct-1', userId: 'user-abc', broker: 'demo', accountType: 'demo', isDemo: true, balance: 100000 };
    mockTradingAccountFindFirst.mockResolvedValue(acct);
    mockTradingAccountUpdateMany.mockResolvedValue({ count: 1 });

    const req = makeRequest('/api/trading/orders', { ...AUTHED_HEADERS, 'content-type': 'application/json' }, {
      symbol: 'BTC', side: 'buy', qty: 0.01,
    }, 'POST');
    const res = await ordersPost(req);

    expect(res.status).toBe(200);
    expect(mockTradingAccountUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'acct-1', userId: 'user-abc' },
      }),
    );
  });
});

describe('CR4.3B §21G — auto-trade BotConfig predicates contain userId', () => {
  beforeEach(() => { vi.clearAllMocks(); mockGetUserId.mockResolvedValue('user-abc'); });

  it('GET findFirst predicate contains userId and accountId', async () => {
    const acct = { id: 'acct-1', userId: 'user-abc', balance: 100000, isDefault: true };
    mockTradingAccountFindFirst.mockResolvedValue(acct);
    mockBotConfigFindFirst.mockResolvedValue({ id: 'cfg-1', userId: 'user-abc', accountId: 'acct-1', totalTrades: 0, winTrades: 0 });
    mockBotConfigFindMany.mockResolvedValue([]);

    const req = makeRequest('/api/trading/auto-trade', AUTHED_HEADERS);
    const res = await autoTradeGet(req);

    expect(mockBotConfigFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-abc', accountId: 'acct-1' },
      }),
    );
  });
});

// ── Item 7: BotConfig duplicate delete test ──
describe('CR4.3B §21G.2 — auto-trade GET duplicate cleanup: deleteMany called with { id: duplicate.id, userId }', () => {
  beforeEach(() => { vi.clearAllMocks(); mockGetUserId.mockResolvedValue('user-abc'); });

  it('when findMany returns >1 config, deleteMany is called for each duplicate with { id, userId }', async () => {
    const acct = { id: 'acct-1', userId: 'user-abc', balance: 100000, isDefault: true };
    mockTradingAccountFindFirst.mockResolvedValue(acct);
    mockGetGlobalAdminLevy.mockResolvedValue(10);

    // findFirst returns the primary config
    mockBotConfigFindFirst.mockResolvedValue({
      id: 'cfg-1', userId: 'user-abc', accountId: 'acct-1', totalTrades: 0, winTrades: 0,
    });

    // findMany returns TWO configs → triggers duplicate cleanup loop
    mockBotConfigFindMany.mockResolvedValue([
      { id: 'cfg-1', userId: 'user-abc', accountId: 'acct-1', createdAt: new Date('2024-01-02') },
      { id: 'cfg-2', userId: 'user-abc', accountId: 'acct-1', createdAt: new Date('2024-01-01') },
    ]);
    mockBotConfigDeleteMany.mockResolvedValue({ count: 1 });

    const req = makeRequest('/api/trading/auto-trade', AUTHED_HEADERS);
    const res = await autoTradeGet(req);

    expect(res.status).toBe(200);
    // deleteMany MUST have been called for the duplicate (cfg-2)
    expect(mockBotConfigDeleteMany).toHaveBeenCalledTimes(1);
    expect(mockBotConfigDeleteMany).toHaveBeenCalledWith({
      where: { id: 'cfg-2', userId: 'user-abc' },
    });
  });
});

// ── Item 8: BotConfig PUT post-read test ──
describe('CR4.3B §21G.3 — auto-trade PUT: updateMany where + post-read findFirst where both contain { id, userId }', () => {
  beforeEach(() => { vi.clearAllMocks(); mockGetUserId.mockResolvedValue('user-abc'); });

  it('updateMany predicate has { id: existingConfig.id, userId }; subsequent findFirst has { id: existingConfig.id, userId }', async () => {
    const acct = { id: 'acct-1', userId: 'user-abc', balance: 100000, isDefault: true };
    mockTradingAccountFindFirst.mockResolvedValue(acct);
    mockGetGlobalAdminLevy.mockResolvedValue(10);

    const existingConfig = { id: 'cfg-1', userId: 'user-abc', accountId: 'acct-1', totalTrades: 0, winTrades: 0 };

    // findFirst call 1: lookup existing config
    // findFirst call 2: post-update read
    mockBotConfigFindFirst
      .mockResolvedValueOnce(existingConfig)
      .mockResolvedValueOnce({ ...existingConfig, status: 'stopped', enabled: false });
    mockBotConfigUpdateMany.mockResolvedValue({ count: 1 });

    const req = makeRequest('/api/trading/auto-trade', { ...AUTHED_HEADERS, 'content-type': 'application/json' }, { enabled: false }, 'PUT');
    const res = await autoTradePut(req);

    expect(res.status).toBe(200);

    // Boundary 1: updateMany where contains { id: existingConfig.id, userId }
    expect(mockBotConfigUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cfg-1', userId: 'user-abc' },
      }),
    );

    // Boundary 2: post-read findFirst where contains { id: existingConfig.id, userId }
    expect(mockBotConfigFindFirst).toHaveBeenCalledTimes(2);
    expect(mockBotConfigFindFirst).toHaveBeenNthCalledWith(2,
      expect.objectContaining({
        where: { id: 'cfg-1', userId: 'user-abc' },
      }),
    );
  });
});

describe('CR4.3B §21H — wrong-tenant mutation returns count=0, no success', () => {
  it('bot PUT with wrong userId → count=0 → 404', async () => {
    vi.clearAllMocks();
    mockGetUserIdSync.mockReturnValue('user-other');
    mockBotFindFirst.mockResolvedValueOnce({ id: 'bot-1', userId: 'user-abc', enabled: false, status: 'stopped', account: null });
    mockBotUpdateMany.mockResolvedValue({ count: 0 });

    const req = makeRequest('/api/trading/bots/bot-1', { 'x-user-id': 'user-other', 'content-type': 'application/json' }, { name: 'Hack' }, 'PUT');
    const res = await botPut(req, { params: Promise.resolve({ id: 'bot-1' }) });
    expect(res.status).toBe(404);
  });

  it('account PATCH with wrong userId → count=0 → 404', async () => {
    vi.clearAllMocks();
    mockGetUserIdSync.mockReturnValue('user-other');
    mockTradingAccountFindFirst
      .mockResolvedValueOnce({ id: 'acct-1', userId: 'user-abc' })
      .mockResolvedValueOnce({ id: 'acct-1', userId: 'user-abc' });
    mockTradingAccountUpdateMany.mockResolvedValue({ count: 0 });

    const req = makeRequest('/api/trading/accounts/acct-1', { 'x-user-id': 'user-other', 'content-type': 'application/json' }, { label: 'Hack' }, 'PATCH');
    const res = await accountPatch(req, { params: Promise.resolve({ id: 'acct-1' }) });
    expect(res.status).toBe(404);
  });
});

// ============================================================
// §22: SCHEMA-VALID OWNERSHIP REGRESSION GATE
// ============================================================

describe('CR4.3B §22 — Position ownership via TradingAccount (no fake top-level userId on Position)', () => {
  it('position PATCH: where clause never contains a top-level userId on Position', async () => {
    vi.clearAllMocks();
    mockGetUserIdSync.mockReturnValue('user-abc');
    mockPositionFindFirst
      .mockResolvedValueOnce({ id: 'pos-1', symbol: 'BTC', status: 'open', account: { userId: 'user-abc', broker: 'demo', accountType: 'demo', isDemo: true } })
      .mockResolvedValueOnce({ id: 'pos-1', stopLoss: 60000 });
    mockPositionUpdateMany.mockResolvedValue({ count: 1 });

    const req = makeRequest('/api/trading/positions/pos-1', { ...AUTHED_HEADERS, 'content-type': 'application/json' }, { stopLoss: 60000 }, 'PATCH');
    await positionPatch(req, { params: Promise.resolve({ id: 'pos-1' }) });

    for (const call of mockPositionFindFirst.mock.calls) {
      const where = call[0]?.where;
      expect(where).toBeDefined();
      if (where.userId) {
        expect.unreachable('Position where clause should NOT have top-level userId');
      }
      expect(where.account?.userId || where.id).toBeDefined();
    }
  });

  it('position DELETE: related account mutation uses TradingAccount predicate (not Position.userId)', async () => {
    vi.clearAllMocks();
    mockGetUserIdSync.mockReturnValue('user-abc');
    mockPositionFindFirst.mockResolvedValue({
      id: 'pos-1', symbol: 'BTC', status: 'open', accountId: 'acct-1', avgEntryPrice: 65000,
      currentPrice: 67000, side: 'long', qty: 1,
      account: { userId: 'user-abc', broker: 'demo', accountType: 'demo', isDemo: true, id: 'acct-1' },
    });
    mockPositionUpdateMany.mockResolvedValue({ count: 1 });
    mockTradingAccountUpdateMany.mockResolvedValue({ count: 1 });

    const req = makeRequest('/api/trading/positions/pos-1', AUTHED_HEADERS, {}, 'DELETE');
    await positionDelete(req, { params: Promise.resolve({ id: 'pos-1' }) });

    expect(mockTradingAccountUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'user-abc' }),
      }),
    );
  });
});
