import { describe, expect, it } from 'vitest';
import {
  selectStrategyCandidate,
  STRATEGY_ENGINE_VERSION,
} from '@/lib/trading-intelligence/strategy-engine';

const bullish = {
  signalType: 'macd_crossover' as const,
  direction: 'bullish' as const,
  confidence: 80,
  reasoning: 'Bullish MACD confirmation',
  entryPrice: 100,
  stopLoss: 95,
  takeProfit: 110,
};

const bearish = {
  signalType: 'trend_reversal' as const,
  direction: 'bearish' as const,
  confidence: 82,
  reasoning: 'Bearish trend confirmation',
  entryPrice: 100,
  stopLoss: 105,
  takeProfit: 90,
};

describe('Phase 2C canonical strategy engine', () => {
  it('rejects unsupported verified timeframe', () => {
    const result = selectStrategyCandidate([bullish], {
      symbol: 'BTC', strategy: 'signal_based', timeframe: '1h',
    });
    expect(result).toMatchObject({ action: 'hold', code: 'UNSUPPORTED_VERIFIED_TIMEFRAME' });
  });

  it('rejects unknown strategy instead of silently falling back', () => {
    const result = selectStrategyCandidate([bullish], {
      symbol: 'BTC', strategy: 'mystery', timeframe: '4h',
    });
    expect(result).toMatchObject({ action: 'hold', code: 'UNSUPPORTED_STRATEGY' });
  });

  it('ignores malformed price structure', () => {
    const result = selectStrategyCandidate([{ ...bullish, stopLoss: 101 }], {
      symbol: 'BTC', strategy: 'signal_based', timeframe: '4h',
    });
    expect(result).toMatchObject({ action: 'hold', code: 'NO_VALID_CANDIDATE' });
  });

  it('enforces scalping confidence threshold', () => {
    const result = selectStrategyCandidate([{ ...bullish, confidence: 69 }], {
      symbol: 'BTC', strategy: 'scalping', timeframe: '4h',
    });
    expect(result).toMatchObject({ action: 'hold', code: 'NO_VALID_CANDIDATE' });
  });

  it('enforces conservative confidence threshold', () => {
    const candidate = {
      ...bullish,
      signalType: 'rsi_divergence' as const,
      confidence: 74,
    };
    const result = selectStrategyCandidate([candidate], {
      symbol: 'BTC', strategy: 'conservative', timeframe: '4h',
    });
    expect(result).toMatchObject({ action: 'hold', code: 'NO_VALID_CANDIDATE' });
  });

  it('filters momentum candidates by canonical signal types', () => {
    const rejected = {
      ...bullish,
      signalType: 'rsi_divergence' as const,
      confidence: 90,
    };
    const result = selectStrategyCandidate([rejected, bullish], {
      symbol: 'BTC', strategy: 'momentum', timeframe: '4h',
    });
    expect(result.action).toBe('trade');
    if (result.action === 'trade') expect(result.trade.signalType).toBe('macd_crossover');
  });

  it('does not permit bearish DCA decisions', () => {
    const result = selectStrategyCandidate([bearish], {
      symbol: 'BTC', strategy: 'dca', timeframe: '4h',
    });
    expect(result).toMatchObject({ action: 'hold', code: 'NO_VALID_CANDIDATE' });
  });

  it('uses deterministic tie-breaking for equal confidence', () => {
    const alternate = {
      ...bullish,
      signalType: 'breakout' as const,
      reasoning: 'Breakout confirmation',
    };
    const first = selectStrategyCandidate([bullish, alternate], {
      symbol: 'btc', strategy: 'signal_based', timeframe: '4h',
    });
    const second = selectStrategyCandidate([alternate, bullish], {
      symbol: 'btc', strategy: 'signal_based', timeframe: '4h',
    });
    expect(second).toEqual(first);
    expect(first.action).toBe('trade');
    if (first.action === 'trade') expect(first.trade.signalType).toBe('breakout');
  });

  it('returns a versioned normalized trade decision', () => {
    const result = selectStrategyCandidate([bullish], {
      symbol: ' btc ', strategy: 'signal_based', timeframe: '4h',
    });
    expect(result.action).toBe('trade');
    if (result.action === 'trade') {
      expect(result.strategyVersion).toBe(STRATEGY_ENGINE_VERSION);
      expect(result.trade.strategyVersion).toBe(STRATEGY_ENGINE_VERSION);
      expect(result.trade.symbol).toBe('BTC');
      expect(result.trade.side).toBe('buy');
    }
  });

  it('holds when no candidate passes canonical policy', () => {
    const result = selectStrategyCandidate([], {
      symbol: 'BTC', strategy: 'balanced', timeframe: '4h',
    });
    expect(result).toMatchObject({ action: 'hold', code: 'NO_VALID_CANDIDATE' });
  });
});
