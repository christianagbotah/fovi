// ============================================================
// AI Signal Generator - Combines TA + Pattern Recognition
// ============================================================

import type { CandleData, TradingSignal, SignalDirection, SignalType, Timeframe } from '../types';
import { fullAnalysis, computeATR } from './technical-analysis';
import { getDemoPrice } from '../broker/demo';

interface SignalCandidate {
  signalType: SignalType;
  direction: SignalDirection;
  confidence: number;
  reasoning: string;
 entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
}

export function generateSignals(
  symbol: string,
  candles: CandleData[],
  timeframe: Timeframe = '1h',
  riskTolerance: 'conservative' | 'medium' | 'aggressive' = 'medium'
): SignalCandidate[] {
  if (candles.length < 30) return [];

  const analysis = fullAnalysis(candles);
  const candidates: SignalCandidate[] = [];
  const price = analysis.currentPrice;
  const atr = analysis.atr;
  if (!atr || !price) return [];

  // Confidence thresholds based on risk tolerance
  const minConfidence = { conservative: 75, medium: 60, aggressive: 45 }[riskTolerance];

  // === RSI Signals ===
  if (analysis.rsi !== null) {
    const rsi = analysis.rsi;
    if (rsi < 30) {
      // Oversold - bullish
      candidates.push({
        signalType: 'rsi_divergence',
        direction: 'bullish',
        confidence: Math.min(85, 60 + (30 - rsi) * 1.5),
        reasoning: `RSI at ${rsi.toFixed(1)} indicates oversold conditions. Potential bullish reversal.`,
        entryPrice: price,
        stopLoss: price - atr * 2,
        takeProfit: price + atr * 3,
      });
    } else if (rsi > 70) {
      // Overbought - bearish
      candidates.push({
        signalType: 'rsi_divergence',
        direction: 'bearish',
        confidence: Math.min(85, 60 + (rsi - 70) * 1.5),
        reasoning: `RSI at ${rsi.toFixed(1)} indicates overbought conditions. Potential bearish reversal.`,
        entryPrice: price,
        stopLoss: price + atr * 2,
        takeProfit: price - atr * 3,
      });
    }
  }

  // === MACD Crossover ===
  if (analysis.macd) {
    const { macd, signal, histogram } = analysis.macd;
    if (histogram > 0 && macd > signal) {
      candidates.push({
        signalType: 'macd_crossover',
        direction: 'bullish',
        confidence: Math.min(80, 55 + Math.abs(histogram) / (price * 0.01) * 10),
        reasoning: `MACD bullish crossover detected. MACD: ${macd.toFixed(4)}, Signal: ${signal.toFixed(4)}. Momentum turning positive.`,
        entryPrice: price,
        stopLoss: price - atr * 1.5,
        takeProfit: price + atr * 3,
      });
    } else if (histogram < 0 && macd < signal) {
      candidates.push({
        signalType: 'macd_crossover',
        direction: 'bearish',
        confidence: Math.min(80, 55 + Math.abs(histogram) / (price * 0.01) * 10),
        reasoning: `MACD bearish crossover detected. MACD: ${macd.toFixed(4)}, Signal: ${signal.toFixed(4)}. Momentum turning negative.`,
        entryPrice: price,
        stopLoss: price + atr * 1.5,
        takeProfit: price - atr * 3,
      });
    }
  }

  // === Bollinger Band Squeeze / Breakout ===
  if (analysis.bb) {
    const { upper, lower, middle, width } = analysis.bb;
    if (width < 3) {
      // Squeeze - high volatility expansion expected
      const direction: SignalDirection = price > middle ? 'bullish' : 'bearish';
      candidates.push({
        signalType: 'bollinger_squeeze',
        direction,
        confidence: 60 + (4 - width) * 10,
        reasoning: `Bollinger Band squeeze detected (width: ${width.toFixed(1)}%). Low volatility period - major move expected. Price is ${direction === 'bullish' ? 'above' : 'below'} middle band.`,
        entryPrice: price,
        stopLoss: direction === 'bullish' ? lower : upper,
        takeProfit: direction === 'bullish' ? price + (upper - lower) : price - (upper - lower),
      });
    } else if (price <= lower) {
      // Price touching lower band - potential bounce
      candidates.push({
        signalType: 'breakout',
        direction: 'bullish',
        confidence: 65,
        reasoning: `Price touching lower Bollinger Band. Potential bounce from ${lower.toFixed(2)} support level.`,
        entryPrice: price,
        stopLoss: lower - atr,
        takeProfit: middle + atr,
      });
    } else if (price >= upper) {
      // Price touching upper band - potential pullback
      candidates.push({
        signalType: 'breakout',
        direction: 'bearish',
        confidence: 65,
        reasoning: `Price touching upper Bollinger Band. Potential pullback from ${upper.toFixed(2)} resistance level.`,
        entryPrice: price,
        stopLoss: upper + atr,
        takeProfit: middle - atr,
      });
    }
  }

  // === Support/Resistance Breakout ===
  if (analysis.supportResistance) {
    const { support, resistance } = analysis.supportResistance;
    if (resistance.length > 0) {
      const nearestResistance = resistance[0];
      if (price > nearestResistance * 0.998) {
        candidates.push({
          signalType: 'breakout',
          direction: 'bullish',
          confidence: 70,
          reasoning: `Price approaching resistance at ${nearestResistance.toFixed(2)}. Breakout could trigger momentum move upward.`,
          entryPrice: price,
          stopLoss: nearestResistance - atr,
          takeProfit: price + atr * 4,
        });
      }
    }
    if (support.length > 0) {
      const nearestSupport = support[0];
      if (price < nearestSupport * 1.002) {
        candidates.push({
          signalType: 'breakout',
          direction: 'bearish',
          confidence: 70,
          reasoning: `Price approaching support at ${nearestSupport.toFixed(2)}. Breakdown could trigger selling pressure.`,
          entryPrice: price,
          stopLoss: nearestSupport + atr,
          takeProfit: price - atr * 4,
        });
      }
    }
  }

  // === Trend Reversal (SMA/EMA crossovers) ===
  if (analysis.ema12 && analysis.ema26) {
    if (analysis.ema12 > analysis.ema26 && analysis.sma50) {
      if (price > analysis.sma50) {
        candidates.push({
          signalType: 'trend_reversal',
          direction: 'bullish',
          confidence: 72,
          reasoning: `EMA(12) above EMA(26) and price above SMA(50). Uptrend confirmed.`,
          entryPrice: price,
          stopLoss: analysis.sma50 - atr * 0.5,
          takeProfit: price + atr * 3,
        });
      }
    } else if (analysis.ema12 < analysis.ema26 && analysis.sma50) {
      if (price < analysis.sma50) {
        candidates.push({
          signalType: 'trend_reversal',
          direction: 'bearish',
          confidence: 72,
          reasoning: `EMA(12) below EMA(26) and price below SMA(50). Downtrend confirmed.`,
          entryPrice: price,
          stopLoss: analysis.sma50 + atr * 0.5,
          takeProfit: price - atr * 3,
        });
      }
    }
  }

  // === Candlestick Pattern ===
  if (analysis.candlePattern) {
    const { pattern, direction, confidence } = analysis.candlePattern;
    if (direction !== 'neutral') {
      candidates.push({
        signalType: 'momentum_shift',
        direction,
        confidence,
        reasoning: `${pattern} pattern detected. ${direction === 'bullish' ? 'Bullish' : 'Bearish'} reversal signal.`,
        entryPrice: price,
        stopLoss: direction === 'bullish' ? price - atr * 1.5 : price + atr * 1.5,
        takeProfit: direction === 'bullish' ? price + atr * 2.5 : price - atr * 2.5,
      });
    }
  }

  // === ADX Trend Strength Filter ===
  const trendStrength = analysis.adx || 20;
  const isTrending = trendStrength > 25;

  // Filter by risk tolerance
  const filtered = candidates
    .filter(c => c.confidence >= minConfidence)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);

  // Boost confidence if multiple signals agree on direction
  if (filtered.length >= 2) {
    const bullCount = filtered.filter(c => c.direction === 'bullish').length;
    const bearCount = filtered.filter(c => c.direction === 'bearish').length;
    const consensusDir: SignalDirection = bullCount > bearCount ? 'bullish' : 'bearish';
    const consensusCount = Math.max(bullCount, bearCount);
    
    if (consensusCount >= 2) {
      filtered.forEach(c => {
        if (c.direction === consensusDir) {
          c.confidence = Math.min(95, c.confidence + consensusCount * 3);
          c.reasoning += ` Reinforced by ${consensusCount} concurring signals.`;
        }
      });
    }
  }

  return filtered;
}

