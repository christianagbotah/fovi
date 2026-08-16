// ============================================================
// mass-assignment.test.ts — CR4.1/CR4.2
// Tests bot PUT with strict allowlist. We call the REAL route handler,
// mock db.bot, and verify only allowed fields are passed to updateMany.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const {
  mockBotUpdateMany,
  mockBotFindFirst,
  mockBotFindFirstAfterUpdate,
} = vi.hoisted(() => ({
  mockBotUpdateMany: vi.fn(),
  mockBotFindFirst: vi.fn(),
  mockBotFindFirstAfterUpdate: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    bot: {
      findFirst: (args: Record<string, unknown>) => {
        // If called after update (for re-fetch), use the after-update mock
        if (args && (args.where as Record<string, unknown>)?.userId === undefined) {
          return mockBotFindFirstAfterUpdate();
        }
        return mockBotFindFirst();
      },
      updateMany: mockBotUpdateMany,
      deleteMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
  hasModel: vi.fn(() => true),
  isDbAvailable: vi.fn(() => true),
}));

vi.mock('@/lib/get-user-id', () => ({
  getUserIdSync: vi.fn(() => 'user-xyz'),
  getUserId: vi.fn(() => Promise.resolve('user-xyz')),
  AuthRequiredError: class extends Error {
    constructor() { super('Authentication required.'); this.name = 'AuthRequiredError'; }
  },
  authRequiredResponse: vi.fn(() => new Response(JSON.stringify({ error: 'Authentication required.' }), { status: 401 })),
  getUserIdOrNull: vi.fn(() => 'user-xyz'),
}));

vi.mock('@/lib/trading-policy', () => ({
  isExplicitlyDemo: vi.fn(() => true),
  CONTAINMENT_CODES: { PHASE1_LIVE_TRADING_DISABLED: 'PHASE1_LIVE_TRADING_DISABLED' },
  logSecurityEvent: vi.fn(),
  DEMO_PROVENANCE_HEADER: {},
}));

vi.spyOn(console, 'warn').mockImplementation(() => {});

import { PUT as botPut } from '@/app/api/trading/bots/[id]/route';

describe('Bot PUT — strict allowlist prevents mass assignment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBotFindFirst.mockResolvedValue({
      id: 'bot-1',
      userId: 'user-xyz',
      enabled: false,
      status: 'stopped',
      account: { broker: 'demo', accountType: 'demo', isDemo: true },
    });
    mockBotUpdateMany.mockResolvedValue({ count: 1 });
    mockBotFindFirstAfterUpdate.mockResolvedValue({
      id: 'bot-1', name: 'Updated', strategy: 'momentum',
    });
  });

  it('sends body with forbidden fields — only allowed fields passed to updateMany', async () => {
    const maliciousBody = {
      userId: 'other-user-hacked',
      accountId: 'hacked-account-id',
      enabled: true,
      status: 'running',
      totalTrades: 999,
      name: 'Legitimate Name',
      strategy: 'momentum',
    };

    const req = new NextRequest('http://localhost/api/trading/bots/bot-1', {
      method: 'PUT',
      headers: { 'x-user-id': 'user-xyz', 'content-type': 'application/json' },
      body: JSON.stringify(maliciousBody),
    });

    const res = await botPut(req, { params: Promise.resolve({ id: 'bot-1' }) });

    expect(mockBotUpdateMany).toHaveBeenCalledTimes(1);

    const updateCall = mockBotUpdateMany.mock.calls[0];
    const updateData = updateCall[0]?.data as Record<string, unknown>;

    // Verify FORBIDDEN fields are NOT in the update data
    expect(updateData).not.toHaveProperty('userId');
    expect(updateData).not.toHaveProperty('accountId');
    expect(updateData).not.toHaveProperty('enabled');
    expect(updateData).not.toHaveProperty('status');
    expect(updateData).not.toHaveProperty('totalTrades');

    // Verify ALLOWED fields ARE in the update data
    expect(updateData).toHaveProperty('name');
    expect(updateData.name).toBe('Legitimate Name');
    expect(updateData).toHaveProperty('strategy');
    expect(updateData.strategy).toBe('momentum');
  });

  it('userId specifically is never passed to updateMany', async () => {
    const body = { userId: 'attacker-id', name: 'Benign Update' };

    const req = new NextRequest('http://localhost/api/trading/bots/bot-1', {
      method: 'PUT',
      headers: { 'x-user-id': 'user-xyz', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    await botPut(req, { params: Promise.resolve({ id: 'bot-1' }) });

    const updateData = mockBotUpdateMany.mock.calls[0][0]?.data;
    expect(updateData).not.toHaveProperty('userId');
  });

  it('accountId specifically is never passed to updateMany', async () => {
    const body = { accountId: 'compromised-acc', name: 'Benign Update' };

    const req = new NextRequest('http://localhost/api/trading/bots/bot-1', {
      method: 'PUT',
      headers: { 'x-user-id': 'user-xyz', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    await botPut(req, { params: Promise.resolve({ id: 'bot-1' }) });

    const updateData = mockBotUpdateMany.mock.calls[0][0]?.data;
    expect(updateData).not.toHaveProperty('accountId');
  });

  it('enabled specifically is never passed to updateMany from client body', async () => {
    const body = { enabled: true, name: 'Benign Update' };

    const req = new NextRequest('http://localhost/api/trading/bots/bot-1', {
      method: 'PUT',
      headers: { 'x-user-id': 'user-xyz', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    await botPut(req, { params: Promise.resolve({ id: 'bot-1' }) });

    const updateData = mockBotUpdateMany.mock.calls[0][0]?.data;
    expect(updateData).not.toHaveProperty('enabled');
  });

  it('status specifically is never passed to updateMany from client body', async () => {
    const body = { status: 'running', name: 'Benign Update' };

    const req = new NextRequest('http://localhost/api/trading/bots/bot-1', {
      method: 'PUT',
      headers: { 'x-user-id': 'user-xyz', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    await botPut(req, { params: Promise.resolve({ id: 'bot-1' }) });

    const updateData = mockBotUpdateMany.mock.calls[0][0]?.data;
    expect(updateData).not.toHaveProperty('status');
  });

  it('totalTrades specifically is never passed to updateMany', async () => {
    const body = { totalTrades: 999, name: 'Benign Update' };

    const req = new NextRequest('http://localhost/api/trading/bots/bot-1', {
      method: 'PUT',
      headers: { 'x-user-id': 'user-xyz', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    await botPut(req, { params: Promise.resolve({ id: 'bot-1' }) });

    const updateData = mockBotUpdateMany.mock.calls[0][0]?.data;
    expect(updateData).not.toHaveProperty('totalTrades');
  });
});
