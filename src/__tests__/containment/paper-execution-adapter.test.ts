import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const {
  mockBotFindFirst,
  mockOrderFindUnique,
  mockPositionFindFirst,
  mockPositionCount,
  mockOrderCreate,
  mockPositionCreate,
  mockTransaction,
} = vi.hoisted(() => ({
  mockBotFindFirst: vi.fn(),
  mockOrderFindUnique: vi.fn(),
  mockPositionFindFirst: vi.fn(),
  mockPositionCount: vi.fn(),
  mockOrderCreate: vi.fn(),
  mockPositionCreate: vi.fn(),
  mockTransaction: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    bot: { findFirst: mockBotFindFirst },
    order: { findUnique: mockOrderFindUnique },
    position: { findFirst: mockPositionFindFirst, count: mockPositionCount },
    $transaction: mockTransaction,
  },
  hasModel: vi.fn(() => true),
}));

vi.mock('@/lib/trading-policy', () => ({
  enforceInternalAuth: vi.fn(() => null),
  logSecurityEvent: vi.fn(),
}));

vi.mock('@/lib/engine-eligibility', () => ({
  evaluateEngineAccountEligibility: vi.fn(() => ({ eligible: true })),
}));

import { POST } from '@/app/api/trading/engine/execute/route';
import {
  buildPaperExecutionIntent,
  buildPaperPositionId,
  type PaperExecutionIntent,
} from '@/lib/trading-intelligence/execution-contract';
import { RISK_ENGINE_VERSION } from '@/lib/trading-intelligence/risk-engine';
import { STRATEGY_ENGINE_VERSION } from '@/lib/trading-intelligence/strategy-engine';

function makeIntent(): PaperExecutionIntent {
  return buildPaperExecutionIntent({
    userId: 'user-1',
    botId: 'bot-1',
    accountId: 'acc-1',
    symbol: 'BTC',
    assetType: 'crypto',
    side: 'buy',
    quantity: 0.04,
    referencePrice: 50_000,
    stopLoss: 49_000,
    takeProfit: 52_000,
    confidence: 80,
    strategy: 'signal_based',
    timeframe: '4h',
    strategyVersion: STRATEGY_ENGINE_VERSION,
    riskEngineVersion: RISK_ENGINE_VERSION,
    positionNotional: 2_000,
    riskAmount: 40,
    riskPercentOfAllocation: 0.4,
    riskReward: 2,
    reason: 'canonical signal',
    marketData: {
      environment: 'live',
      isSynthetic: false,
      source: 'coingecko',
      observedAt: new Date().toISOString(),
    },
  });
}

function makeRequest(intent: PaperExecutionIntent): Request {
  return new Request('http://localhost/api/trading/engine/execute', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-service-secret': 'test-secret' },
    body: JSON.stringify(intent),
  });
}

function persistedOrder(intent: PaperExecutionIntent) {
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
  };
}

function persistedPosition(intent: PaperExecutionIntent, status = 'open') {
  return {
    id: buildPaperPositionId(intent),
    accountId: intent.accountId,
    botId: intent.botId,
    symbol: intent.symbol,
    side: 'long',
    status,
    qty: intent.quantity,
    avgEntryPrice: intent.referencePrice,
    stopLoss: intent.stopLoss,
    takeProfit: intent.takeProfit,
  };
}

const eligibleBot = {
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
  account: {
    id: 'acc-1',
    broker: 'demo',
    accountType: 'demo',
    isDemo: true,
    isActive: true,
    balance: 100_000,
    apiKey: null,
    apiSecret: null,
    passphrase: null,
  },
};

