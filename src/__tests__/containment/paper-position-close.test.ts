import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const {
  mockPositionFindFirst,
  mockOrderFindUnique,
  mockSettlementFindUnique,
  mockOrderCreate,
  mockSettlementCreate,
  mockPositionUpdateMany,
  mockAccountFindFirst,
  mockAccountUpdateMany,
  mockBotUpdateMany,
  mockPositionFindUnique,
  mockTransaction,
  mockHasModel,
} = vi.hoisted(() => ({
  mockPositionFindFirst: vi.fn(),
  mockOrderFindUnique: vi.fn(),
  mockSettlementFindUnique: vi.fn(),
  mockOrderCreate: vi.fn(),
  mockSettlementCreate: vi.fn(),
  mockPositionUpdateMany: vi.fn(),
  mockAccountFindFirst: vi.fn(),
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
    paperTradeSettlement: { findUnique: mockSettlementFindUnique },
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
  LEGACY_POSITION_RECONCILIATION_CONTRACT_VERSION,
  PAPER_SETTLEMENT_ACCOUNTING_VERSION,
  POSITION_RECONCILIATION_CONTRACT_VERSION,
  buildPaperCloseIntent,
  buildPaperCloseOrderId,
  buildPaperSettlementId,
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
      isDemo: true, isActive: true, balance: 100_000,
      apiKey: null, apiSecret: null, passphrase: null,
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

function currentAudit(intent: ReturnType<typeof closeIntent>, values: {
  rawPnl: number;
  adminLevy: number;
  realizedPnl: number;
  balanceBefore: number;
  balanceAfter: number;
  entryPrice?: number;
  adminLevyPercent?: number;
}) {
  return {
    closeContractVersion: POSITION_RECONCILIATION_CONTRACT_VERSION,
    accountingVersion: PAPER_SETTLEMENT_ACCOUNTING_VERSION,
    closeIntentId: intent.closeIntentId,
    settlementId: buildPaperSettlementId(intent.positionId),
    executionEnvironment: 'paper',
    positionId: intent.positionId,
    closeReason: intent.reason,
    entryPrice: values.entryPrice ?? 50_000,
    exitPrice: intent.referencePrice,
    rawPnl: values.rawPnl,
    adminLevy: values.adminLevy,
    adminLevyPercent: values.adminLevyPercent ?? 10,
    realizedPnl: values.realizedPnl,
    balanceBefore: values.balanceBefore,
    balanceAfter: values.balanceAfter,
    marketData: intent.marketData,
  };
}

function settlementFor(intent: ReturnType<typeof closeIntent>, audit: ReturnType<typeof currentAudit>) {
  return {
    id: buildPaperSettlementId(intent.positionId),
    closeOrderId: buildPaperCloseOrderId(intent.positionId),
    positionId: intent.positionId,
    userId: intent.userId,
    accountId: intent.accountId,
    botId: intent.botId,
    symbol: intent.symbol,
    side: intent.side,
    quantity: intent.quantity,
    entryPrice: audit.entryPrice,
    exitPrice: audit.exitPrice,
    rawPnl: audit.rawPnl,
    adminLevyPercent: audit.adminLevyPercent,
    adminLevy: audit.adminLevy,
    realizedPnl: audit.realizedPnl,
    balanceBefore: audit.balanceBefore,
    balanceAfter: audit.balanceAfter,
    closeReason: intent.reason,
    marketDataSource: intent.marketData.source,
    marketObservedAt: new Date(intent.marketData.observedAt),
    createdAt: new Date(),
  };
}

describe('Phase 2G deterministic paper position settlement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasModel.mockReturnValue(true);
    mockPositionFindFirst.mockResolvedValue(openPosition());
    mockOrderFindUnique.mockResolvedValue(null);
    mockSettlementFindUnique.mockResolvedValue(null);
    mockOrderCreate.mockImplementation(async ({ data }) => ({ ...data }));
    mockSettlementCreate.mockImplementation(async ({ data }) => ({ ...data, createdAt: new Date() }));
    mockPositionUpdateMany.mockResolvedValue({ count: 1 });
    mockAccountUpdateMany.mockResolvedValue({ count: 1 });
    mockBotUpdateMany.mockResolvedValue({ count: 1 });
    mockAccountFindFirst
      .mockResolvedValueOnce({ id: 'acc-1', userId: 'user-1', balance: 100_000 })
      .mockResolvedValueOnce({ id: 'acc-1', userId: 'user-1', balance: 99_500 });
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
      paperTradeSettlement: { create: mockSettlementCreate },
      tradingAccount: { findFirst: mockAccountFindFirst, updateMany: mockAccountUpdateMany },
      bot: { updateMany: mockBotUpdateMany },
    }));
  });

  it('settles a verified loss atomically, decreases balance, and charges no levy', async () => {
    const intent = closeIntent();
    const res = await POST(requestFor(intent));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.idempotent).toBe(false);
    expect(body.rawPnl).toBe(-500);
    expect(body.adminLevy).toBe(0);
    expect(body.realizedPnl).toBe(-500);
    expect(body.balanceBefore).toBe(100_000);
    expect(body.balanceAfter).toBe(99_500);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockTransaction.mock.calls[0][1]).toEqual(expect.objectContaining({ isolationLevel: 'Serializable' }));

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
    expect(mockSettlementCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: buildPaperSettlementId(intent.positionId),
        closeOrderId: buildPaperCloseOrderId(intent.positionId),
        positionId: intent.positionId,
        rawPnl: -500,
        adminLevy: 0,
        realizedPnl: -500,
        balanceBefore: 100_000,
        balanceAfter: 99_500,
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
        balance: { increment: -500 },
        totalRealizedProfit: { increment: -500 },
      }),
    }));
    const lossAccountData = mockAccountUpdateMany.mock.calls[0][0].data;
    expect(lossAccountData).not.toHaveProperty('totalAdminLevyCollected');
  });

  it('credits only net profit to balance and records the platform levy', async () => {
    const profitablePosition = { ...openPosition(), stopLoss: 48_000, takeProfit: 52_000 };
    mockPositionFindFirst.mockResolvedValue(profitablePosition);
    mockPositionFindUnique.mockResolvedValue({
      ...profitablePosition,
      status: 'closed',
      currentPrice: 53_000,
      realizedPnl: 1_350,
    });
    mockAccountFindFirst.mockReset();
    mockAccountFindFirst
      .mockResolvedValueOnce({ id: 'acc-1', userId: 'user-1', balance: 100_000 })
      .mockResolvedValueOnce({ id: 'acc-1', userId: 'user-1', balance: 101_350 });
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
    expect(body.balanceBefore).toBe(100_000);
    expect(body.balanceAfter).toBe(101_350);
    expect(mockAccountUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        balance: { increment: 1_350 },
        totalRealizedProfit: { increment: 1_350 },
        totalAdminLevyCollected: { increment: 150 },
      }),
    }));
    expect(mockSettlementCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        rawPnl: 1_500,
        adminLevyPercent: 10,
        adminLevy: 150,
        realizedPnl: 1_350,
        balanceBefore: 100_000,
        balanceAfter: 101_350,
      }),
    });
    expect(mockBotUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ winTrades: { increment: 1 }, totalTrades: { increment: 1 } }),
    }));
  });

  it('returns current settlement truth on idempotent retry without applying money twice', async () => {
    const intent = closeIntent();
    const audit = currentAudit(intent, {
      rawPnl: -500,
      adminLevy: 0,
      realizedPnl: -500,
      balanceBefore: 100_000,
      balanceAfter: 99_500,
    });
    mockPositionFindFirst.mockResolvedValue({ ...openPosition(), status: 'closed', realizedPnl: -500 });
    mockOrderFindUnique.mockResolvedValue({
      id: buildPaperCloseOrderId(intent.positionId),
      reason: JSON.stringify(audit),
    });
    mockSettlementFindUnique.mockResolvedValue(settlementFor(intent, audit));

    const res = await POST(requestFor(intent));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.idempotent).toBe(true);
    expect(body.legacyAccounting).toBe(false);
    expect(body.realizedPnl).toBe(-500);
    expect(body.balanceAfter).toBe(99_500);
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockAccountUpdateMany).not.toHaveBeenCalled();
    expect(mockSettlementCreate).not.toHaveBeenCalled();
  });

  it('fails closed when current close order exists but settlement ledger is missing', async () => {
    const intent = closeIntent();
    const audit = currentAudit(intent, {
      rawPnl: -500,
      adminLevy: 0,
      realizedPnl: -500,
      balanceBefore: 100_000,
      balanceAfter: 99_500,
    });
    mockPositionFindFirst.mockResolvedValue({ ...openPosition(), status: 'closed', realizedPnl: -500 });
    mockOrderFindUnique.mockResolvedValue({
      id: buildPaperCloseOrderId(intent.positionId),
      reason: JSON.stringify(audit),
    });
    mockSettlementFindUnique.mockResolvedValue(null);

    const res = await POST(requestFor(intent));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe('PAPER_SETTLEMENT_RECONCILIATION_INCONSISTENT');
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('preserves legacy Phase 2E/F idempotent close truth without fabricating a ledger row', async () => {
    const intent = closeIntent();
    mockPositionFindFirst.mockResolvedValue({ ...openPosition(), status: 'closed', realizedPnl: -500 });
    mockOrderFindUnique.mockResolvedValue({
      id: buildPaperCloseOrderId(intent.positionId),
      reason: JSON.stringify({
        closeContractVersion: LEGACY_POSITION_RECONCILIATION_CONTRACT_VERSION,
        rawPnl: -500,
        adminLevy: 0,
        adminLevyPercent: 10,
      }),
    });

    const res = await POST(requestFor(intent));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.idempotent).toBe(true);
    expect(body.legacyAccounting).toBe(true);
    expect(body.settlement).toBeNull();
    expect(mockSettlementFindUnique).not.toHaveBeenCalled();
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

  it('requires the settlement model before any paper close mutation', async () => {
    mockHasModel.mockImplementation((name: string) => name !== 'paperTradeSettlement');
    const res = await POST(requestFor(closeIntent()));
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.code).toBe('SERVICE_UNAVAILABLE');
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
    expect(source).toContain('buildPaperSettlementId');
    expect(source).toContain('paperTradeSettlement.create');
    expect(source).toContain('TransactionIsolationLevel.Serializable');
    expect(source).toContain('balance: { increment: realizedPnl }');
  });
});
