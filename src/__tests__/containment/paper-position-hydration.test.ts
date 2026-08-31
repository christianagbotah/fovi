import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const { mockFindMany, mockOrderFindMany, mockHasModel, mockEligibility, mockBotPolicy } = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockOrderFindMany: vi.fn(),
  mockHasModel: vi.fn(() => true),
  mockEligibility: vi.fn((): { eligible: boolean; reason?: string } => ({ eligible: true })),
  mockBotPolicy: vi.fn(() => ({ valid: true })),
}));

vi.mock('@/lib/db', () => ({
  db: {
    position: { findMany: mockFindMany },
    order: { findMany: mockOrderFindMany },
  },
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
import {
  EXECUTION_CONTRACT_VERSION,
  LEGACY_EXECUTION_CONTRACT_VERSION,
  buildLegacyPaperPositionId,
  buildPaperExecutionIntent,
  buildPaperPositionId,
} from '@/lib/trading-intelligence/execution-contract';
import { RISK_ENGINE_VERSION } from '@/lib/trading-intelligence/risk-engine';
import { STRATEGY_ENGINE_VERSION } from '@/lib/trading-intelligence/strategy-engine';

function executionIntent() {
  return buildPaperExecutionIntent({
    userId: 'user-1',
    botId: 'bot-1',
    accountId: 'acc-1',
    symbol: 'BTC',
    assetType: 'crypto',
    side: 'buy',
    quantity: 0.5,
    referencePrice: 50_000,
    stopLoss: 49_000,
    takeProfit: 52_000,
    confidence: 80,
    strategy: 'signal_based',
    timeframe: '4h',
    strategyVersion: STRATEGY_ENGINE_VERSION,
    riskEngineVersion: RISK_ENGINE_VERSION,
    positionNotional: 25_000,
    riskAmount: 500,
    riskPercentOfAllocation: 5,
    riskReward: 2,
    reason: 'canonical signal',
    marketData: {
      environment: 'live',
      isSynthetic: false,
      source: 'coingecko',
      observedAt: '2026-08-31T05:00:00.000Z',
    },
  });
}

function persistedPosition(overrides: Record<string, unknown> = {}) {
  const intent = executionIntent();
  return {
    id: buildPaperPositionId(intent),
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
    status: 'open',
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

function openingOrder(overrides: Record<string, unknown> = {}) {
  const intent = executionIntent();
  const positionId = buildPaperPositionId(intent);
  return {
    id: intent.executionIntentId,
    accountId: intent.accountId,
    botId: intent.botId,
    symbol: intent.symbol,
    side: intent.side,
    qty: intent.quantity,
    filledQty: intent.quantity,
    filledPrice: intent.referencePrice,
    status: 'filled',
    aiGenerated: true,
    createdAt: new Date('2026-08-31T05:00:00Z'),
    reason: JSON.stringify({
      executionContractVersion: EXECUTION_CONTRACT_VERSION,
      executionEnvironment: 'paper',
      positionId,
      referencePrice: intent.referencePrice,
    }),
    ...overrides,
  };
}

describe('Phase 2F authoritative paper position hydration', () => {
  it('returns only safe persisted execution truth backed by exactly one opening order', async () => {
    vi.clearAllMocks();
    mockHasModel.mockReturnValue(true);
    mockEligibility.mockReturnValue({ eligible: true });
    mockBotPolicy.mockReturnValue({ valid: true });
    mockFindMany.mockResolvedValue([persistedPosition()]);
    mockOrderFindMany.mockResolvedValue([openingOrder()]);

    const res = await GET(new Request('http://localhost/api/trading/engine/positions'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0]).toEqual(expect.objectContaining({
      id: buildPaperPositionId(executionIntent()),
      botId: 'bot-1',
      accountId: 'acc-1',
      symbol: 'BTC',
      executionEnvironment: 'paper',
      lifecycle: 'phase2f-v2',
      openingOrderId: executionIntent().executionIntentId,
    }));
    expect(body[0]).not.toHaveProperty('account');
    expect(body[0]).not.toHaveProperty('bot');
    expect(JSON.stringify(body[0])).not.toContain('apiKey');
    expect(res.headers.get('x-storage')).toBe('db');
    expect(res.headers.get('x-execution-environment')).toBe('paper');
    expect(res.headers.get('x-lifecycle-attestation')).toBe('phase2f-paper-lifecycle-v1');
  });

  it('supports a still-open legacy Phase 2D paper position when its old audit truth matches', async () => {
    vi.clearAllMocks();
    mockHasModel.mockReturnValue(true);
    mockEligibility.mockReturnValue({ eligible: true });
    mockBotPolicy.mockReturnValue({ valid: true });
    const intent = executionIntent();
    const legacyId = buildLegacyPaperPositionId(intent);
    mockFindMany.mockResolvedValue([persistedPosition({ id: legacyId })]);
    mockOrderFindMany.mockResolvedValue([openingOrder({
      reason: JSON.stringify({
        executionContractVersion: LEGACY_EXECUTION_CONTRACT_VERSION,
        executionEnvironment: 'paper',
        referencePrice: intent.referencePrice,
      }),
    })]);

    const res = await GET(new Request('http://localhost/api/trading/engine/positions'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body[0]).toEqual(expect.objectContaining({
      id: legacyId,
      lifecycle: 'legacy-phase2d-v1',
    }));
  });

  it('fails the whole hydration when an active open paper position has no opening-order truth', async () => {
    vi.clearAllMocks();
    mockHasModel.mockReturnValue(true);
    mockEligibility.mockReturnValue({ eligible: true });
    mockBotPolicy.mockReturnValue({ valid: true });
    mockFindMany.mockResolvedValue([persistedPosition()]);
    mockOrderFindMany.mockResolvedValue([]);

    const res = await GET(new Request('http://localhost/api/trading/engine/positions'));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe('PAPER_POSITION_LIFECYCLE_INCONSISTENT');
  });

  it('fails hydration when opening-order fill truth disagrees with the open position', async () => {
    vi.clearAllMocks();
    mockHasModel.mockReturnValue(true);
    mockEligibility.mockReturnValue({ eligible: true });
    mockBotPolicy.mockReturnValue({ valid: true });
    mockFindMany.mockResolvedValue([persistedPosition()]);
    mockOrderFindMany.mockResolvedValue([openingOrder({ filledPrice: 51_000 })]);

    const res = await GET(new Request('http://localhost/api/trading/engine/positions'));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe('PAPER_POSITION_LIFECYCLE_INCONSISTENT');
  });

  it('filters an account that fails strict demo eligibility without querying opening orders', async () => {
    vi.clearAllMocks();
    mockHasModel.mockReturnValue(true);
    mockEligibility.mockReturnValue({ eligible: false, reason: 'wrong-broker' });
    mockBotPolicy.mockReturnValue({ valid: true });
    mockFindMany.mockResolvedValue([persistedPosition()]);

    const res = await GET(new Request('http://localhost/api/trading/engine/positions'));
    expect(await res.json()).toEqual([]);
    expect(mockOrderFindMany).not.toHaveBeenCalled();
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
    expect(mockOrderFindMany).not.toHaveBeenCalled();
  });

  it('fails closed when lifecycle persistence is unavailable', async () => {
    vi.clearAllMocks();
    mockHasModel.mockReturnValue(false);

    const res = await GET(new Request('http://localhost/api/trading/engine/positions'));
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.code).toBe('SERVICE_UNAVAILABLE');
    expect(mockFindMany).not.toHaveBeenCalled();
    expect(mockOrderFindMany).not.toHaveBeenCalled();
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
    expect(source).toContain('validatePaperOpeningOrderForPosition');
  });
});
