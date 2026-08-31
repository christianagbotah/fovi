import { describe, expect, it } from 'vitest';
import {
  evaluateAutomatedTradeRisk,
  PLATFORM_MAX_POSITION_ALLOCATION_PCT,
  RISK_ENGINE_VERSION,
} from '@/lib/trading-intelligence/risk-engine';

const baseCandidate = {
  symbol: 'BTC',
  side: 'buy' as const,
  entryPrice: 100,
  stopLoss: 95,
  takeProfit: 110,
  confidence: 80,
  strategy: 'signal_based',
  timeframe: '4h',
};

const baseContext = {
  accountBalance: 100_000,
  allocationAmount: 10_000,
  riskPerTradePct: 2,
  maxPositions: 3,
  currentOpenPositions: 0,
};

describe('Phase 2C canonical risk engine', () => {
  it('approves a valid long and caps notional at 20% of allocation', () => {
    const result = evaluateAutomatedTradeRisk(baseCandidate, baseContext);
    expect(result.approved).toBe(true);
    if (!result.approved) return;
    expect(result.engineVersion).toBe(RISK_ENGINE_VERSION);
    expect(result.positionNotional).toBe(2_000);
    expect(result.quantity).toBe(20);
    expect(result.riskAmount).toBe(100);
    expect(result.riskPercentOfAllocation).toBe(1);
    expect(result.riskReward).toBe(2);
    expect(result.effectivePositionCap).toBe(
      baseContext.allocationAmount * (PLATFORM_MAX_POSITION_ALLOCATION_PCT / 100),
    );
  });

  it('approves a structurally valid short', () => {
    const result = evaluateAutomatedTradeRisk(
      { ...baseCandidate, side: 'sell', stopLoss: 105, takeProfit: 90 },
      baseContext,
    );
    expect(result.approved).toBe(true);
    if (result.approved) expect(result.riskReward).toBe(2);
  });

  it('rejects risk above the platform 2% cap', () => {
    const result = evaluateAutomatedTradeRisk(baseCandidate, { ...baseContext, riskPerTradePct: 2.01 });
    expect(result).toMatchObject({ approved: false, code: 'RISK_PER_TRADE_EXCEEDS_PLATFORM_CAP' });
  });

  it('rejects allocation greater than verified account balance', () => {
    const result = evaluateAutomatedTradeRisk(baseCandidate, {
      ...baseContext, accountBalance: 5_000, allocationAmount: 10_000,
    });
    expect(result).toMatchObject({ approved: false, code: 'ALLOCATION_EXCEEDS_BALANCE' });
  });

  it('rejects when maximum positions is reached', () => {
    const result = evaluateAutomatedTradeRisk(baseCandidate, {
      ...baseContext, currentOpenPositions: 3,
    });
    expect(result).toMatchObject({ approved: false, code: 'MAX_POSITIONS_REACHED' });
  });

  it('rejects invalid long stop-loss direction', () => {
    const result = evaluateAutomatedTradeRisk({ ...baseCandidate, stopLoss: 101 }, baseContext);
    expect(result).toMatchObject({ approved: false, code: 'INVALID_STOP_LOSS_DIRECTION' });
  });

  it('rejects invalid short take-profit direction', () => {
    const result = evaluateAutomatedTradeRisk(
      { ...baseCandidate, side: 'sell', stopLoss: 105, takeProfit: 101 },
      baseContext,
    );
    expect(result).toMatchObject({ approved: false, code: 'INVALID_TAKE_PROFIT_DIRECTION' });
  });

  it('rejects reward/risk below 1:1', () => {
    const result = evaluateAutomatedTradeRisk(
      { ...baseCandidate, stopLoss: 90, takeProfit: 105 },
      baseContext,
    );
    expect(result).toMatchObject({ approved: false, code: 'RISK_REWARD_TOO_LOW' });
  });

  it('honors a stricter explicit position-notional cap', () => {
    const result = evaluateAutomatedTradeRisk(baseCandidate, {
      ...baseContext, maxPositionNotional: 750,
    });
    expect(result.approved).toBe(true);
    if (result.approved) {
      expect(result.positionNotional).toBe(750);
      expect(result.quantity).toBe(7.5);
      expect(result.effectivePositionCap).toBe(750);
    }
  });

  it('is deterministic for identical inputs', () => {
    const first = evaluateAutomatedTradeRisk(baseCandidate, baseContext);
    const second = evaluateAutomatedTradeRisk(baseCandidate, baseContext);
    expect(second).toEqual(first);
  });
});
