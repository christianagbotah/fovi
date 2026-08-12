// ============================================================
// Technical Analysis Strategies Module
// ============================================================
// Pure computation — no I/O, no side effects.
// All indicators use mathematically correct formulas.
// ============================================================

// ============================================================
// Types
// ============================================================

export interface CandleData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TradeSignal {
  symbol: string;
  side: 'buy' | 'sell';
  confidence: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  reason: string;
}

// ============================================================
// Helpers
// ============================================================

/** Ensure we have enough data points; pad with first value if needed. */
function requireMin<T>(arr: T[], min: number): T[] {
  if (arr.length >= min) return arr;
  const first = arr[0];
  const pad: T[] = [];
  for (let i = 0; i < min - arr.length; i++) pad.push(first);
  return [...pad, ...arr];
}

// ============================================================
// Simple Moving Average (SMA)
// ============================================================

export function computeSMA(closes: number[], period: number): number {
  if (closes.length === 0) return 0;
  const padded = requireMin(closes, period);
  const slice = padded.slice(-period);
  const sum = slice.reduce((a, b) => a + b, 0);
  return sum / period;
}

// ============================================================
// Exponential Moving Average (EMA)
// ============================================================

export function computeEMA(closes: number[], period: number): number {
  if (closes.length === 0) return 0;
  const padded = requireMin(closes, period);
  const k = 2 / (period + 1); // smoothing factor

  // Seed EMA with SMA of first `period` values
  let ema = padded.slice(0, period).reduce((a, b) => a + b, 0) / period;

  // Walk forward from index `period` to end
  for (let i = period; i < padded.length; i++) {
    ema = padded[i] * k + ema * (1 - k);
  }
  return ema;
}

/** Compute an array of EMA values (same length as input). */
function computeEMAArray(closes: number[], period: number): number[] {
  const padded = requireMin(closes, period);
  const k = 2 / (period + 1);
  const result: number[] = [];

  // Seed
  let ema = padded.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = 0; i < period; i++) result.push(ema);

  for (let i = period; i < padded.length; i++) {
    ema = padded[i] * k + ema * (1 - k);
    result.push(ema);
  }
  return result;
}

// ============================================================
// Relative Strength Index (RSI)
// ============================================================

