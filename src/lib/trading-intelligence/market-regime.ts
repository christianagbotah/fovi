import type { CandleData } from '../types';
import { fullAnalysis } from '../ai/technical-analysis';
import { normalizeCanonicalStrategy, type CanonicalStrategy } from './strategy-engine';

export const MARKET_REGIME_ENGINE_VERSION = 'phase2m-market-regime-v1';

export type MarketRegime =
  | 'strong_uptrend'
  | 'strong_downtrend'
  | 'range'
  | 'compression'
  | 'high_volatility'
  | 'indeterminate';

export interface MarketRegimeSnapshot {
  regime: MarketRegime;
  engineVersion: typeof MARKET_REGIME_ENGINE_VERSION;
  adx: number | null;
  atrPercent: number | null;
  bollingerWidthPercent: number | null;
  trendSpreadPercent: number | null;
  reason: string;
}

export type MarketRegimeGovernanceDecision =
  | {
      allowed: true;
      snapshot: MarketRegimeSnapshot;
    }
  | {
      allowed: false;
      code: 'REGIME_INCOMPATIBLE' | 'REGIME_UNAVAILABLE';
      reason: string;
      snapshot: MarketRegimeSnapshot;
    };

function finitePositive(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function classifyMarketRegime(candles: readonly CandleData[]): MarketRegimeSnapshot {
  if (candles.length < 50) {
    return {
      regime: 'indeterminate',
      engineVersion: MARKET_REGIME_ENGINE_VERSION,
      adx: null,
      atrPercent: null,
      bollingerWidthPercent: null,
      trendSpreadPercent: null,
      reason: `At least 50 verified candles are required for regime classification; received ${candles.length}.`,
    };
  }

  const analysis = fullAnalysis([...candles]);
  const price = analysis.currentPrice;
  const { adx, atr, bb, sma20, sma50 } = analysis;

  if (
    !finitePositive(price) ||
    !finitePositive(atr) ||
    !finitePositive(bb?.width) ||
    !finitePositive(sma20) ||
    !finitePositive(sma50) ||
    adx === null ||
    !Number.isFinite(adx) ||
    adx < 0
  ) {
    return {
      regime: 'indeterminate',
      engineVersion: MARKET_REGIME_ENGINE_VERSION,
      adx: adx !== null && Number.isFinite(adx) ? adx : null,
      atrPercent: null,
      bollingerWidthPercent: bb?.width && Number.isFinite(bb.width) ? bb.width : null,
      trendSpreadPercent: null,
      reason: 'Verified candles did not produce a complete finite regime-indicator set.',
    };
  }

  const atrPercent = (atr / price) * 100;
  const trendSpreadPercent = (Math.abs(sma20 - sma50) / price) * 100;
  const bollingerWidthPercent = bb.width;

  if (atrPercent >= 5 || bollingerWidthPercent >= 12) {
    return {
      regime: 'high_volatility',
      engineVersion: MARKET_REGIME_ENGINE_VERSION,
      adx,
      atrPercent,
      bollingerWidthPercent,
      trendSpreadPercent,
      reason: 'Volatility is elevated relative to the current verified market price.',
    };
  }

  if (bollingerWidthPercent <= 3 && adx < 22) {
    return {
      regime: 'compression',
      engineVersion: MARKET_REGIME_ENGINE_VERSION,
      adx,
      atrPercent,
      bollingerWidthPercent,
      trendSpreadPercent,
      reason: 'Bollinger width and trend strength indicate a compressed low-direction market.',
    };
  }

  if (adx >= 25 && trendSpreadPercent >= 0.5) {
    const up = sma20 > sma50;
    return {
      regime: up ? 'strong_uptrend' : 'strong_downtrend',
      engineVersion: MARKET_REGIME_ENGINE_VERSION,
      adx,
      atrPercent,
      bollingerWidthPercent,
      trendSpreadPercent,
      reason: up
        ? 'ADX and moving-average separation indicate a strong upward trend.'
        : 'ADX and moving-average separation indicate a strong downward trend.',
    };
  }

  return {
    regime: 'range',
    engineVersion: MARKET_REGIME_ENGINE_VERSION,
    adx,
    atrPercent,
    bollingerWidthPercent,
    trendSpreadPercent,
    reason: 'Trend strength and moving-average separation do not indicate a strong directional regime.',
  };
}

function hold(
  strategy: CanonicalStrategy,
  snapshot: MarketRegimeSnapshot,
  explanation: string,
): MarketRegimeGovernanceDecision {
  return {
    allowed: false,
    code: 'REGIME_INCOMPATIBLE',
    reason: `${strategy} strategy held because market regime is ${snapshot.regime}: ${explanation}`,
    snapshot,
  };
}

export function evaluateMarketRegimeGovernance(
  candles: readonly CandleData[],
  strategyInput: string,
): MarketRegimeGovernanceDecision {
  const snapshot = classifyMarketRegime(candles);
  const strategy = normalizeCanonicalStrategy(strategyInput);

  if (!strategy || snapshot.regime === 'indeterminate') {
    return {
      allowed: false,
      code: 'REGIME_UNAVAILABLE',
      reason: !strategy
        ? `Market-regime governance cannot evaluate unsupported strategy: ${strategyInput}.`
        : snapshot.reason,
      snapshot,
    };
  }

  if (
    strategy === 'grid' &&
    (snapshot.regime === 'strong_uptrend' ||
      snapshot.regime === 'strong_downtrend' ||
      snapshot.regime === 'high_volatility')
  ) {
    return hold(
      strategy,
      snapshot,
      'grid paper automation is limited to range or compression conditions in this governance version.',
    );
  }

  if (
    strategy === 'momentum' &&
    (snapshot.regime === 'range' || snapshot.regime === 'compression')
  ) {
    return hold(
      strategy,
      snapshot,
      'momentum paper automation requires a directional or elevated-volatility regime in this governance version.',
    );
  }

  if (strategy === 'conservative' && snapshot.regime === 'high_volatility') {
    return hold(
      strategy,
      snapshot,
      'conservative paper automation does not create new exposure during extreme volatility.',
    );
  }

  return { allowed: true, snapshot };
}
