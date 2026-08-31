import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const {
  mockPositionFindFirst,
  mockOrderFindUnique,
  mockOrderCreate,
  mockPositionUpdateMany,
  mockAccountUpdateMany,
  mockBotUpdateMany,
  mockPositionFindUnique,
  mockTransaction,
  mockHasModel,
} = vi.hoisted(() => ({
  mockPositionFindFirst: vi.fn(),
  mockOrderFindUnique: vi.fn(),
  mockOrderCreate: vi.fn(),
  mockPositionUpdateMany: vi.fn(),
  mockAccountUpdateMany: vi.fn(),
  mockBotUpdateMany: vi.fn(),
  mockPositionFindUnique: vi.fn(),
  mockTransaction: vi.fn(),
  mockHasModel: vi.fn(() => true),
}));

vi.mock('@/lib/db', () => ({
  db: {
    position: { findFirst: mockPositionFindFirst },
    order: { findUnique: mockOrderFindUnique },
    $transaction: mockTransaction,
  },
  hasModel: mockHasModel,
}));

vi.mock('@/lib/trading-policy', () => ({
  enforceInternalAuth: vi.fn(() => null),
  logSecurityEvent: vi.fn(),
}));

vi.mock('@/lib/engine-eligibility', () => ({
  evaluateEngineAccountEligibility: vi.fn(() => ({ eligible: true })),
}));

vi.mock('@/lib/system-config', () => ({
  getGlobalAdminLevy: vi.fn(async () => 10),
}));

import { POST } from '@/app/api/trading/engine/close/route';
import {
  buildPaperCloseIntent,
  buildPaperCloseOrderId,
} from '@/lib/trading-intelligence/position-reconciliation';

function openPosition() {
  return {
    id: 'ppos_abc123',
    botId: 'bot-1',
    accountId: 'acc-1',
    symbol: 'BTC',
    assetType: 'crypto',
    side: 'long',
    qty: 0.5,
    avgEntryPrice: 50_000,
    currentPrice: 50_000,
    unrealizedPnl: 0,
    realizedPnl: 0,
    stopLoss: 49_500,
    takeProfit: 52_000,
    status: 'open',
    account: {
      id: 'acc-1', userId: 'user-1', broker: 'demo', accountType: 'demo',
      isDemo: true, isActive: true, apiKey: null, apiSecret: null, passphrase: null,
    },
    bot: {
      id: 'bot-1', userId: 'user-1', accountId: 'acc-1',
    },
  };
}

function closeIntent(referencePrice = 49_000) {
  return buildPaperCloseIntent({
    userId: 'user-1',
    botId: 'bot-1',
    accountId: 'acc-1',
    positionId: 'ppos_abc123',
    symbol: 'BTC',
    side: 'long',
    quantity: 0.5,
    referencePrice,
    reason: 'stop_loss',
    marketData: {
      environment: 'live',
      isSynthetic: false,
      source: 'coingecko',
      observedAt: new Date().toISOString(),
    },
  });
}

function requestFor(intent: ReturnType<typeof closeIntent>) {
  return new Request('http://localhost/api/trading/engine/close', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-service-secret': 'test-secret' },
    body: JSON.stringify(intent),
  });
}