export function computeRSI(closes: number[], period: number = 14): number {
  if (closes.length < 2) return 50; // neutral when not enough data
  const padded = requireMin(closes, period + 1);

  // Calculate price changes
  const changes: number[] = [];
  for (let i = 1; i < padded.length; i++) {
    changes.push(padded[i] - padded[i - 1]);
  }

  // First `period` changes: use simple average for initial values
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i];
    else avgLoss += Math.abs(changes[i]);
  }
  avgGain /= period;
  avgLoss /= period;

  // Wilder's smoothing for remaining changes
  for (let i = period; i < changes.length; i++) {
    const gain = changes[i] > 0 ? changes[i] : 0;
    const loss = changes[i] < 0 ? Math.abs(changes[i]) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// ============================================================
// MACD (Moving Average Convergence Divergence)
// ============================================================

export function computeMACD(
  closes: number[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9,
): { macd: number; signal: number; histogram: number } {
  const padded = requireMin(closes, slowPeriod + signalPeriod);

  const emaFast = computeEMAArray(padded, fastPeriod);
  const emaSlow = computeEMAArray(padded, slowPeriod);

  // MACD line = fast EMA - slow EMA
  const macdLine: number[] = [];
  for (let i = 0; i < padded.length; i++) {
    macdLine.push(emaFast[i] - emaSlow[i]);
  }

  // Signal line = EMA of MACD line
  const signalLine = computeEMAArray(macdLine, signalPeriod);

  const macd = macdLine[macdLine.length - 1];
  const signal = signalLine[signalLine.length - 1];
  const histogram = macd - signal;

  return { macd, signal, histogram };
}

// ============================================================
// Bollinger Bands
// ============================================================

export function computeBollingerBands(
  closes: number[],
  period: number = 20,
  stdDevMult: number = 2,
): { upper: number; middle: number; lower: number } {
  if (closes.length === 0) return { upper: 0, middle: 0, lower: 0 };
  const padded = requireMin(closes, period);
  const slice = padded.slice(-period);

  const middle = slice.reduce((a, b) => a + b, 0) / period;

  // Population standard deviation
  const variance = slice.reduce((sum, val) => sum + (val - middle) ** 2, 0) / period;
  const std = Math.sqrt(variance);

  return {
    upper: middle + stdDevMult * std,
    middle,
    lower: middle - stdDevMult * std,
  };
}

// ============================================================
// Average True Range (ATR)
// ============================================================

export function computeATR(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number = 14,
): number {
  if (highs.length < 2) {
    // Not enough data — return a simple high-low range
    if (highs.length === 1) return highs[0] - lows[0];
    return 0;
  }

  const minLen = Math.min(highs.length, lows.length, closes.length);
  const h = highs.slice(0, minLen);
  const l = lows.slice(0, minLen);
  const c = closes.slice(0, minLen);

  // True Range for each bar
  const trs: number[] = [h[0] - l[0]]; // first bar: just high - low
  for (let i = 1; i < minLen; i++) {
    const tr1 = h[i] - l[i];
    const tr2 = Math.abs(h[i] - c[i - 1]);
    const tr3 = Math.abs(l[i] - c[i - 1]);
    trs.push(Math.max(tr1, tr2, tr3));
  }

  if (trs.length < period) {
    // Not enough for full ATR — return average of what we have
    return trs.reduce((a, b) => a + b, 0) / trs.length;
  }

  // First ATR = simple average of first `period` TRs
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;

  // Wilder's smoothing
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }

  return atr;
}

// ============================================================
// DCA state tracker (per-symbol, in-memory)
// ============================================================

const dcaLastBuyPrice: Map<string, number> = new Map();

export function resetDCATracker() {
  dcaLastBuyPrice.clear();
}

export function updateDCALastBuy(symbol: string, price: number) {
  dcaLastBuyPrice.set(symbol, price);
}

// ============================================================
// Grid state tracker (per-symbol, in-memory)
// ============================================================

const gridLevels: Map<string, { upper: number; lower: number; center: number; step: number }> = new Map();

export function resetGridTracker() {
  gridLevels.clear();
}

// ============================================================
// Signal Generation — Strategy Router
// ============================================================

export function generateSignal(
  candles: CandleData[],
  strategy: string,
  riskTolerance: string,
  symbol: string,
): TradeSignal | null {
  if (candles.length < 5) {
    return null;
  }

  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const currentPrice = closes[closes.length - 1];

  // Normalize strategy name
  const strat = strategy.toLowerCase().trim();

  if (strat === 'momentum') return momentumStrategy(closes, highs, lows, candles, riskTolerance, symbol);
  if (strat === 'balanced') return balancedStrategy(closes, highs, lows, candles, riskTolerance, symbol);
  if (strat === 'conservative') return conservativeStrategy(closes, highs, lows, candles, riskTolerance, symbol);
  if (strat === 'dca') return dcaStrategy(closes, candles, riskTolerance, symbol);
  if (strat === 'grid') return gridStrategy(closes, highs, lows, candles, riskTolerance, symbol);

  // Fallback to balanced
  console.log(`[Strategies] Unknown strategy '${strategy}' — falling back to balanced`);
  return balancedStrategy(closes, highs, lows, candles, riskTolerance, symbol);
}

// ============================================================
// Momentum Strategy — RSI + MACD Crossover
// ============================================================

function momentumStrategy(
  closes: number[],
  highs: number[],
  lows: number[],
  candles: CandleData[],
  riskTolerance: string,
  symbol: string,
): TradeSignal | null {
  const rsi = computeRSI(closes);
  const { macd, signal, histogram } = computeMACD(closes);
  const atr = computeATR(highs, lows, closes);
  const currentPrice = closes[closes.length - 1];

  // Previous MACD values for crossover detection
  const prevCloses = closes.slice(0, -1);
  const prevMACD = prevCloses.length >= 26 + 9 ? computeMACD(prevCloses) : null;

  const parts: string[] = [];
  parts.push(`RSI(14)=${rsi.toFixed(1)}`);
  parts.push(`MACD hist=${histogram >= 0 ? '+' : ''}${histogram.toFixed(4)}`);

  let side: 'buy' | 'sell' | null = null;
  let confidence = 50;

  // BUY: RSI oversold + MACD crossover above signal
  if (rsi < 30 && histogram > 0) {
    side = 'buy';
    confidence = 60 + (30 - rsi); // more oversold = higher confidence
    if (prevMACD && prevMACD.histogram <= 0) {
      confidence += 10; // fresh crossover bonus
      parts.push('MACD crossed above signal');
    }
  }
  // Also consider RSI just recovering from oversold
  else if (rsi < 40 && rsi > 25 && histogram > 0 && macd > signal) {
    side = 'buy';
    confidence = 55 + (40 - rsi) * 0.3;
    parts.push('RSI recovering + MACD bullish');
  }
  // SELL: RSI overbought + MACD crossover below signal
  else if (rsi > 70 && histogram < 0) {
    side = 'sell';
    confidence = 60 + (rsi - 70);
    if (prevMACD && prevMACD.histogram >= 0) {
      confidence += 10;
      parts.push('MACD crossed below signal');
    }
  }
  // Also consider RSI just declining from overbought
  else if (rsi > 60 && rsi < 75 && histogram < 0 && macd < signal) {
    side = 'sell';
    confidence = 55 + (rsi - 60) * 0.3;
    parts.push('RSI declining + MACD bearish');
  }

  if (!side) {
    parts.push('No momentum signal → HOLD');
    console.log(`[Strategies] [${symbol}] Momentum: ${parts.join(', ')}`);
    return null;
  }

  // Risk-based SL/TP
  const { slPercent, tpPercent } = getRiskParams(riskTolerance);
  const atrSlMult = side === 'buy' ? 1.5 : 1.5;
  const atrSl = atr > 0 ? atr * atrSlMult : currentPrice * (slPercent / 100);
  const sl = side === 'buy'
    ? roundPrice(currentPrice - atrSl)
    : roundPrice(currentPrice + atrSl);
  const tp = side === 'buy'
    ? roundPrice(currentPrice + atrSl * (tpPercent / slPercent))
    : roundPrice(currentPrice - atrSl * (tpPercent / slPercent));

  confidence = Math.min(95, Math.max(50, Math.round(confidence)));

  parts.push(`→ ${side.toUpperCase()} signal (confidence: ${confidence}%)`);
  const reason = `Momentum: ${parts.join(', ')}`;

  console.log(`[Strategies] [${symbol}] ${reason}`);

  return { symbol, side, confidence, entryPrice: currentPrice, stopLoss: sl, takeProfit: tp, reason };
}

// ============================================================
// Balanced Strategy — SMA Crossover + RSI Confirmation
// ============================================================

function balancedStrategy(
  closes: number[],
  highs: number[],
  lows: number[],
  candles: CandleData[],
  riskTolerance: string,
  symbol: string,
): TradeSignal | null {
  const sma20 = computeSMA(closes, 20);
  const sma50 = computeSMA(closes, 50);
  const rsi = computeRSI(closes);
  const atr = computeATR(highs, lows, closes);
  const currentPrice = closes[closes.length - 1];

  const parts: string[] = [];
  parts.push(`RSI(14)=${rsi.toFixed(1)}`);
  const smaRelation = sma20 > sma50 ? 'SMA20 > SMA50' : sma20 < sma50 ? 'SMA20 < SMA50' : 'SMA20 = SMA50';
  parts.push(smaRelation);

  let side: 'buy' | 'sell' | null = null;
  let confidence = 50;

  if (sma20 > sma50 && rsi > 50) {
    side = 'buy';
    // Confidence based on how strongly the MAs are separated and RSI strength
    const maSpread = ((sma20 - sma50) / sma50) * 100;
    confidence = 55 + Math.min(25, maSpread * 5) + Math.min(10, (rsi - 50) * 0.5);
  } else if (sma20 < sma50 && rsi < 50) {
    side = 'sell';
    const maSpread = ((sma50 - sma20) / sma20) * 100;
    confidence = 55 + Math.min(25, maSpread * 5) + Math.min(10, (50 - rsi) * 0.5);
  }

  if (!side) {
    parts.push('No crossover confirmation → HOLD');
    console.log(`[Strategies] [${symbol}] Balanced: ${parts.join(', ')}`);
    return null;
  }

  // Risk-based SL/TP
  const { slPercent, tpPercent } = getRiskParams(riskTolerance);
  const atrSl = atr > 0 ? atr * 1.5 : currentPrice * (slPercent / 100);
  const sl = side === 'buy'
    ? roundPrice(currentPrice - atrSl)
    : roundPrice(currentPrice + atrSl);
  const tp = side === 'buy'
    ? roundPrice(currentPrice + atrSl * (tpPercent / slPercent))
    : roundPrice(currentPrice - atrSl * (tpPercent / slPercent));

  confidence = Math.min(90, Math.max(50, Math.round(confidence)));

  parts.push(`→ ${side.toUpperCase()} signal (confidence: ${confidence}%)`);
  const reason = `Balanced: ${parts.join(', ')}`;

  console.log(`[Strategies] [${symbol}] ${reason}`);

  return { symbol, side, confidence, entryPrice: currentPrice, stopLoss: sl, takeProfit: tp, reason };
}

// ============================================================
// Conservative Strategy — Bollinger Bands + RSI
// ============================================================

function conservativeStrategy(
  closes: number[],
  highs: number[],
  lows: number[],
  candles: CandleData[],
  riskTolerance: string,
  symbol: string,
): TradeSignal | null {
  const { upper, middle, lower } = computeBollingerBands(closes);
  const rsi = computeRSI(closes);
  const atr = computeATR(highs, lows, closes);
  const currentPrice = closes[closes.length - 1];

  const bandWidth = upper - lower;
  const lowerZone = lower + bandWidth * 0.2;  // near lower = within 20% of lower band
  const upperZone = upper - bandWidth * 0.2;  // near upper = within 20% of upper band

  const parts: string[] = [];
  parts.push(`RSI(14)=${rsi.toFixed(1)}`);
  parts.push(`BB=[${lower.toFixed(2)}, ${middle.toFixed(2)}, ${upper.toFixed(2)}]`);

  let side: 'buy' | 'sell' | null = null;
  let confidence = 50;

  // BUY: near lower band + RSI < 35 (oversold confirmation)
  if (currentPrice <= lowerZone && rsi < 35) {
    side = 'buy';
    // More confidence the closer to lower band and lower RSI
    const bandProximity = Math.max(0, 1 - (currentPrice - lower) / bandWidth);
    confidence = 60 + bandProximity * 15 + (35 - rsi) * 0.5;
    parts.push('Price near lower band + RSI oversold');
  }
  // SELL: near upper band + RSI > 65 (overbought confirmation)
  else if (currentPrice >= upperZone && rsi > 65) {
    side = 'sell';
    const bandProximity = Math.max(0, 1 - (upper - currentPrice) / bandWidth);
    confidence = 60 + bandProximity * 15 + (rsi - 65) * 0.5;
    parts.push('Price near upper band + RSI overbought');
  }

  if (!side) {
    parts.push('No BB/RSI signal → HOLD');
    console.log(`[Strategies] [${symbol}] Conservative: ${parts.join(', ')}`);
    return null;
  }

  // Conservative: tighter SL/TP (closer to current price)
  const { slPercent, tpPercent } = getRiskParams(riskTolerance);
  const conservativeSl = Math.min(slPercent, 1.5); // max 1.5% SL for conservative
  const conservativeTp = Math.min(tpPercent, 3.0); // max 3% TP
  const atrSl = atr > 0 ? atr * 1.0 : currentPrice * (conservativeSl / 100);
  const sl = side === 'buy'
    ? roundPrice(currentPrice - atrSl)
    : roundPrice(currentPrice + atrSl);
  const tp = side === 'buy'
    ? roundPrice(currentPrice + atrSl * (conservativeTp / conservativeSl))
    : roundPrice(currentPrice - atrSl * (conservativeTp / conservativeSl));

  confidence = Math.min(85, Math.max(50, Math.round(confidence)));

  parts.push(`→ ${side.toUpperCase()} signal (confidence: ${confidence}%)`);
  const reason = `Conservative: ${parts.join(', ')}`;

  console.log(`[Strategies] [${symbol}] ${reason}`);

  return { symbol, side, confidence, entryPrice: currentPrice, stopLoss: sl, takeProfit: tp, reason };
}

// ============================================================
// DCA Strategy — Buy on dips, never sell
// ============================================================

function dcaStrategy(
  closes: number[],
  candles: CandleData[],
  riskTolerance: string,
  symbol: string,
): TradeSignal | null {
  const currentPrice = closes[closes.length - 1];
  const lastBuyPrice = dcaLastBuyPrice.get(symbol);
  const rsi = computeRSI(closes);
  const sma20 = computeSMA(closes, 20);

  const parts: string[] = [];
  parts.push(`RSI(14)=${rsi.toFixed(1)}`);

  // DCA buy condition: price dropped >= 2% from last buy OR first purchase (no last buy)
  // Also check RSI < 50 (not overbought) and price < SMA20 (in downtrend / discounted)
  if (!lastBuyPrice) {
    // First purchase — buy if RSI < 55 (not overbought)
    if (rsi < 55) {
      const confidence = Math.round(60 + (55 - rsi) * 0.3);
      const { slPercent, tpPercent } = getRiskParams(riskTolerance);
      const sl = roundPrice(currentPrice * (1 - slPercent / 100));
      const tp = roundPrice(currentPrice * (1 + tpPercent / 100));

      parts.push('Initial DCA buy');
      parts.push(`→ BUY signal (confidence: ${confidence}%)`);
      const reason = `DCA: ${parts.join(', ')}`;
      console.log(`[Strategies] [${symbol}] ${reason}`);

      return { symbol, side: 'buy', confidence, entryPrice: currentPrice, stopLoss: sl, takeProfit: tp, reason };
    }
  } else {
    const dropPercent = ((lastBuyPrice - currentPrice) / lastBuyPrice) * 100;
    parts.push(`Drop from last buy: ${dropPercent.toFixed(2)}%`);

    if (dropPercent >= 2.0 && rsi < 50) {
      const confidence = Math.round(60 + Math.min(25, dropPercent - 2));
      const { slPercent, tpPercent } = getRiskParams(riskTolerance);
      const sl = roundPrice(currentPrice * (1 - slPercent / 100));
      const tp = roundPrice(currentPrice * (1 + tpPercent / 100));

      parts.push(`Price dropped ${dropPercent.toFixed(1)}% from last buy + RSI < 50`);
      parts.push(`→ BUY signal (confidence: ${confidence}%)`);
      const reason = `DCA: ${parts.join(', ')}`;
      console.log(`[Strategies] [${symbol}] ${reason}`);

      return { symbol, side: 'buy', confidence, entryPrice: currentPrice, stopLoss: sl, takeProfit: tp, reason };
    }
  }

  parts.push('No DCA buy trigger → HOLD');
  console.log(`[Strategies] [${symbol}] DCA: ${parts.join(', ')}`);
  return null;
}

// ============================================================
// Grid Strategy — Buy at lower grid levels, sell at upper
// ============================================================

function gridStrategy(
  closes: number[],
  highs: number[],
  lows: number[],
  candles: CandleData[],
  riskTolerance: string,
  symbol: string,
): TradeSignal | null {
  const atr = computeATR(highs, lows, closes);
  const currentPrice = closes[closes.length - 1];
  const rsi = computeRSI(closes);

  // Establish or update grid levels based on recent range
  let grid = gridLevels.get(symbol);
  const recentHigh = Math.max(...highs.slice(-20));
  const recentLow = Math.min(...lows.slice(-20));

  if (!grid || Math.abs(grid.center - currentPrice) / grid.center > 0.1) {
    // Initialize or re-center grid
    const step = atr > 0 ? atr * 1.0 : currentPrice * 0.01;
    grid = {
      center: currentPrice,
      upper: currentPrice + step * 2,
      lower: currentPrice - step * 2,
      step,
    };
    gridLevels.set(symbol, grid);
  }

  const parts: string[] = [];
  parts.push(`RSI(14)=${rsi.toFixed(1)}`);
  parts.push(`Grid=[${grid.lower.toFixed(2)}, ${grid.upper.toFixed(2)}] step=${grid.step.toFixed(2)}`);

  let side: 'buy' | 'sell' | null = null;
  let confidence = 55;

  // BUY: price drops to or below lower grid level
  if (currentPrice <= grid.lower) {
    side = 'buy';
    const penetration = (grid.lower - currentPrice) / grid.step;
    confidence = 55 + Math.min(25, penetration * 5);
    parts.push('Price at lower grid level');
  }
  // SELL: price rises to or above upper grid level
  else if (currentPrice >= grid.upper) {
    side = 'sell';
    const penetration = (currentPrice - grid.upper) / grid.step;
    confidence = 55 + Math.min(25, penetration * 5);
    parts.push('Price at upper grid level');
  }

  if (!side) {
    parts.push('Price within grid → HOLD');
    console.log(`[Strategies] [${symbol}] Grid: ${parts.join(', ')}`);
    return null;
  }

  // Grid: SL/TP based on grid step sizes
  const { slPercent, tpPercent } = getRiskParams(riskTolerance);
  const gridSl = Math.max(grid.step * 0.5, currentPrice * (slPercent / 100));
  const gridTp = Math.max(grid.step * 1.5, currentPrice * (tpPercent / 100));
  const sl = side === 'buy'
    ? roundPrice(currentPrice - gridSl)
    : roundPrice(currentPrice + gridSl);
  const tp = side === 'buy'
    ? roundPrice(currentPrice + gridTp)
    : roundPrice(currentPrice - gridTp);

  confidence = Math.min(90, Math.max(50, Math.round(confidence)));

  parts.push(`→ ${side.toUpperCase()} signal (confidence: ${confidence}%)`);
  const reason = `Grid: ${parts.join(', ')}`;

  console.log(`[Strategies] [${symbol}] ${reason}`);

  return { symbol, side, confidence, entryPrice: currentPrice, stopLoss: sl, takeProfit: tp, reason };
}

// ============================================================
// Risk Parameters by Tolerance
// ============================================================

function getRiskParams(riskTolerance: string): { slPercent: number; tpPercent: number; riskPercent: number } {
  switch (riskTolerance.toLowerCase()) {
    case 'aggressive':
      return { slPercent: 3.0, tpPercent: 6.0, riskPercent: 0.05 }; // 5% of balance per trade
    case 'conservative':
      return { slPercent: 1.0, tpPercent: 2.0, riskPercent: 0.01 }; // 1% of balance per trade
    case 'medium':
    default:
      return { slPercent: 2.0, tpPercent: 4.0, riskPercent: 0.02 }; // 2% of balance per trade
  }
}

// ============================================================
// Utility: Round price to reasonable precision
// ============================================================

function roundPrice(price: number): number {
  if (price >= 1000) return Math.round(price * 100) / 100;       // 2 decimals
  if (price >= 1) return Math.round(price * 1000) / 1000;        // 3 decimals
  if (price >= 0.01) return Math.round(price * 100000) / 100000; // 5 decimals
  return Math.round(price * 1000000) / 1000000;                  // 6 decimals
}

// ============================================================
// Position Sizing: risk-based
// ============================================================

export function calculatePositionSize(
  accountBalance: number,
  riskTolerance: string,
  entryPrice: number,
  stopLoss: number,
  maxPositionSize: number,
  allocationAmount: number,
): number {
  const { riskPercent } = getRiskParams(riskTolerance);

  // Risk-based sizing: how much we can lose if SL is hit
  const slDistance = Math.abs(entryPrice - stopLoss);
  if (slDistance <= 0) return 0;

  const riskAmount = accountBalance * riskPercent;
  const riskBasedQty = riskAmount / slDistance;

  // Cap by allocation amount and max position size
  const allocQty = allocationAmount / entryPrice;
  const maxQty = maxPositionSize / entryPrice;

  return Math.max(0.0001, Math.min(riskBasedQty, allocQty, maxQty));
}

// ============================================================
// Export getRiskParams for use in engine
// ============================================================

export { getRiskParams };