describe('Phase 2F internal paper execution adapter', () => {
  const originalFlag = process.env.PAPER_AUTOMATED_EXECUTION_ENABLED;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.PAPER_AUTOMATED_EXECUTION_ENABLED;

    mockBotFindFirst.mockResolvedValue(eligibleBot);
    mockOrderFindUnique.mockResolvedValue(null);
    mockPositionFindFirst.mockResolvedValue(null);
    mockPositionCount.mockResolvedValue(0);
    mockOrderCreate.mockImplementation(async ({ data }) => ({ ...data }));
    mockPositionCreate.mockImplementation(async ({ data }) => ({
      ...data,
      unrealizedPnl: 0,
      openedAt: new Date(),
    }));
    mockTransaction.mockImplementation(async (callback) => callback({
      order: { create: mockOrderCreate },
      position: { create: mockPositionCreate },
    }));
  });

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.PAPER_AUTOMATED_EXECUTION_ENABLED;
    else process.env.PAPER_AUTOMATED_EXECUTION_ENABLED = originalFlag;
  });

  it('fails closed before database mutation when paper execution flag is disabled', async () => {
    const res = await POST(makeRequest(makeIntent()));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.code).toBe('PHASE2D_PAPER_EXECUTION_DISABLED');
    expect(mockBotFindFirst).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('persists deterministic paper fill truth without a broker call', async () => {
    process.env.PAPER_AUTOMATED_EXECUTION_ENABLED = 'true';
    const intent = makeIntent();

    const res = await POST(makeRequest(intent));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.executionEnvironment).toBe('paper');
    expect(body.idempotent).toBe(false);
    expect(mockTransaction).toHaveBeenCalledTimes(1);

    expect(mockOrderCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: intent.executionIntentId,
        accountId: intent.accountId,
        botId: intent.botId,
        symbol: intent.symbol,
        filledQty: intent.quantity,
        filledPrice: intent.referencePrice,
        status: 'filled',
        aiGenerated: true,
      }),
    });
    expect(mockPositionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: buildPaperPositionId(intent),
        accountId: intent.accountId,
        botId: intent.botId,
        symbol: intent.symbol,
        qty: intent.quantity,
        avgEntryPrice: intent.referencePrice,
        currentPrice: intent.referencePrice,
        stopLoss: intent.stopLoss,
        takeProfit: intent.takeProfit,
        status: 'open',
      }),
    });
  });

  it('returns a fully reconciled existing result on an idempotent retry without another transaction', async () => {
    process.env.PAPER_AUTOMATED_EXECUTION_ENABLED = 'true';
    const intent = makeIntent();
    mockOrderFindUnique.mockResolvedValue(persistedOrder(intent));
    mockPositionFindFirst.mockResolvedValue(persistedPosition(intent));

    const res = await POST(makeRequest(intent));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.idempotent).toBe(true);
    expect(body.order.id).toBe(intent.executionIntentId);
    expect(body.position.id).toBe(buildPaperPositionId(intent));
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('fails closed when an idempotent opening order is orphaned from its deterministic position', async () => {
    process.env.PAPER_AUTOMATED_EXECUTION_ENABLED = 'true';
    const intent = makeIntent();
    mockOrderFindUnique.mockResolvedValue(persistedOrder(intent));
    mockPositionFindFirst.mockResolvedValue(null);

    const res = await POST(makeRequest(intent));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe('PAPER_EXECUTION_RECONCILIATION_INCONSISTENT');
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('does not reopen an execution intent whose deterministic position already settled', async () => {
    process.env.PAPER_AUTOMATED_EXECUTION_ENABLED = 'true';
    const intent = makeIntent();
    mockOrderFindUnique.mockResolvedValue(persistedOrder(intent));
    mockPositionFindFirst.mockResolvedValue(persistedPosition(intent, 'closed'));

    const res = await POST(makeRequest(intent));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe('PAPER_EXECUTION_ALREADY_SETTLED');
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('fails closed when persisted idempotent position fields disagree with the opening intent', async () => {
    process.env.PAPER_AUTOMATED_EXECUTION_ENABLED = 'true';
    const intent = makeIntent();
    mockOrderFindUnique.mockResolvedValue(persistedOrder(intent));
    mockPositionFindFirst.mockResolvedValue({
      ...persistedPosition(intent),
      qty: intent.quantity * 2,
    });

    const res = await POST(makeRequest(intent));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe('PAPER_EXECUTION_RECONCILIATION_INCONSISTENT');
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('contains no broker-factory or DemoBroker construction path', () => {
    const routePath = join(process.cwd(), 'src/app/api/trading/engine/execute/route.ts');
    const source = readFileSync(routePath, 'utf8');

    expect(source).not.toContain("@/lib/broker/factory");
    expect(source).not.toContain('createBrokerFromAccount');
    expect(source).not.toContain('DemoBroker');
    expect(source).toContain('PAPER_AUTOMATED_EXECUTION_ENABLED');
    expect(source).toContain('evaluateAutomatedTradeRisk');
    expect(source).toContain('validatePersistedPaperExecutionResult');
  });
});