// Generate analysis summary text (for AI chat)
export function generateAnalysisSummary(symbol: string, candles: CandleData[]): string {
  const analysis = fullAnalysis(candles);
  const parts: string[] = [`**${symbol} Technical Analysis**\n`];

  if (analysis.rsi !== null) {
    const rsiState = analysis.rsi > 70 ? 'Overbought' : analysis.rsi < 30 ? 'Oversold' : 'Neutral';
    parts.push(`- RSI(14): ${analysis.rsi.toFixed(1)} (${rsiState})`);
  }
  if (analysis.macd) {
    const mState = analysis.macd.histogram > 0 ? 'Bullish' : 'Bearish';
    parts.push(`- MACD: ${mState} (Hist: ${analysis.macd.histogram.toFixed(4)})`);
  }
  if (analysis.bb) {
    const pos = analysis.currentPrice < analysis.bb.lower ? 'Below Lower Band' : 
               analysis.currentPrice > analysis.bb.upper ? 'Above Upper Band' : 'Within Bands';
    parts.push(`- Bollinger: ${pos} (Width: ${analysis.bb.width.toFixed(1)}%)`);
  }
  if (analysis.adx !== null) {
    const trend = analysis.adx > 25 ? 'Strong Trend' : analysis.adx > 20 ? 'Moderate' : 'Weak/Range-bound';
    parts.push(`- ADX: ${analysis.adx.toFixed(1)} (${trend})`);
  }
  if (analysis.stoch) {
    parts.push(`- Stochastic: %K=${analysis.stoch.k.toFixed(1)} %D=${analysis.stoch.d.toFixed(1)}`);
  }
  if (analysis.ema12 && analysis.ema26) {
    const trend = analysis.ema12 > analysis.ema26 ? 'Bullish' : 'Bearish';
    parts.push(`- EMA Cross: ${trend}`);
  }
  if (analysis.candlePattern) {
    parts.push(`- Pattern: ${analysis.candlePattern.pattern} (${analysis.candlePattern.direction})`);
  }

  return parts.join('\n');
}