describe('Phase 2E deterministic paper position close', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasModel.mockReturnValue(true);
    mockPositionFindFirst.mockResolvedValue(openPosition());
    mockOrderFindUnique.mockResolvedValue(null);
    mockOrderCreate.mockImplementation(async ({ data }) => ({ ...data }));
    mockPositionUpdateMany.mockResolvedValue({ count: 1 });
    mockAccountUpdateMany.mockResolvedValue({ count: 1 });
    mockBotUpdateMany.mockResolvedValue({ count: 1 });
    mockPositionFindUnique.mockImplementation(async () => ({
      ...openPosition(),
      status: 'closed',
      currentPrice: 49_000,
      unrealizedPnl: 0,
      realizedPnl: -500,
      closedAt: new Date(),
    }));
    mockTransaction.mockImplementation(async (callback) => callback({
      order: { create: mockOrderCreate },
      position: { updateMany: mockPositionUpdateMany, findUnique: mockPositionFindUnique },
      tradingAccount: { updateMany: mockAccountUpdateMany },
      bot: { updateMany: mockBotUpdateMany },
    }));
  });

  it('settles a verified stop-loss atomically and counts the completed trade once', async () => {
    const intent = closeIntent();
    const res = await POST(requestFor(intent));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.idempotent).toBe(false);
    expect(body.rawPnl).toBe(-500);
    expect(body.adminLevy).toBe(0);
    expect(body.realizedPnl).toBe(-500);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockOrderCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: buildPaperCloseOrderId(intent.positionId),
        side: 'sell',
        filledPrice: 49_000,
        filledQty: 0.5,
        status: 'filled',
        aiGenerated: true,
      }),
    });
    expect(mockPositionUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: intent.positionId, status: 'open' }),
      data: expect.objectContaining({ status: 'closed', currentPrice: 49_000, realizedPnl: -500 }),
    }));
    expect(mockBotUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        totalTrades: { increment: 1 },
        totalPnl: { increment: -500 },
        lossTrades: { increment: 1 },
      }),
    }));
    expect(mockAccountUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        totalRealizedProfit: { increment: -500 },
      }),
    }));
  });

  it('applies levy only to profitable paper settlement', async () => {
    const profitablePosition = { ...openPosition(), stopLoss: 48_000, takeProfit: 52_000 };
    mockPositionFindFirst.mockResolvedValue(profitablePosition);
    mockPositionFindUnique.mockResolvedValue({
      ...profitablePosition,
      status: 'closed',
      currentPrice: 53_000,
      realizedPnl: 1_350,
    });
    const intent = buildPaperCloseIntent({
      ...closeIntent(),
      referencePrice: 53_000,
      reason: 'take_profit',
    });

    const res = await POST(requestFor(intent));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.rawPnl).toBe(1_500);
    expect(body.adminLevy).toBe(150);
    expect(body.realizedPnl).toBe(1_350);
    expect(mockAccountUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        totalRealizedProfit: { increment: 1_350 },
        totalAdminLevyCollected: { increment: 150 },
      }),
    }));
    expect(mockBotUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ winTrades: { increment: 1 }, totalTrades: { increment: 1 } }),
    }));
  });

  it('returns persisted truth on idempotent retry without another transaction', async () => {
    const intent = closeIntent();
    mockPositionFindFirst.mockResolvedValue({ ...openPosition(), status: 'closed', realizedPnl: -500 });
    mockOrderFindUnique.mockResolvedValue({
      id: buildPaperCloseOrderId(intent.positionId),
      reason: JSON.stringify({ rawPnl: -500, adminLevy: 0, adminLevyPercent: 10 }),
    });

    const res = await POST(requestFor(intent));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.idempotent).toBe(true);
    expect(body.realizedPnl).toBe(-500);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('rejects a close before the persisted stop-loss is crossed', async () => {
    const res = await POST(requestFor(closeIntent(49_700)));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe('POSITION_CLOSE_TRIGGER_NOT_MET');
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('rejects tampered close intent before database mutation', async () => {
    const intent = closeIntent();
    const res = await POST(requestFor({ ...intent, referencePrice: 48_000 }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe('INVALID_CLOSE_INTENT_ID');
    expect(mockPositionFindFirst).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('contains no broker factory or DemoBroker close path', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/api/trading/engine/close/route.ts'),
      'utf8',
    );
    expect(source).not.toContain("@/lib/broker/factory");
    expect(source).not.toContain('createBrokerFromAccount');
    expect(source).not.toContain('DemoBroker');
    expect(source).toContain('buildPaperCloseOrderId');
    expect(source).toContain('db.$transaction');
  });
});
