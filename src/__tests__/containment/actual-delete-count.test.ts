// ============================================================
// actual-delete-count.test.ts — CR4.1
// Tests that deleteMany results are properly checked (count:0 → 404, count:1 → 200).
// We mock @/lib/db but call the REAL route handler functions.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// Use vi.hoisted to make mock functions available inside vi.mock factories
const {
  mockDeleteMany: mockBotDeleteMany,
  mockBotFindFirst: mockBotFindFirst,
  mockBotFindUnique: mockBotFindUnique,
  mockBotUpdate: mockBotUpdate,
  mockAccountDeleteMany,
  mockWebhookDeleteMany,
} = vi.hoisted(() => ({
  mockDeleteMany: vi.fn(),
  mockBotFindFirst: vi.fn(),
  mockBotFindUnique: vi.fn(),
  mockBotUpdate: vi.fn(),
  mockAccountDeleteMany: vi.fn(),
  mockWebhookDeleteMany: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    bot: {
      deleteMany: mockBotDeleteMany,
      findFirst: mockBotFindFirst,
      findUnique: mockBotFindUnique,
      update: mockBotUpdate,
    },
    tradingAccount: {
      deleteMany: mockAccountDeleteMany,
    },
    webhookConfig: {
      deleteMany: mockWebhookDeleteMany,
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
  isExplicitlyDemo: vi.fn(() => true),
  CONTAINMENT_CODES: { PHASE1_LIVE_TRADING_DISABLED: 'PHASE1_LIVE_TRADING_DISABLED' },
  logSecurityEvent: vi.fn(),
  DEMO_PROVENANCE_HEADER: {},
}));

vi.mock('@/lib/subscription-guard', () => ({
  checkSubscriptionLimit: vi.fn(() => Promise.resolve({ allowed: true, current: 0, limit: 10 })),
  getLimitMessage: vi.fn(() => 'limit reached'),
}));

vi.spyOn(console, 'warn').mockImplementation(() => {});

import { DELETE as botDelete } from '@/app/api/trading/bots/[id]/route';
import { DELETE as accountDelete } from '@/app/api/trading/accounts/[id]/route';
import { DELETE as webhookDelete } from '@/app/api/trading/webhooks/route';

function makeRequest(url: string, userId = 'user-123') {
  return new NextRequest(`http://localhost${url}`, {
    headers: { 'x-user-id': userId },
  });
}

describe('Bot DELETE — actual delete count check', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deleteMany returns {count:0} → 404', async () => {
    mockBotDeleteMany.mockResolvedValue({ count: 0 });

    const req = makeRequest('/api/trading/bots/bot-1');
    const res = await botDelete(req, { params: Promise.resolve({ id: 'bot-1' }) });
    const data = await res.json();

    expect(res.status).toBe(404);
    expect(data.error).toContain('not found');
    expect(mockBotDeleteMany).toHaveBeenCalledWith({ where: { id: 'bot-1', userId: 'user-123' } });
  });

  it('deleteMany returns {count:1} → 200 with success:true', async () => {
    mockBotDeleteMany.mockResolvedValue({ count: 1 });

    const req = makeRequest('/api/trading/bots/bot-1');
    const res = await botDelete(req, { params: Promise.resolve({ id: 'bot-1' }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockBotDeleteMany).toHaveBeenCalledWith({ where: { id: 'bot-1', userId: 'user-123' } });
  });
});

describe('Account DELETE — actual delete count check', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deleteMany returns {count:0} → 404', async () => {
    mockAccountDeleteMany.mockResolvedValue({ count: 0 });

    const req = makeRequest('/api/trading/accounts/acc-1');
    const res = await accountDelete(req, { params: Promise.resolve({ id: 'acc-1' }) });
    const data = await res.json();

    expect(res.status).toBe(404);
    expect(data.error).toContain('not found');
    expect(mockAccountDeleteMany).toHaveBeenCalledWith({ where: { id: 'acc-1', userId: 'user-123' } });
  });

  it('deleteMany returns {count:1} → 200 with success:true', async () => {
    mockAccountDeleteMany.mockResolvedValue({ count: 1 });

    const req = makeRequest('/api/trading/accounts/acc-1');
    const res = await accountDelete(req, { params: Promise.resolve({ id: 'acc-1' }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockAccountDeleteMany).toHaveBeenCalledWith({ where: { id: 'acc-1', userId: 'user-123' } });
  });
});

describe('Webhook DELETE — actual delete count check', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deleteMany returns {count:0} → 404', async () => {
    mockWebhookDeleteMany.mockResolvedValue({ count: 0 });

    const req = makeRequest('/api/trading/webhooks?id=wh-1');
    const res = await webhookDelete(req);
    const data = await res.json();

    expect(res.status).toBe(404);
    expect(data.error).toContain('not found');
    expect(mockWebhookDeleteMany).toHaveBeenCalledWith({ where: { id: 'wh-1', userId: 'user-123' } });
  });

  it('deleteMany returns {count:1} → 200 with success:true', async () => {
    mockWebhookDeleteMany.mockResolvedValue({ count: 1 });

    const req = makeRequest('/api/trading/webhooks?id=wh-1');
    const res = await webhookDelete(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockWebhookDeleteMany).toHaveBeenCalledWith({ where: { id: 'wh-1', userId: 'user-123' } });
  });
});
