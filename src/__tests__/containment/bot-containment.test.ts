// ============================================================
// bot-containment.test.ts — CR4.1 + Phase 2C
// Tests bot creation/toggle with containment and valid canonical bot fixtures.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const {
  mockBotCreate,
  mockBotFindFirst,
  mockBotFindUnique,
  mockBotUpdate,
  mockBotUpdateMany,
  mockTradingAccountFindFirst,
} = vi.hoisted(() => ({
  mockBotCreate: vi.fn(),
  mockBotFindFirst: vi.fn(),
  mockBotFindUnique: vi.fn(),
  mockBotUpdate: vi.fn(),
  mockBotUpdateMany: vi.fn(),
  mockTradingAccountFindFirst: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    bot: {
      create: mockBotCreate,
      findFirst: mockBotFindFirst,
      findUnique: mockBotFindUnique,
      update: mockBotUpdate,
      updateMany: mockBotUpdateMany,
      deleteMany: vi.fn(),
    },
    tradingAccount: {
      findFirst: mockTradingAccountFindFirst,
      create: vi.fn(),
      update: vi.fn(),
    },
  },
  hasModel: vi.fn(() => true),
  isDbAvailable: vi.fn(() => true),
}));

vi.mock('@/lib/get-user-id', () => ({
  getUserIdSync: vi.fn(() => 'user-123'),
  getUserId: vi.fn(() => Promise.resolve('user-123')),
  AuthRequiredError: class extends Error {
    constructor() { super('Authentication required.'); this.name = 'AuthRequiredError'; }
  },
  authRequiredResponse: vi.fn(() => new Response(JSON.stringify({ error: 'Authentication required.' }), { status: 401 })),
  getUserIdOrNull: vi.fn(() => 'user-123'),
}));

vi.mock('@/lib/trading-policy', () => ({
  isExplicitlyDemo: vi.fn((account: any) =>
    account?.broker === 'demo' && account?.accountType === 'demo' && account?.isDemo === true
  ),
  CONTAINMENT_CODES: { PHASE1_LIVE_TRADING_DISABLED: 'PHASE1_LIVE_TRADING_DISABLED' },
  logSecurityEvent: vi.fn(),
  DEMO_PROVENANCE_HEADER: {},
}));

vi.mock('@/lib/subscription-guard', () => ({
  checkSubscriptionLimit: vi.fn(() => Promise.resolve({ allowed: true, current: 0, limit: 10 })),
  getLimitMessage: vi.fn(() => 'limit'),
}));

vi.spyOn(console, 'warn').mockImplementation(() => {});

import { POST as botPost } from '@/app/api/trading/bots/route';
import { POST as botToggle } from '@/app/api/trading/bots/[id]/toggle/route';

function makeRequest(url: string, userId = 'user-123') {
  return new NextRequest(`http://localhost${url}`, {
    headers: { 'x-user-id': userId },
  });
}

const demoAccount = {
  id: 'acc-demo-1',
  userId: 'user-123',
  broker: 'demo',
  accountType: 'demo',
  isDemo: true,
  isDefault: true,
  balance: 100_000,
  isActive: true,
};

const liveAccount = {
  id: 'acc-live-1',
  userId: 'user-123',
  broker: 'alpaca',
  accountType: 'live',
  isDemo: false,
  isDefault: true,
  balance: 100_000,
  isActive: true,
};

const canonicalBotConfig = {
  strategy: 'signal_based',
  timeframe: '4h',
  allocationAmount: 10_000,
  riskPerTrade: 2,
  maxPositions: 3,
};

describe('Bot POST — Phase 1 containment', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('non-demo account → 403 PHASE1_LIVE_TRADING_DISABLED (zero DB create calls)', async () => {
    mockTradingAccountFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(liveAccount);

    const req = new NextRequest('http://localhost/api/trading/bots', {
      method: 'POST',
      headers: { 'x-user-id': 'user-123', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Test Bot' }),
    });
    const res = await botPost(req);
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.code).toBe('PHASE1_LIVE_TRADING_DISABLED');
    expect(mockBotCreate).not.toHaveBeenCalled();
  });

  it('null account (no account found) → 404', async () => {
    mockTradingAccountFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const req = new NextRequest('http://localhost/api/trading/bots', {
      method: 'POST',
      headers: { 'x-user-id': 'user-123', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Test Bot' }),
    });
    const res = await botPost(req);

    expect(res.status).toBe(404);
    expect(mockBotCreate).not.toHaveBeenCalled();
  });

  it('demo account with canonical Phase 2C config → succeeds (positive control)', async () => {
    mockTradingAccountFindFirst.mockResolvedValue(demoAccount);
    mockBotCreate.mockResolvedValue({
      id: 'bot-new-1',
      userId: 'user-123',
      accountId: 'acc-demo-1',
      name: 'New Bot',
      ...canonicalBotConfig,
    });

    const req = new NextRequest('http://localhost/api/trading/bots', {
      method: 'POST',
      headers: { 'x-user-id': 'user-123', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Test Bot', ...canonicalBotConfig }),
    });
    const res = await botPost(req);

    expect(res.status).toBe(200);
    expect(mockBotCreate).toHaveBeenCalledTimes(1);
    expect(mockBotCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        timeframe: '4h',
        riskPerTrade: 2,
        positionSizing: 'canonical_risk_v1',
      }),
    }));
  });
});

describe('Bot Toggle — Phase 1 containment', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('enable with null account → 403', async () => {
    mockBotFindFirst.mockResolvedValue({
      id: 'bot-1', userId: 'user-123', enabled: false, status: 'stopped', account: null,
    });

    const res = await botToggle(makeRequest('/api/trading/bots/bot-1/toggle'), {
      params: Promise.resolve({ id: 'bot-1' }),
    });
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.code).toBe('PHASE1_LIVE_TRADING_DISABLED');
  });

  it('enable with non-demo account → 403', async () => {
    mockBotFindFirst.mockResolvedValue({
      id: 'bot-1', userId: 'user-123', enabled: false, status: 'stopped',
      account: liveAccount, ...canonicalBotConfig,
    });

    const res = await botToggle(makeRequest('/api/trading/bots/bot-1/toggle'), {
      params: Promise.resolve({ id: 'bot-1' }),
    });
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.code).toBe('PHASE1_LIVE_TRADING_DISABLED');
  });

  it('enable with demo account and canonical config → 200 (positive control)', async () => {
    mockBotFindFirst.mockResolvedValue({
      id: 'bot-1', userId: 'user-123', enabled: false, status: 'stopped',
      account: demoAccount, ...canonicalBotConfig,
    });
    mockBotUpdateMany.mockResolvedValue({ count: 1 });

    const res = await botToggle(makeRequest('/api/trading/bots/bot-1/toggle'), {
      params: Promise.resolve({ id: 'bot-1' }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.enabled).toBe(true);
    expect(mockBotUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'bot-1', userId: 'user-123' },
        data: expect.objectContaining({
          enabled: true,
          status: 'running',
          positionSizing: 'canonical_risk_v1',
        }),
      }),
    );
  });

  it('disable with non-demo account → 200 (allowed safe containment action)', async () => {
    mockBotFindFirst.mockResolvedValue({
      id: 'bot-2', userId: 'user-123', enabled: true, status: 'running',
      account: liveAccount, ...canonicalBotConfig,
    });
    mockBotUpdateMany.mockResolvedValue({ count: 1 });

    const res = await botToggle(makeRequest('/api/trading/bots/bot-2/toggle'), {
      params: Promise.resolve({ id: 'bot-2' }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.enabled).toBe(false);
    expect(data.status).toBe('stopped');
  });
});
