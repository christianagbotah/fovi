// ============================================================
// Phase 2C — Canonical Strategy Decision Engine
// ------------------------------------------------------------
// One deterministic policy converts technical-analysis candidates into
// a trade-or-hold decision. Indicator generation stays pure underneath;
// execution paths consume only this versioned decision contract.
// ============================================================

import { generateSignals } from '../ai/signals';
import type { CandleData, SignalType, Timeframe } from '../types';

export const STRATEGY_ENGINE_VERSION = 'phase2c-strategy-v1';
export const STRATEGY_VERIFIED_TIMEFRAMES = Object.freeze(['4h'] as const);

export type CanonicalStrategy =
  | 'signal_based'
  | 'balanced'
  | 'momentum'
  | 'scalping'
  | 'conservative'
  | 'dca'
  | 'grid';

export type StrategyHoldCode =
  | 'UNSUPPORTED_STRATEGY'
  | 'UNSUPPORTED_VERIFIED_TIMEFRAME'
  | 'INSUFFICIENT_HISTORY'
  | 'NO_VALID_CANDIDATE';

export interface StrategyCandidateInput {
  signalType: SignalType;
  direction: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  reasoning: string;
  entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
}

export interface CanonicalTradeSignal {
  symbol: string;
  side: 'buy' | 'sell';
  confidence: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  reason: string;
  signalType: SignalType;
  strategy: CanonicalStrategy;
  timeframe: '4h';
  strategyVersion: typeof STRATEGY_ENGINE_VERSION;
}

export type StrategyDecision =
  | {
      action: 'trade';
      strategyVersion: typeof STRATEGY_ENGINE_VERSION;
      trade: CanonicalTradeSignal;
    }
  | {
      action: 'hold';
      strategyVersion: typeof STRATEGY_ENGINE_VERSION;
      code: StrategyHoldCode;
      reason: string;
    };

const MIN_CONFIDENCE: Record<CanonicalStrategy, number> = {
  signal_based: 60,
  balanced: 60,
  momentum: 60,
  scalping: 70,
  conservative: 75,
  dca: 60,
  grid: 60,
};

const ALLOWED_SIGNAL_TYPES: Record<CanonicalStrategy, ReadonlySet<SignalType> | null> = {
  signal_based: null,
  balanced: null,
  momentum: new Set<SignalType>(['macd_crossover', 'trend_reversal', 'breakout', 'momentum_shift']),
  scalping: new Set<SignalType>(['rsi_divergence', 'macd_crossover', 'momentum_shift']),
  conservative: new Set<SignalType>(['rsi_divergence', 'trend_reversal', 'bollinger_squeeze']),
  dca: null,
  grid: new Set<SignalType>(['breakout', 'support_resistance', 'trend_reversal']),
};

function hold(code: StrategyHoldCode, reason: string): StrategyDecision {
  return { action: 'hold', strategyVersion: STRATEGY_ENGINE_VERSION, code, reason };
}

function normalizeStrategy(strategy: string): CanonicalStrategy | null {
  const value = strategy.trim().toLowerCase();
  if (
    value === 'signal_based' || value === 'balanced' || value === 'momentum' ||
    value === 'scalping' || value === 'conservative' || value === 'dca' || value === 'grid'
  ) {
    return value;
  }
  return null;
}

function isFinitePositive(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isCandidateStructurallyTradeable(candidate: StrategyCandidateInput): boolean {
  if (candidate.direction !== 'bullish' && candidate.direction !== 'bearish') return false;
  if (!Number.isFinite(candidate.confidence) || candidate.confidence < 0 || candidate.confidence > 100) return false;
  if (!candidate.reasoning.trim()) return false;
  if (!isFinitePositive(candidate.entryPrice) || !isFinitePositive(candidate.stopLoss) || !isFinitePositive(candidate.takeProfit)) {
    return false;
  }

  if (candidate.direction === 'bullish') {
    return candidate.stopLoss < candidate.entryPrice && candidate.takeProfit > candidate.entryPrice;
  }
  return candidate.stopLoss > candidate.entryPrice && candidate.takeProfit < candidate.entryPrice;
}

export function selectStrategyCandidate(
  rawCandidates: readonly StrategyCandidateInput[],
  context: { symbol: string; strategy: string; timeframe: Timeframe },
): StrategyDecision {
  const strategy = normalizeStrategy(context.strategy);
  if (!strategy) {
    return hold('UNSUPPORTED_STRATEGY', `Unsupported strategy: ${context.strategy}`);
  }
  if (context.timeframe !== '4h') {
    return hold(
      'UNSUPPORTED_VERIFIED_TIMEFRAME',
      `Verified strategy decisions currently require 4h candles; received ${context.timeframe}.`,
    );
  }

  const allowedTypes = ALLOWED_SIGNAL_TYPES[strategy];
  const minConfidence = MIN_CONFIDENCE[strategy];
  const filtered = rawCandidates.filter((candidate) => {
    if (!isCandidateStructurallyTradeable(candidate)) return false;
    if (candidate.confidence < minConfidence) return false;
    if (allowedTypes && !allowedTypes.has(candidate.signalType)) return false;
    if (strategy === 'dca' && candidate.direction !== 'bullish') return false;
    return true;
  });

  if (filtered.length === 0) {
    return hold(
      'NO_VALID_CANDIDATE',
      `No ${strategy} candidate passed the canonical confidence, direction, and price-structure policy.`,
    );
  }

  // Stable deterministic ranking: confidence desc, signal type asc, reasoning asc.
  const best = [...filtered].sort((a, b) =>
    (b.confidence - a.confidence) ||
    a.signalType.localeCompare(b.signalType) ||
    a.reasoning.localeCompare(b.reasoning)
  )[0];

  const side = best.direction === 'bullish' ? 'buy' : 'sell';
  return {
    action: 'trade',
    strategyVersion: STRATEGY_ENGINE_VERSION,
    trade: {
      symbol: context.symbol.trim().toUpperCase(),
      side,
      confidence: best.confidence,
      entryPrice: best.entryPrice!,
      stopLoss: best.stopLoss!,
      takeProfit: best.takeProfit!,
      reason: best.reasoning,
      signalType: best.signalType,
      strategy,
      timeframe: '4h',
      strategyVersion: STRATEGY_ENGINE_VERSION,
    },
  };
}

export function evaluateStrategyDecision(
  candles: CandleData[],
  context: { symbol: string; strategy: string; timeframe: Timeframe },
): StrategyDecision {
  if (context.timeframe !== '4h') {
    return hold(
      'UNSUPPORTED_VERIFIED_TIMEFRAME',
      `Verified strategy decisions currently require 4h candles; received ${context.timeframe}.`,
    );
  }
  if (candles.length < 30) {
    return hold('INSUFFICIENT_HISTORY', `At least 30 verified candles are required; received ${candles.length}.`);
  }

  // Ask the indicator layer for its broadest deterministic candidate set.
  // Final confidence/strategy policy is applied here, not in callers.
  const candidates = generateSignals(context.symbol, candles, context.timeframe, 'aggressive');
  return selectStrategyCandidate(candidates, context);
}
