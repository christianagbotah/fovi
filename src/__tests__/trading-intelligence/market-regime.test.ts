import { describe, expect, it } from 'vitest';
import {
  MARKET_REGIME_ENGINE_VERSION,
  classifyMarketRegime,
  evaluateMarketRegimeGovernance,
} from '@/lib/trading-intelligence/market-regime';
import type { CandleData } from '@/lib/types';

function trendCandles(direction: 1 | -1): CandleData[] {
  return Array.from({ length: 80 }, (_, i) => {
    const base = 100 + direction * i * 0.2;
    return {
      timestamp: 1_700_000_000_000 + i * 4 * 60 * 60 * 1000,
      open: base - direction * 0.05,
      high: base + 0.25,
      low: base - 0.25,
      close: base,
      volume: 1_000 + i,
    };
  });
}

function rangeCandles(): CandleData[] {
  return Array.from({ length: 80 }, (_, i) => {
    const base = 100 + Math.sin(i / 2) * 0.8;
    return {
      timestamp: 1_700_000_000_000 + i * 4 * 60 * 60 * 1000,
      open: base - 0.1,
      high: base + 0.35,
      low: base - 0.35,
      close: base,
      volume: 1_000,
    };
  });
}

function volatileCandles(): CandleData[] {
  return Array.from({ length: 80 }, (_, i) => {
    const base = 100 + Math.sin(i) * 9;
    return {
      timestamp: 1_700_000_000_000 + i * 4 * 60 * 60 * 1000,
      open: base - 2,
      high: base + 6,
      low: Math.max(1, base - 6),
      close: base,
      volume: 2_000,
    };
  });
}

describe('Phase 2M market regime governance', () => {
  it('fails closed when there is not enough verified history', () => {
    const snapshot = classifyMarketRegime(trendCandles(1).slice(0, 30));

    expect(snapshot.regime).toBe('indeterminate');
    expect(snapshot.engineVersion).toBe(MARKET_REGIME_ENGINE_VERSION);

    const decision = evaluateMarketRegimeGovernance(trendCandles(1).slice(0, 30), 'momentum');
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('REGIME_UNAVAILABLE');
  });

  it('classifies a persistent directional series as a strong trend', () => {
    const up = classifyMarketRegime(trendCandles(1));
    const down = classifyMarketRegime(trendCandles(-1));

    expect(['strong_uptrend', 'high_volatility']).toContain(up.regime);
    expect(['strong_downtrend', 'high_volatility']).toContain(down.regime);
    expect(up.engineVersion).toBe(MARKET_REGIME_ENGINE_VERSION);
    expect(down.engineVersion).toBe(MARKET_REGIME_ENGINE_VERSION);
  });

  it('holds grid automation during clearly directional or highly volatile regimes', () => {
    for (const candles of [trendCandles(1), trendCandles(-1), volatileCandles()]) {
      const decision = evaluateMarketRegimeGovernance(candles, 'grid');
      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.code).toBe('REGIME_INCOMPATIBLE');
        expect(decision.snapshot.regime).not.toBe('indeterminate');
      }
    }
  });

  it('holds momentum automation in range/compression conditions', () => {
    const decision = evaluateMarketRegimeGovernance(rangeCandles(), 'momentum');

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(['REGIME_INCOMPATIBLE', 'REGIME_UNAVAILABLE']).toContain(decision.code);
      if (decision.code === 'REGIME_INCOMPATIBLE') {
        expect(['range', 'compression']).toContain(decision.snapshot.regime);
      }
    }
  });

  it('holds conservative automation when volatility is extreme', () => {
    const decision = evaluateMarketRegimeGovernance(volatileCandles(), 'conservative');

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.code).toBe('REGIME_INCOMPATIBLE');
      expect(decision.snapshot.regime).toBe('high_volatility');
    }
  });

  it('does not add a regime veto to general signal-based automation when classification is available', () => {
    const decision = evaluateMarketRegimeGovernance(trendCandles(1), 'signal_based');

    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      expect(decision.snapshot.regime).not.toBe('indeterminate');
    }
  });
});
