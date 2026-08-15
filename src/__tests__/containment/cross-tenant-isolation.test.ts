// ============================================================
// Cross-Tenant Isolation Tests (Req 5)
// Two distinct users, user A and user B.
// Directly test protected route handlers.
// Prove user B cannot access user A's resources.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const ORIGINAL_ENV = process.env;

const USER_A = 'user_A';
const USER_B = 'user_B';

const capturedQueries: Array<{ model: string; operation: string; where: unknown }> = [];

function captureWhere(model: string, operation: string) {
  return vi.fn().mockImplementation((args: unknown) => {
    if (args && typeof args === 'object') {
      const prismaArgs = args as Record<string, unknown>;
      const whereClause = prismaArgs.where || args;
      capturedQueries.push({ model, operation, where: whereClause });
    }
    return Promise.resolve([]);
  });
}

const mockDb = {
  tradingAccount: {
    findFirst: captureWhere('tradingAccount', 'findFirst'),
    findMany: captureWhere('tradingAccount', 'findMany'),
    update: captureWhere('tradingAccount', 'update'),
  },
  order: {
    findFirst: captureWhere('order', 'findFirst'),
    findMany: captureWhere('order', 'findMany'),
  },
  bot: {
    findUnique: captureWhere('bot', 'findUnique'),
    findFirst: captureWhere('bot', 'findFirst'),
    findMany: captureWhere('bot', 'findMany'),
  },
  webhookConfig: {
    findMany: captureWhere('webhookConfig', 'findMany'),
    deleteMany: captureWhere('webhookConfig', 'deleteMany'),
  },
};

vi.mock('@/lib/db', () => ({
  db: mockDb,
  hasModel: (model: string) => ['tradingAccount', 'order', 'bot', 'webhookConfig'].includes(model),
}));

vi.mock('@/lib/broker/factory', () => ({
  createBrokerFromAccount: vi.fn().mockResolvedValue({
    getPositions: () => Promise.resolve([]),
    getAccountInfo: () => Promise.resolve({ accountId: 'x', balance: 10000, currency: 'USD', buyingPower: 10000, dayPnl: 0 }),
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

function authedReqDelete(userId: string, url: string) {
  return new NextRequest(new URL(url), { method: 'DELETE', headers: { 'x-user-id': userId } });
}

function authedReqPut(userId: string, body: unknown, url: string) {
  return new NextRequest(new URL(url), {
    method: 'PUT',
    headers: { 'x-user-id': userId, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('cross-tenant isolation', () => {
  beforeEach(() => {
    capturedQueries.length = 0;
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => { process.env = ORIGINAL_ENV; });

  it('anonymous request to protected route returns 401', async () => {
    const { GET } = await import('@/app/api/trading/orders/route');
    const res = await GET(new NextRequest(new URL('http://localhost/api/trading/orders')));
    expect(res.status).toBe(401);
  });

  it('route uses authenticated userId in account query — different users get different account lookups', async () => {
    const { GET } = await import('@/app/api/trading/orders/route');

    // User A's request — verify tradingAccount.findFirst contains userId
    capturedQueries.length = 0;
    await GET(authedReq(USER_A, 'http://localhost/api/trading/orders'));
    const userAAccountQuery = capturedQueries.find(q => q.model === 'tradingAccount' && q.operation === 'findFirst');
    expect(userAAccountQuery).toBeDefined();
    expect((userAAccountQuery!.where as Record<string, unknown>).userId).toBe(USER_A);

    // User B's request
    capturedQueries.length = 0;
    await GET(authedReq(USER_B, 'http://localhost/api/trading/orders'));
    const userBAccountQuery = capturedQueries.find(q => q.model === 'tradingAccount' && q.operation === 'findFirst');
    expect(userBAccountQuery).toBeDefined();
    expect((userBAccountQuery!.where as Record<string, unknown>).userId).toBe(USER_B);
  });

  it('bot toggle: user B cannot toggle user A\'s bot', async () => {
    mockDb.bot.findUnique.mockResolvedValueOnce({
      id: 'bot_1', userId: USER_A, enabled: false,
    } as any);

    const { POST } = await import('@/app/api/trading/bots/[id]/toggle/route');
    const res = await POST(
      authedReqPost(USER_B, {}, 'http://localhost/api/trading/bots/bot_1/toggle'),
      { params: Promise.resolve({ id: 'bot_1' }) },
    );

    expect(res.status).toBe(403);
  });

  it('bot update: user B cannot update user A\'s bot', async () => {
    mockDb.bot.findUnique.mockResolvedValueOnce({
      id: 'bot_1', userId: USER_A, name: 'Old Name',
    } as any);

    const { PUT } = await import('@/app/api/trading/bots/[id]/route');
    const res = await PUT(
      authedReqPut(USER_B, { name: 'Hacked!' }, 'http://localhost/api/trading/bots/bot_1'),
      { params: Promise.resolve({ id: 'bot_1' }) },
    );

    expect(res.status).toBe(403);
  });

  it('bot delete: user B cannot delete user A\'s bot', async () => {
    mockDb.bot.findUnique.mockResolvedValueOnce({
      id: 'bot_1', userId: USER_A,
    } as any);

    const { DELETE } = await import('@/app/api/trading/bots/[id]/route');
    const res = await DELETE(
      authedReqDelete(USER_B, 'http://localhost/api/trading/bots/bot_1'),
      { params: Promise.resolve({ id: 'bot_1' }) },
    );

    expect(res.status).toBe(403);
  });

  it('webhook delete: DB query contains authenticated userId (tenant-scoped)', async () => {
    const { DELETE } = await import('@/app/api/trading/webhooks/route');
    await DELETE(
      authedReqDelete(USER_B, 'http://localhost/api/trading/webhooks?id=wh_1'),
    );

    // The deleteMany call should contain user_B's userId
    const delQuery = capturedQueries.find(q => q.model === 'webhookConfig' && q.operation === 'deleteMany');
    expect(delQuery).toBeDefined();
    const where = delQuery!.where as Record<string, unknown>;
    expect(where.userId).toBe(USER_B);
    expect(where.id).toBe('wh_1');
  });
});
