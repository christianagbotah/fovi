import { describe, expect, it } from 'vitest';
import {
  PAPER_SETTLEMENT_ACCOUNTING_VERSION,
  POSITION_RECONCILIATION_CONTRACT_VERSION,
  buildPaperCloseIntent,
  buildPaperCloseOrderId,
  buildPaperSettlementId,
  calculatePaperRawPnl,
  computePaperCloseIntentId,
  validatePaperCloseAgainstPosition,
  validatePaperCloseIntent,
  validatePaperSettlement,
  type PaperSettlementValues,
} from '@/lib/trading-intelligence/position-reconciliation';

function makeIntent(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return buildPaperCloseIntent({
    userId: 'user-1',
    botId: 'bot-1',
    accountId: 'acc-1',
    positionId: 'ppos_abc123',
    symbol: 'BTC',
    side: 'long',
    quantity: 0.5,
    referencePrice: 49_000,
    reason: 'stop_loss',
    marketData: {
      environment: 'live',
      isSynthetic: false,
      source: 'coingecko',
      observedAt: now,
    },
    ...overrides,
  } as Parameters<typeof buildPaperCloseIntent>[0]);
}

function persistedPosition(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ppos_abc123',
    botId: 'bot-1',
    accountId: 'acc-1',
    symbol: 'BTC',
    side: 'long',
    qty: 0.5,
    avgEntryPrice: 50_000,
    stopLoss: 49_500,
    takeProfit: 52_000,
    status: 'open',
    ...overrides,
  };
}

function settlementValues(overrides: Partial<PaperSettlementValues> = {}): PaperSettlementValues {
  return {
    positionId: 'ppos_abc123',
    closeOrderId: buildPaperCloseOrderId('ppos_abc123'),
    userId: 'user-1',
    accountId: 'acc-1',
    botId: 'bot-1',
    symbol: 'BTC',
    side: 'long',
    quantity: 0.5,
    entryPrice: 50_000,
    exitPrice: 53_000,
    rawPnl: 1_500,
    adminLevyPercent: 10,
    adminLevy: 150,
    realizedPnl: 1_350,
    balanceBefore: 100_000,
    balanceAfter: 101_350,
    closeReason: 'take_profit',
    marketDataSource: 'coingecko',
    marketObservedAt: '2026-08-31T07:00:00.000Z',
    ...overrides,
  };
}

