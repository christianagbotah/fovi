// ============================================================
// mass-assignment.test.ts — CR4.1/CR4.2 + Phase 2C
// Tests bot PUT strict allowlist with a valid canonical stored bot fixture.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
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

const canonicalStoredBot = {
  id: 'bot-1',
  userId: 'user-xyz',
  enabled: false,
  status: 'stopped',
  strategy: 'signal_based',
  timeframe: '4h',
  allocationAmount: 10_000,
  riskPerTrade: 2,
  maxPositions: 3,
  account: {
    broker: 'demo', accountType: 'demo', isDemo: true, balance: 100_000, isActive: true,
  },
};

describe('Bot PUT — strict allowlist prevents mass assignment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBotFindFirst.mockResolvedValue(canonicalStoredBot);
    mockBotUpdateMany.mockResolvedValue({ count: 1 });
    mockBotFindFirstAfterUpdate.mockResolvedValue({
      ...canonicalStoredBot, name: 'Updated', strategy: 'momentum',
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

    await botPut(req, { params: Promise.resolve({ id: 'bot-1' }) });

    expect(mockBotUpdateMany).toHaveBeenCalledTimes(1);
    const updateData = mockBotUpdateMany.mock.calls[0][0]?.data as Record<string, unknown>;

    expect(updateData).not.toHaveProperty('userId');
    expect(updateData).not.toHaveProperty('accountId');
    expect(updateData).not.toHaveProperty('enabled');
    expect(updateData).not.toHaveProperty('status');
    expect(updateData).not.toHaveProperty('totalTrades');

    expect(updateData).toHaveProperty('name', 'Legitimate Name');
    expect(updateData).toHaveProperty('strategy', 'momentum');
    // Server-owned canonical fields may be added when a decision-policy field changes.
    expect(updateData).toHaveProperty('timeframe', '4h');
    expect(updateData).toHaveProperty('positionSizing', 'canonical_risk_v1');
  });

  it('userId specifically is never passed to updateMany', async () => {
    const req = new NextRequest('http://localhost/api/trading/bots/bot-1', {
      method: 'PUT',
      headers: { 'x-user-id': 'user-xyz', 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'attacker-id', name: 'Benign Update' }),
    });
    await botPut(req, { params: Promise.resolve({ id: 'bot-1' }) });
    expect(mockBotUpdateMany.mock.calls[0][0]?.data).not.toHaveProperty('userId');
  });

  it('accountId specifically is never passed to updateMany', async () => {
    const req = new NextRequest('http://localhost/api/trading/bots/bot-1', {
      method: 'PUT',
      headers: { 'x-user-id': 'user-xyz', 'content-type': 'application/json' },
      body: JSON.stringify({ accountId: 'compromised-acc', name: 'Benign Update' }),
    });
    await botPut(req, { params: Promise.resolve({ id: 'bot-1' }) });
    expect(mockBotUpdateMany.mock.calls[0][0]?.data).not.toHaveProperty('accountId');
  });

  it('enabled specifically is never passed to updateMany from client body', async () => {
    const req = new NextRequest('http://localhost/api/trading/bots/bot-1', {
      method: 'PUT',
      headers: { 'x-user-id': 'user-xyz', 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true, name: 'Benign Update' }),
    });
    await botPut(req, { params: Promise.resolve({ id: 'bot-1' }) });
    expect(mockBotUpdateMany.mock.calls[0][0]?.data).not.toHaveProperty('enabled');
  });

  it('status specifically is never passed to updateMany from client body', async () => {
    const req = new NextRequest('http://localhost/api/trading/bots/bot-1', {
      method: 'PUT',
      headers: { 'x-user-id': 'user-xyz', 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'running', name: 'Benign Update' }),
    });
    await botPut(req, { params: Promise.resolve({ id: 'bot-1' }) });
    expect(mockBotUpdateMany.mock.calls[0][0]?.data).not.toHaveProperty('status');
  });

  it('totalTrades specifically is never passed to updateMany', async () => {
    const req = new NextRequest('http://localhost/api/trading/bots/bot-1', {
      method: 'PUT',
      headers: { 'x-user-id': 'user-xyz', 'content-type': 'application/json' },
      body: JSON.stringify({ totalTrades: 999, name: 'Benign Update' }),
    });
    await botPut(req, { params: Promise.resolve({ id: 'bot-1' }) });
    expect(mockBotUpdateMany.mock.calls[0][0]?.data).not.toHaveProperty('totalTrades');
  });
});
