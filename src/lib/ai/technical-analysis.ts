// ============================================================
// Technical Analysis Engine - RSI, MACD, Bollinger, etc.
// ============================================================

import { SMA, EMA, RSI, MACD, BollingerBands, Stochastic, ATR, ADX, VWAP } from 'technicalindicators';
import type { CandleData } from '../types';

export function computeRSI(candles: CandleData[], period: number = 14): number | null {
  if (candles.length < period + 1) return null;
  const closes = candles.map(c => c.close);
  const rsi = RSI.calculate({ values: closes, period });
  return rsi.length > 0 ? rsi[rsi.length - 1] : null;
}

export function computeMACD(candles: CandleData[]): { macd: number; signal: number; histogram: number } | null {
  if (candles.length < 26) return null;
  const closes = candles.map(c => c.close);
  const macd = MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });
  if (macd.length === 0) return null;
  const last = macd[macd.length - 1];
  return { macd: last.MACD, signal: last.signal, histogram: last.histogram };
}

export function computeBollingerBands(candles: CandleData[], period: number = 20, stdDev: number = 2): {
  upper: number; middle: number; lower: number; width: number;
} | null {
  if (candles.length < period) return null;
  const closes = candles.map(c => c.close);
  const bb = BollingerBands.calculate({ values: closes, period, stdDev });
  if (bb.length === 0) return null;
  const last = bb[bb.length - 1];
  return {
    upper: last.upper,
    middle: last.middle,
    lower: last.lower,
    width: ((last.upper - last.lower) / last.middle) * 100,
  };
}

export function computeStochastic(candles: CandleData[], period: number = 14): {
  k: number; d: number;
} | null {
  if (candles.length < period) return null;
  const stoch = Stochastic.calculate({
    high: candles.map(c => c.high),
    low: candles.map(c => c.low),
    close: candles.map(c => c.close),
    period,
    signalPeriod: 3,
  });
  if (stoch.length === 0) return null;
  const last = stoch[stoch.length - 1];
  return { k: last.k, d: last.d };
}

export function computeATR(candles: CandleData[], period: number = 14): number | null {
  if (candles.length < period + 1) return null;
  const atr = ATR.calculate({
    high: candles.map(c => c.high),
    low: candles.map(c => c.low),
    close: candles.map(c => c.close),
    period,
  });
  return atr.length > 0 ? atr[atr.length - 1] : null;
}

export function computeADX(candles: CandleData[], period: number = 14): number | null {
  if (candles.length < period * 2) return null;
  const adx = ADX.calculate({
    high: candles.map(c => c.high),
    low: candles.map(c => c.low),
    close: candles.map(c => c.close),
    period,
  });
  return adx.length > 0 ? adx[adx.length - 1].adx : null;
}

export function computeSMA(candles: CandleData[], period: number): number | null {
  if (candles.length < period) return null;
  const closes = candles.map(c => c.close);
  const sma = SMA.calculate({ values: closes, period });
  return sma.length > 0 ? sma[sma.length - 1] : null;
}

export function computeEMA(candles: CandleData[], period: number): number | null {
  if (candles.length < period) return null;
  const closes = candles.map(c => c.close);
  const ema = EMA.calculate({ values: closes, period });
  return ema.length > 0 ? ema[ema.length - 1] : null;
}

export function detectSupportResistance(candles: CandleData[], lookback: number = 50): {
  support: number[];
  resistance: number[];
} {
  const recent = candles.slice(-lookback);
  if (recent.length < 10) return { support: [], resistance: [] };

  const lows = recent.map(c => c.low).sort((a, b) => a - b);
  const highs = recent.map(c => c.high).sort((a, b) => b - a);

  // Find clusters of similar lows (support) and highs (resistance)
  const supportLevels: number[] = [];
  const resistanceLevels: number[] = [];

  // Bottom 15% of lows as support zone
  const lowThreshold = lows[Math.floor(lows.length * 0.1)];
  for (const low of lows) {
    if (low <= lowThreshold * 1.005) {
      if (!supportLevels.some(s => Math.abs(s - low) / low < 0.005)) {
        supportLevels.push(low);
      }
    }
  }

  // Top 15% of highs as resistance zone
  const highThreshold = highs[Math.floor(highs.length * 0.1)];
  for (const high of highs) {
    if (high >= highThreshold * 0.995) {
      if (!resistanceLevels.some(r => Math.abs(r - high) / high < 0.005)) {
        resistanceLevels.push(high);
      }
    }
  }

  return {
    support: supportLevels.slice(0, 3),
    resistance: resistanceLevels.slice(0, 3),
  };
}

export function detectCandlePatterns(candles: CandleData[]): {
  pattern: string;
  direction: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
} | null {
  if (candles.length < 5) return null;
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const prev2 = candles[candles.length - 3];
  const body = Math.abs(last.close - last.open);
  const totalRange = last.high - last.low;
  const bodyRatio = totalRange > 0 ? body / totalRange : 0;

  // Doji
  if (bodyRatio < 0.1 && totalRange > 0) {
    return { pattern: 'Doji', direction: 'neutral', confidence: 50 };
  }

  // Hammer (bullish reversal)
  const lowerWick = Math.min(last.open, last.close) - last.low;
  const upperWick = last.high - Math.max(last.open, last.close);
  if (lowerWick > body * 2 && upperWick < body * 0.5) {
    const trendDown = prev.close < prev2.close && prev2.close < (candles[candles.length - 4]?.close || prev2.close);
    if (trendDown) {
      return { pattern: 'Hammer', direction: 'bullish', confidence: 65 };
    }
  }

  // Shooting Star (bearish reversal)
  if (upperWick > body * 2 && lowerWick < body * 0.5) {
    const trendUp = prev.close > prev2.close && prev2.close > (candles[candles.length - 4]?.close || prev2.close);
    if (trendUp) {
      return { pattern: 'Shooting Star', direction: 'bearish', confidence: 65 };
    }
  }

  // Engulfing patterns
  if (last.close > last.open && prev.close < prev.open) {
    // Bullish engulfing
    if (last.open <= prev.close && last.close >= prev.open) {
      return { pattern: 'Bullish Engulfing', direction: 'bullish', confidence: 70 };
    }
  }
  if (last.close < last.open && prev.close > prev.open) {
    // Bearish engulfing
    if (last.open >= prev.close && last.close <= prev.open) {
      return { pattern: 'Bearish Engulfing', direction: 'bearish', confidence: 70 };
    }
  }

  return null;
}

// Full analysis pass - returns all indicators at once
export function fullAnalysis(candles: CandleData[]) {
  const rsi = computeRSI(candles);
  const macd = computeMACD(candles);
  const bb = computeBollingerBands(candles);
  const stoch = computeStochastic(candles);
  const atr = computeATR(candles);
  const adx = computeADX(candles);
  const sma20 = computeSMA(candles, 20);
  const sma50 = computeSMA(candles, 50);
  const ema12 = computeEMA(candles, 12);
  const ema26 = computeEMA(candles, 26);
  const sr = detectSupportResistance(candles);
  const pattern = detectCandlePatterns(candles);
  const currentPrice = candles[candles.length - 1]?.close || 0;

  return {
    rsi, macd, bb, stoch, atr, adx,
    sma20, sma50, ema12, ema26,
    supportResistance: sr,
    candlePattern: pattern,
    currentPrice,
  };
}