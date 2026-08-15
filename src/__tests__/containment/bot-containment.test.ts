// ============================================================
// bot-containment.test.ts — CR4.1
// Tests bot creation and toggle with Phase 1 containment.
// Mock db but call REAL route handlers.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  mockBotCreate,
  mockBotFindFirst,
  mockBotFindUnique,
  mockBotUpdate,
  mockTradingAccountFindFirst,
} = vi.hoisted(() => ({
  mockBotCreate: vi.fn(),
  mockBotFindFirst: vi.fn(),
  mockBotFindUnique: vi.fn(),
  mockBotUpdate: vi.fn(),
  mockTradingAccountFindFirst: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    bot: {
      create: mockBotCreate,
      findFirst: mockBotFindFirst,
      findUnique: mockBotFindUnique,
      update: mockBotUpdate,
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
  isExplicitlyDemo: vi.fn((account: any) => {
    return account?.broker === 'demo' && account?.accountType === 'demo' && account?.isDemo === true;
  }),
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
  return new Request(`http://localhost${url}`, {
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
};

const liveAccount = {
  id: 'acc-live-1',
  userId: 'user-123',
  broker: 'alpaca',
  accountType: 'live',
  isDemo: false,
  isDefault: true,
};

describe('Bot POST — Phase 1 containment', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('non-demo account → 403 PHASE1_LIVE_TRADING_DISABLED (zero DB create calls)', async () => {
    mockTradingAccountFindFirst
      .mockResolvedValueOnce(null) // isDefault: true
      .mockResolvedValueOnce(liveAccount); // any account

    const req = new Request('http://localhost/api/trading/bots', {
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
      .mockResolvedValueOnce(null) // isDefault: true
      .mockResolvedValueOnce(null); // any account

    const req = new Request('http://localhost/api/trading/bots', {
      method: 'POST',
      headers: { 'x-user-id': 'user-123', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Test Bot' }),
    });
    const res = await botPost(req);
    const data = await res.json();

    expect(res.status).toBe(404);
    expect(mockBotCreate).not.toHaveBeenCalled();
  });

  it('demo account → succeeds (positive control)', async () => {
    mockTradingAccountFindFirst.mockResolvedValue(demoAccount);
    mockBotCreate.mockResolvedValue({
      id: 'bot-new-1',
      userId: 'user-123',
      accountId: 'acc-demo-1',
      name: 'New Bot',
      strategy: 'signal_based',
    });

    const req = new Request('http://localhost/api/trading/bots', {
      method: 'POST',
      headers: { 'x-user-id': 'user-123', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Test Bot' }),
    });
    const res = await botPost(req);

    expect(res.status).toBe(200);
    expect(mockBotCreate).toHaveBeenCalledTimes(1);
  });
});

describe('Bot Toggle — Phase 1 containment', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('enable with null account → 403', async () => {
    mockBotFindUnique.mockResolvedValue({
      id: 'bot-1',
      userId: 'user-123',
      enabled: false,
      status: 'stopped',
      account: null,
    });

    const req = makeRequest('/api/trading/bots/bot-1/toggle');
    const res = await botToggle(req, { params: Promise.resolve({ id: 'bot-1' }) });
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.code).toBe('PHASE1_LIVE_TRADING_DISABLED');
  });

  it('enable with non-demo account → 403', async () => {
    mockBotFindUnique.mockResolvedValue({
      id: 'bot-1',
      userId: 'user-123',
      enabled: false,
      status: 'stopped',
      account: liveAccount,
    });

    const req = makeRequest('/api/trading/bots/bot-1/toggle');
    const res = await botToggle(req, { params: Promise.resolve({ id: 'bot-1' }) });
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.code).toBe('PHASE1_LIVE_TRADING_DISABLED');
  });

  it('enable with demo account → 200 (positive control)', async () => {
    mockBotFindUnique.mockResolvedValue({
      id: 'bot-1',
      userId: 'user-123',
      enabled: false,
      status: 'stopped',
      account: demoAccount,
    });
    mockBotUpdate.mockResolvedValue({
      id: 'bot-1',
      enabled: true,
      status: 'running',
    });

    const req = makeRequest('/api/trading/bots/bot-1/toggle');
    const res = await botToggle(req, { params: Promise.resolve({ id: 'bot-1' }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.enabled).toBe(true);
    expect(mockBotUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'bot-1' },
        data: { enabled: true, status: 'running' },
      }),
    );
  });

  it('disable with non-demo account → 200 (allowed safe containment action)', async () => {
    mockBotFindUnique.mockResolvedValue({
      id: 'bot-2',
      userId: 'user-123',
      enabled: true,
      status: 'running',
      account: liveAccount,
    });
    mockBotUpdate.mockResolvedValue({
      id: 'bot-2',
      enabled: false,
      status: 'stopped',
    });

    const req = makeRequest('/api/trading/bots/bot-2/toggle');
    const res = await botToggle(req, { params: Promise.resolve({ id: 'bot-2' }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.enabled).toBe(false);
    expect(data.status).toBe('stopped');
  });
});