describe('Phase 2G paper close and settlement contract', () => {
  it('uses the current Phase 2G close/accounting versions', () => {
    expect(POSITION_RECONCILIATION_CONTRACT_VERSION).toBe('phase2g-paper-position-close-v2');
    expect(PAPER_SETTLEMENT_ACCOUNTING_VERSION).toBe('phase2g-paper-settlement-v1');
  });

  it('builds a deterministic integrity ID from the full close snapshot', () => {
    const a = makeIntent();
    const b = makeIntent({ marketData: { ...a.marketData } });
    expect(a.closeIntentId).toBe(b.closeIntentId);
    expect(a.closeIntentId).toBe(computePaperCloseIntentId(a));
  });

  it('uses position-stable close order and settlement IDs for durable idempotency', () => {
    expect(buildPaperCloseOrderId('ppos_abc123')).toBe(buildPaperCloseOrderId('ppos_abc123'));
    expect(buildPaperCloseOrderId('ppos_abc123')).not.toBe(buildPaperCloseOrderId('ppos_other'));
    expect(buildPaperSettlementId('ppos_abc123')).toBe(buildPaperSettlementId('ppos_abc123'));
    expect(buildPaperSettlementId('ppos_abc123')).not.toBe(buildPaperSettlementId('ppos_other'));
    expect(buildPaperSettlementId('ppos_abc123')).toMatch(/^psett_[a-f0-9]{40}$/);
  });

  it('validates exact durable settlement truth', () => {
    const expected = settlementValues();
    const actual = {
      id: buildPaperSettlementId(expected.positionId),
      ...expected,
      marketObservedAt: new Date(expected.marketObservedAt),
    };
    expect(validatePaperSettlement(expected, actual)).toEqual({ valid: true });
  });

  it('rejects tampered settlement money/balance truth', () => {
    const expected = settlementValues();
    const actual = {
      id: buildPaperSettlementId(expected.positionId),
      ...expected,
      balanceAfter: expected.balanceAfter + 1,
      marketObservedAt: new Date(expected.marketObservedAt),
    };
    expect(validatePaperSettlement(expected, actual)).toEqual(expect.objectContaining({
      valid: false,
      code: 'PAPER_SETTLEMENT_MISMATCH',
    }));
  });

  it('rejects a missing deterministic settlement row', () => {
    expect(validatePaperSettlement(settlementValues(), null)).toEqual(expect.objectContaining({
      valid: false,
      code: 'PAPER_SETTLEMENT_MISMATCH',
    }));
  });

  it('rejects tampering after the close intent is built', () => {
    const intent = makeIntent();
    const tampered = { ...intent, referencePrice: intent.referencePrice - 1_000 };
    const result = validatePaperCloseIntent(tampered);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe('INVALID_CLOSE_INTENT_ID');
  });

  it('rejects synthetic/demo market data', () => {
    const intent = makeIntent({
      marketData: {
        environment: 'demo',
        isSynthetic: true,
        source: 'fovi-demo-generator',
        observedAt: new Date().toISOString(),
      },
    });
    const result = validatePaperCloseIntent(intent);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe('UNVERIFIED_CLOSE_MARKET_DATA');
  });

  it('rejects stale close snapshots', () => {
    const intent = makeIntent({
      marketData: {
        environment: 'live',
        isSynthetic: false,
        source: 'coingecko',
        observedAt: new Date(Date.now() - 121_000).toISOString(),
      },
    });
    const result = validatePaperCloseIntent(intent);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe('STALE_CLOSE_MARKET_SNAPSHOT');
  });

  it('accepts a long stop-loss only after the persisted threshold is crossed', () => {
    const intent = makeIntent({ referencePrice: 49_000, reason: 'stop_loss' });
    expect(validatePaperCloseAgainstPosition(intent, persistedPosition())).toEqual({
      valid: true,
      triggerPrice: 49_500,
    });
  });

  it('rejects a stop-loss close before the threshold is crossed', () => {
    const intent = makeIntent({ referencePrice: 49_700, reason: 'stop_loss' });
    const result = validatePaperCloseAgainstPosition(intent, persistedPosition());
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe('POSITION_CLOSE_TRIGGER_NOT_MET');
  });

  it('accepts long take-profit and short stop-loss/take-profit directionality', () => {
    expect(validatePaperCloseAgainstPosition(
      makeIntent({ referencePrice: 52_100, reason: 'take_profit' }),
      persistedPosition(),
    ).valid).toBe(true);

    const shortPosition = persistedPosition({
      side: 'short',
      avgEntryPrice: 50_000,
      stopLoss: 51_000,
      takeProfit: 48_000,
    });
    expect(validatePaperCloseAgainstPosition(
      makeIntent({ side: 'short', referencePrice: 51_100, reason: 'stop_loss' }),
      shortPosition,
    ).valid).toBe(true);
    expect(validatePaperCloseAgainstPosition(
      makeIntent({ side: 'short', referencePrice: 47_900, reason: 'take_profit' }),
      shortPosition,
    ).valid).toBe(true);
  });

  it('rejects close intents that do not match persisted position identity/quantity', () => {
    const result = validatePaperCloseAgainstPosition(makeIntent(), persistedPosition({ qty: 0.75 }));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe('POSITION_CLOSE_MISMATCH');
  });

  it('calculates deterministic raw P&L for long and short positions', () => {
    expect(calculatePaperRawPnl('long', 50_000, 52_000, 0.5)).toBe(1_000);
    expect(calculatePaperRawPnl('short', 50_000, 48_000, 0.5)).toBe(1_000);
    expect(calculatePaperRawPnl('long', 50_000, 49_000, 0.5)).toBe(-500);
  });
});
