import { describe, expect, it } from 'vitest';
import {
  buildPaperCloseIntent,
  buildPaperCloseOrderId,
  calculatePaperRawPnl,
  computePaperCloseIntentId,
  validatePaperCloseAgainstPosition,
  validatePaperCloseIntent,
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

describe('Phase 2E paper close contract', () => {
  it('builds a deterministic integrity ID from the full close snapshot', () => {
    const a = makeIntent();
    const b = makeIntent({ marketData: { ...a.marketData } });
    expect(a.closeIntentId).toBe(b.closeIntentId);
    expect(a.closeIntentId).toBe(computePaperCloseIntentId(a));
  });

  it('uses a position-stable close order ID for durable idempotency', () => {
    expect(buildPaperCloseOrderId('ppos_abc123')).toBe(buildPaperCloseOrderId('ppos_abc123'));
    expect(buildPaperCloseOrderId('ppos_abc123')).not.toBe(buildPaperCloseOrderId('ppos_other'));
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
