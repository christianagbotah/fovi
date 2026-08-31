import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const { mockFindMany, mockHasModel, mockEligibility, mockBotPolicy } = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockHasModel: vi.fn(() => true),
  mockEligibility: vi.fn((): { eligible: boolean; reason?: string } => ({ eligible: true })),
  mockBotPolicy: vi.fn(() => ({ valid: true })),
}));

vi.mock('@/lib/db', () => ({
  db: { position: { findMany: mockFindMany } },
  hasModel: mockHasModel,
}));

vi.mock('@/lib/trading-policy', () => ({
  enforceInternalAuth: vi.fn(() => null),
  logSecurityEvent: vi.fn(),
}));

vi.mock('@/lib/engine-eligibility', () => ({
  evaluateEngineAccountEligibility: mockEligibility,
}));

vi.mock('@/lib/trading-intelligence/bot-policy', () => ({
  validateAutomatedBotConfiguration: mockBotPolicy,
}));

import { GET } from '@/app/api/trading/engine/positions/route';

function persistedPosition(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ppos_abc123',
    botId: 'bot-1',
    accountId: 'acc-1',
    symbol: 'BTC',
    side: 'long',
    qty: 0.5,
    avgEntryPrice: 50_000,
    currentPrice: 50_100,
    stopLoss: 49_000,
    takeProfit: 52_000,
    openedAt: new Date('2026-08-31T05:00:00Z'),
    unrealizedPnl: 50,
    account: {
      id: 'acc-1',
      userId: 'user-1',
      broker: 'demo',
      accountType: 'demo',
      isDemo: true,
      isActive: true,
      balance: 100_000,
      apiKey: null,
      apiSecret: null,
      passphrase: null,
    },
    bot: {
      id: 'bot-1',
      userId: 'user-1',
      accountId: 'acc-1',
      enabled: true,
      status: 'running',
      strategy: 'signal_based',
      timeframe: '4h',
      allocationAmount: 10_000,
      riskPerTrade: 2,
      maxPositions: 3,
    },
    ...overrides,
  };
}

describe('Phase 2E authoritative paper position hydration', () => {
  it('returns only safe persisted execution truth for eligible running bots', async () => {
    vi.clearAllMocks();
    mockHasModel.mockReturnValue(true);
    mockEligibility.mockReturnValue({ eligible: true });
    mockBotPolicy.mockReturnValue({ valid: true });
    mockFindMany.mockResolvedValue([persistedPosition()]);

    const res = await GET(new Request('http://localhost/api/trading/engine/positions'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0]).toEqual(expect.objectContaining({
      id: 'ppos_abc123',
      botId: 'bot-1',
      accountId: 'acc-1',
      symbol: 'BTC',
      executionEnvironment: 'paper',
    }));
    expect(body[0]).not.toHaveProperty('account');
    expect(body[0]).not.toHaveProperty('bot');
    expect(JSON.stringify(body[0])).not.toContain('apiKey');
    expect(res.headers.get('x-storage')).toBe('db');
    expect(res.headers.get('x-execution-environment')).toBe('paper');
  });

  it('filters an account that fails strict demo eligibility', async () => {
    vi.clearAllMocks();
    mockHasModel.mockReturnValue(true);
    mockEligibility.mockReturnValue({ eligible: false, reason: 'wrong-broker' });
    mockBotPolicy.mockReturnValue({ valid: true });
    mockFindMany.mockResolvedValue([persistedPosition()]);

    const res = await GET(new Request('http://localhost/api/trading/engine/positions'));
    expect(await res.json()).toEqual([]);
  });

  it('filters a bot that is not running even if the persisted position is open', async () => {
    vi.clearAllMocks();
    mockHasModel.mockReturnValue(true);
    mockEligibility.mockReturnValue({ eligible: true });
    mockBotPolicy.mockReturnValue({ valid: true });
    mockFindMany.mockResolvedValue([
      persistedPosition({
        bot: {
          ...persistedPosition().bot,
          status: 'paused',
        },
      }),
    ]);

    const res = await GET(new Request('http://localhost/api/trading/engine/positions'));
    expect(await res.json()).toEqual([]);
  });

  it('fails closed when persistence is unavailable', async () => {
    vi.clearAllMocks();
    mockHasModel.mockReturnValue(false);

    const res = await GET(new Request('http://localhost/api/trading/engine/positions'));
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.code).toBe('SERVICE_UNAVAILABLE');
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it('contains no broker-construction or demo-memory fallback path', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/api/trading/engine/positions/route.ts'),
      'utf8',
    );
    expect(source).not.toContain("@/lib/broker/factory");
    expect(source).not.toContain('createBrokerFromAccount');
    expect(source).not.toContain('DemoBroker');
    expect(source).not.toContain('loadDemoPositionSLTP');
    expect(source).toContain("id: { startsWith: 'ppos_' }");
  });
});
