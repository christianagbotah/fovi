// ============================================================
// Mass Assignment Prevention Tests (Task 10b-3)
// Verify that bots PUT cannot:
//   - Change userId
//   - Change accountId
//   - Set status to 'running' directly
//   - Set totalTrades, winTrades, totalPnl
//   - Set lastTradeAt
// The route uses a strict ALLOWED_FIELDS allowlist.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const ORIGINAL_ENV = process.env;

// ── Mock DB with call capture ──
const capturedUpdateArgs: Array<{ where: unknown; data: Record<string, unknown> }> = [];
const mockFindUnique = vi.fn();
const mockFindMany = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn().mockImplementation((args: any) => {
  capturedUpdateArgs.push({ where: args.where, data: args.data });
  return Promise.resolve({ id: 'bot_1', ...args.data });
});

vi.mock('@/lib/db', () => ({
  db: {
    tradingAccount: { findFirst: vi.fn() },
    bot: { findUnique: mockFindUnique, findMany: mockFindMany, create: mockCreate, update: mockUpdate, delete: vi.fn() },
  },
  hasModel: (m: string) => ['tradingAccount', 'bot'].includes(m),
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

vi.mock('uuid', () => ({
  v4: () => 'test-uuid-00000000-0000-4000-8000-000000000000',
}));

// ── Helpers ──
function authedReqPut(userId: string, body: unknown) {
  return new NextRequest(new URL('http://localhost/api/trading/bots/bot_1'), {
    method: 'PUT',
    headers: { 'x-user-id': userId, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const DEMO_ACCOUNT = {
  id: 'acc_demo_1', userId: 'user_A', broker: 'demo', accountType: 'demo',
  isDemo: true, balance: 100000,
};

const EXISTING_BOT = {
  id: 'bot_1', userId: 'user_A', accountId: 'acc_demo_1',
  name: 'Test Bot', strategy: 'momentum', symbols: 'BTC',
  enabled: false, status: 'stopped',
  account: DEMO_ACCOUNT,
};

// ================================================================
describe('mass assignment prevention — bots PUT', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedUpdateArgs.length = 0;
    process.env = { ...ORIGINAL_ENV };
    mockFindUnique.mockResolvedValue(EXISTING_BOT);
  });
  afterEach(() => { process.env = ORIGINAL_ENV; });

  it('cannot change userId', async () => {
    const { PUT } = await import('@/app/api/trading/bots/[id]/route');
    const res = await PUT(
      authedReqPut('user_A', { userId: 'user_HACKED', name: 'Renamed' }),
      { params: Promise.resolve({ id: 'bot_1' }) },
    );

    expect(res.status).toBe(200);
    // The update data should NOT contain userId
    const updateData = capturedUpdateArgs[0]?.data;
    expect(updateData).toBeDefined();
    expect(updateData?.userId).toBeUndefined();
  });

  it('cannot change accountId', async () => {
    const { PUT } = await import('@/app/api/trading/bots/[id]/route');
    const res = await PUT(
      authedReqPut('user_A', { accountId: 'acc_HACKED', name: 'Renamed' }),
      { params: Promise.resolve({ id: 'bot_1' }) },
    );

    expect(res.status).toBe(200);
    const updateData = capturedUpdateArgs[0]?.data;
    expect(updateData?.accountId).toBeUndefined();
  });

  it('cannot set status to running directly via body', async () => {
    const { PUT } = await import('@/app/api/trading/bots/[id]/route');
    const res = await PUT(
      authedReqPut('user_A', { status: 'running', name: 'TryRunning' }),
      { params: Promise.resolve({ id: 'bot_1' }) },
    );

    expect(res.status).toBe(200);
    const updateData = capturedUpdateArgs[0]?.data;
    // 'status' is not in the ALLOWED_FIELDS list, so it should be stripped
    expect(updateData?.status).toBeUndefined();
  });

  it('cannot set totalTrades', async () => {
    const { PUT } = await import('@/app/api/trading/bots/[id]/route');
    const res = await PUT(
      authedReqPut('user_A', { totalTrades: 9999, name: 'Inflated' }),
      { params: Promise.resolve({ id: 'bot_1' }) },
    );

    expect(res.status).toBe(200);
    const updateData = capturedUpdateArgs[0]?.data;
    expect(updateData?.totalTrades).toBeUndefined();
  });

  it('cannot set winTrades', async () => {
    const { PUT } = await import('@/app/api/trading/bots/[id]/route');
    const res = await PUT(
      authedReqPut('user_A', { winTrades: 9999, name: 'Inflated' }),
      { params: Promise.resolve({ id: 'bot_1' }) },
    );

    expect(res.status).toBe(200);
    const updateData = capturedUpdateArgs[0]?.data;
    expect(updateData?.winTrades).toBeUndefined();
  });

  it('cannot set totalPnl', async () => {
    const { PUT } = await import('@/app/api/trading/bots/[id]/route');
    const res = await PUT(
      authedReqPut('user_A', { totalPnl: 999999, name: 'Inflated' }),
      { params: Promise.resolve({ id: 'bot_1' }) },
    );

    expect(res.status).toBe(200);
    const updateData = capturedUpdateArgs[0]?.data;
    expect(updateData?.totalPnl).toBeUndefined();
  });

  it('cannot set lastTradeAt', async () => {
    const { PUT } = await import('@/app/api/trading/bots/[id]/route');
    const res = await PUT(
      authedReqPut('user_A', { lastTradeAt: '2099-01-01T00:00:00Z', name: 'Future' }),
      { params: Promise.resolve({ id: 'bot_1' }) },
    );

    expect(res.status).toBe(200);
    const updateData = capturedUpdateArgs[0]?.data;
    expect(updateData?.lastTradeAt).toBeUndefined();
  });

  it('allows updating allowed fields (name, strategy, symbols, etc.)', async () => {
    const { PUT } = await import('@/app/api/trading/bots/[id]/route');
    const res = await PUT(
      authedReqPut('user_A', {
        name: 'Updated Name',
        strategy: 'grid',
        symbols: 'BTC,ETH',
        timeframe: '15m',
        allocationAmount: 25000,
        riskPerTrade: 3.0,
        maxPositions: 5,
        stopLossPercent: 1.5,
        takeProfitPercent: 5.0,
        trailingStopPct: 2.0,
        tradingSessions: 'us',
        config: { gridLevels: 10 },
      }),
      { params: Promise.resolve({ id: 'bot_1' }) },
    );

    expect(res.status).toBe(200);
    const updateData = capturedUpdateArgs[0]?.data;
    expect(updateData?.name).toBe('Updated Name');
    expect(updateData?.strategy).toBe('grid');
    expect(updateData?.symbols).toBe('BTC,ETH');
    expect(updateData?.timeframe).toBe('15m');
    expect(updateData?.allocationAmount).toBe(25000);
    expect(updateData?.riskPerTrade).toBe(3.0);
    expect(updateData?.maxPositions).toBe(5);
    expect(updateData?.stopLossPercent).toBe(1.5);
    expect(updateData?.takeProfitPercent).toBe(5.0);
    expect(updateData?.trailingStopPct).toBe(2.0);
    expect(updateData?.tradingSessions).toBe('us');
    // config should be JSON-stringified
    expect(typeof updateData?.config).toBe('string');
  });

  it('bulk mass-assignment attempt: all forbidden fields simultaneously', async () => {
    const { PUT } = await import('@/app/api/trading/bots/[id]/route');
    const res = await PUT(
      authedReqPut('user_A', {
        userId: 'hacker', accountId: 'hacked_acc',
        enabled: true, status: 'running',
        totalTrades: 99999, winTrades: 99999, totalPnl: 999999,
        lastTradeAt: '2099-01-01T00:00:00Z',
        name: 'Safe Name Only',
      }),
      { params: Promise.resolve({ id: 'bot_1' }) },
    );

    expect(res.status).toBe(200);
    const updateData = capturedUpdateArgs[0]?.data;

    // NONE of the forbidden fields should be in the update data
    expect(updateData?.userId).toBeUndefined();
    expect(updateData?.accountId).toBeUndefined();
    expect(updateData?.enabled).toBeUndefined();
    expect(updateData?.status).toBeUndefined();
    expect(updateData?.totalTrades).toBeUndefined();
    expect(updateData?.winTrades).toBeUndefined();
    expect(updateData?.totalPnl).toBeUndefined();
    expect(updateData?.lastTradeAt).toBeUndefined();

    // Only the allowed field should be present
    expect(updateData?.name).toBe('Safe Name Only');
  });
});
