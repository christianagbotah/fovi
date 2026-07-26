// ============================================================
// Fovi Trading Engine
// Orchestrates TA signals + position sizing + execution
// ============================================================

import type { CandleData as Candle } from './types';
import { fullAnalysis, generateSignals, type Signal } from './ai/technical-analysis';
import { calculatePositionSize, type SizingRequest } from './position-sizing';

export interface EngineConfig {
  strategy: 'signal_based' | 'dca' | 'grid' | 'scalping' | 'momentum';
  symbols: string[];
  timeframe: string;
  allocationAmount: number;
  accountBalance: number;
  positionSizing: 'kelly' | 'fixed_fractional' | 'volatility' | 'fixed';
  riskPerTrade: number;
  maxPositions: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  trailingStopPct: number;
  // Strategy-specific
  dcaInterval?: number; // minutes between DCA buys
  dcaTotalBuys?: number;
  gridLevels?: number;
  gridSpacing?: number; // % between grid levels
  // Stats for sizing
  winRate?: number;
  avgWinLossRatio?: number;
}

export interface EngineSignal {
  symbol: string;
  signal: Signal;
  sizing: {
    positionSize: number;
    quantity: number;
    riskAmount: number;
    riskPercent: number;
  };
  strategy: string;
  confidence: number;
}

export interface BacktestResult {
  trades: BacktestTrade[];
  equityCurve: number[];
  stats: {
    totalPnl: number;
    pnlPercent: number;
    totalTrades: number;
    winTrades: number;
    lossTrades: number;
    winRate: number;
    avgWin: number;
    avgLoss: number;
    maxDrawdown: number;
    sharpeRatio: number;
    sortinoRatio: number;
    profitFactor: number;
    bestTrade: number;
    worstTrade: number;
  };
}

export interface BacktestTrade {
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  exitPrice: number;
  qty: number;
  pnl: number;
  pnlPercent: number;
  entryDate: number;
  exitDate: number;
  signalType: string;
  holdBars: number;
}

// ============================================================
// Signal Generation (real-time)
// ============================================================

export function scanSymbol(candles: Candle[], config: EngineConfig): EngineSignal | null {
  if (candles.length < 30) return null;

  const currentPrice = candles[candles.length - 1].close;
  const signals = generateSignals(candles);

  // Filter by strategy
  let relevantSignals = signals;
  if (config.strategy === 'scalping') {
    relevantSignals = signals.filter(s => 
      s.type === 'rsi_oversold' || s.type === 'rsi_overbought' || 
      s.type === 'stochastic_crossover' || s.type === 'volume_spike'
    );
  } else if (config.strategy === 'momentum') {
    relevantSignals = signals.filter(s =>
      s.type === 'macd_crossover' || s.type === 'ema_crossover' || s.type === 'breakout'
    );
  }

  if (relevantSignals.length === 0) return null;

  // Pick strongest signal
  const best = relevantSignals.reduce((a, b) => a.confidence > b.confidence ? a : b);

  // Calculate position size
  const slPrice = best.stopLoss || currentPrice * (1 - config.stopLossPercent / 100);
  const tpPrice = best.takeProfit || currentPrice * (1 + config.takeProfitPercent / 100);

  const sizing = calculatePositionSize({
    method: config.positionSizing,
    accountBalance: config.accountBalance,
    allocationAmount: config.allocationAmount,
    entryPrice: currentPrice,
    stopLossPrice: slPrice,
    riskPerTrade: config.riskPerTrade,
    winRate: config.winRate,
    avgWinLossRatio: config.avgWinLossRatio,
  });

  return {
    symbol: (candles[0] as { symbol?: string }).symbol || '',
    signal: { ...best, stopLoss: slPrice, takeProfit: tpPrice },
    sizing,
    strategy: config.strategy,
    confidence: best.confidence,
  };
}

// ============================================================
// DCA Strategy Generator
// ============================================================

export function generateDCAOrders(
  symbol: string,
  currentPrice: number,
  totalAmount: number,
  totalBuys: number,
  allocation: number,
): { price: number; amount: number; qty: number }[] {
  const orders: { price: number; amount: number; qty: number }[] = [];
  const amountPerBuy = allocation / totalBuys;
  // Spread buys from -2% to +2% of current price
  for (let i = 0; i < totalBuys; i++) {
    const priceOffset = ((i / (totalBuys - 1 || 1)) - 0.5) * 0.04; // -2% to +2%
    const price = currentPrice * (1 + priceOffset);
    orders.push({
      price,
      amount: amountPerBuy,
      qty: amountPerBuy / price,
    });
  }
  return orders;
}

// ============================================================
// Grid Strategy Generator
// ============================================================

export function generateGridOrders(
  symbol: string,
  currentPrice: number,
  allocation: number,
  gridLevels: number,
  gridSpacing: number,
): { buys: { price: number; qty: number }[]; sells: { price: number; qty: number }[] } {
  const buys: { price: number; qty: number }[] = [];
  const sells: { price: number; qty: number }[] = [];
  const amountPerLevel = allocation / (gridLevels * 2);

  for (let i = 1; i <= gridLevels; i++) {
    const lowerPrice = currentPrice * (1 - (gridSpacing / 100) * i);
    const upperPrice = currentPrice * (1 + (gridSpacing / 100) * i);
    buys.push({ price: lowerPrice, qty: amountPerLevel / lowerPrice });
    sells.push({ price: upperPrice, qty: amountPerLevel / upperPrice });
  }

  return { buys, sells };
}

// ============================================================
// Trailing Stop Calculator
// ============================================================

export function calculateTrailingStop(
  entryPrice: number,
  currentPrice: number,
  side: 'long' | 'short',
  trailingPct: number,
  currentStop: number | null,
  highestSinceEntry?: number,
): { newStop: number; shouldExit: boolean; unrealizedPnl: number } {
  const highest = highestSinceEntry || currentPrice;
  let newStop: number;
  let shouldExit = false;

  if (side === 'long') {
    const trail = highest * (1 - trailingPct / 100);
    newStop = currentStop ? Math.max(currentStop, trail) : trail;
    shouldExit = currentPrice <= newStop;
  } else {
    const trail = highest * (1 + trailingPct / 100);
    newStop = currentStop ? Math.min(currentStop, trail) : trail;
    shouldExit = currentPrice >= newStop;
  }

  const unrealizedPnl = side === 'long'
    ? (currentPrice - entryPrice) / entryPrice * 100
    : (entryPrice - currentPrice) / entryPrice * 100;

  return { newStop, shouldExit, unrealizedPnl };
}

// ============================================================
// Backtesting Engine
// ============================================================

export function runBacktest(
  candles: Candle[],
  config: EngineConfig,
): BacktestResult {
  const trades: BacktestTrade[] = [];
  const equityCurve: number[] = [config.allocationAmount];
  let balance = config.allocationAmount;
  let position: { entryPrice: number; qty: number; side: 'long' | 'short'; entryBar: number; signalType: string } | null = null;

  for (let i = 50; i < candles.length; i++) { // Skip first 50 bars for indicator warmup
    const slice = candles.slice(0, i + 1);
    const currentPrice = candles[i].close;

    if (position) {
      const pnl = position.side === 'long'
        ? (currentPrice - position.entryPrice) * position.qty
        : (position.entryPrice - currentPrice) * position.qty;
      const pnlPct = position.side === 'long'
        ? ((currentPrice - position.entryPrice) / position.entryPrice) * 100
        : ((position.entryPrice - currentPrice) / position.entryPrice) * 100;

      // Check exits
      const sl = position.side === 'long'
        ? position.entryPrice * (1 - config.stopLossPercent / 100)
        : position.entryPrice * (1 + config.stopLossPercent / 100);
      const tp = position.side === 'long'
        ? position.entryPrice * (1 + config.takeProfitPercent / 100)
        : position.entryPrice * (1 - config.takeProfitPercent / 100);

      const hitSL = position.side === 'long' ? currentPrice <= sl : currentPrice >= sl;
      const hitTP = position.side === 'long' ? currentPrice >= tp : currentPrice <= tp;

      if (hitSL || hitTP || (config.trailingStopPct > 0 && checkTrailingExit(position, currentPrice, config.trailingStopPct))) {
        balance += pnl;
        trades.push({
          symbol: '', side: position.side,
          entryPrice: position.entryPrice, exitPrice: currentPrice,
          qty: position.qty, pnl, pnlPercent: pnlPct,
          entryDate: candles[position.entryBar].timestamp,
          exitDate: candles[i].timestamp,
          signalType: position.signalType,
          holdBars: i - position.entryBar,
        });
        position = null;
      }
    }

    if (!position) {
      const signals = generateSignals(slice);
      const entry = signals.find(s => {
        if (config.strategy === 'scalping') return s.confidence >= 70;
        return s.confidence >= 60;
      });

      if (entry && entry.stopLoss && entry.takeProfit) {
        const slPrice = entry.stopLoss;
        const sizing = calculatePositionSize({
          method: config.positionSizing,
          accountBalance: balance,
          allocationAmount: config.allocationAmount,
          entryPrice: currentPrice,
          stopLossPrice: slPrice,
          riskPerTrade: config.riskPerTrade,
          winRate: 55,
          avgWinLossRatio: 1.5,
        });
        if (sizing.quantity > 0 && sizing.positionSize <= balance) {
          position = {
            entryPrice: currentPrice,
            qty: sizing.quantity,
            side: entry.direction === 'bullish' ? 'long' : 'short',
            entryBar: i,
            signalType: entry.type,
          };
        }
      }
    }

    // Track equity (balance + unrealized PnL)
    let equity = balance;
    if (position) {
      equity += position.side === 'long'
        ? (currentPrice - position.entryPrice) * position.qty
        : (position.entryPrice - currentPrice) * position.qty;
    }
    equityCurve.push(equity);
  }

  return { trades, equityCurve, stats: calculateStats(trades, equityCurve, config.allocationAmount) };
}

function checkTrailingExit(
  pos: { entryPrice: number; side: 'long' | 'short' },
  currentPrice: number,
  trailingPct: number,
): boolean {
  if (pos.side === 'long') {
    return currentPrice <= pos.entryPrice * (1 + trailingPct / 100) * (1 - trailingPct / 100);
  }
  return false;
}

function calculateStats(trades: BacktestTrade[], equityCurve: number[], initial: number): BacktestResult['stats'] {
  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);
  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.pnl, 0) / losses.length) : 0;

  // Max drawdown
  let maxDd = 0, peak = equityCurve[0] || 0;
  for (const eq of equityCurve) {
    if (eq > peak) peak = eq;
    const dd = peak > 0 ? ((peak - eq) / peak) * 100 : 0;
    if (dd > maxDd) maxDd = dd;
  }

  // Sharpe ratio (simplified)
  const returns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    returns.push((equityCurve[i] - equityCurve[i - 1]) / (equityCurve[i - 1] || 1));
  }
  const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const stdReturn = returns.length > 1 ? Math.sqrt(returns.reduce((s, r) => s + Math.pow(r - avgReturn, 2), 0) / returns.length) : 0;
  const sharpe = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(252) : 0;

  // Sortino (only downside deviation)
  const negReturns = returns.filter(r => r < 0);
  const downsideDev = negReturns.length > 1 ? Math.sqrt(negReturns.reduce((s, r) => s + r * r, 0) / negReturns.length) : 0;
  const sortino = downsideDev > 0 ? (avgReturn / downsideDev) * Math.sqrt(252) : 0;

  // Profit factor
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = losses.reduce((s, t) => s + Math.abs(t.pnl), 0);
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0;

  return {
    totalPnl, pnlPercent: initial > 0 ? (totalPnl / initial) * 100 : 0,
    totalTrades: trades.length, winTrades: wins.length, lossTrades: losses.length,
    winRate: trades.length > 0 ? (wins.length / trades.length) * 100 : 0,
    avgWin, avgLoss, maxDrawdown: maxDd,
    sharpeRatio: sharpe, sortinoRatio: sortino, profitFactor,
    bestTrade: trades.length > 0 ? Math.max(...trades.map(t => t.pnl)) : 0,
    worstTrade: trades.length > 0 ? Math.min(...trades.map(t => t.pnl)) : 0,
  };
}

// ============================================================
// Performance Analytics
// ============================================================

export interface PnlBreakdown {
  daily: PnlPeriod[];
  weekly: PnlPeriod[];
  monthly: PnlPeriod[];
}

export interface PnlPeriod {
  label: string;
  pnl: number;
  pnlPercent: number;
  trades: number;
  wins: number;
  balance: number;
}

export function calculatePnlBreakdown(
  trades: { pnl: number; pnlPercent: number; entryDate: number; exitDate: number }[],
  startBalance: number,
): PnlBreakdown {
  const now = Date.now();
  const dayMs = 86400000;
  const weekMs = dayMs * 7;
  const monthMs = dayMs * 30;

  const daily: PnlPeriod[] = [];
  const weekly: PnlPeriod[] = [];
  const monthly: PnlPeriod[] = [];

  // Group by day
  const dayMap = new Map<string, { pnl: number; count: number; wins: number }>();
  const weekMap = new Map<string, { pnl: number; count: number; wins: number }>();
  const monthMap = new Map<string, { pnl: number; count: number; wins: number }>();

  for (const t of trades) {
    const d = new Date(t.exitDate || t.entryDate);
    const dayKey = d.toISOString().slice(0, 10);
    const weekKey = getWeekKey(d);
    const monthKey = d.toISOString().slice(0, 7);

    for (const [map, key] of [[dayMap, dayKey], [weekMap, weekKey], [monthMap, monthKey]] as const) {
      const entry = map.get(key) || { pnl: 0, count: 0, wins: 0 };
      entry.pnl += t.pnl;
      entry.count++;
      if (t.pnl > 0) entry.wins++;
      map.set(key, entry);
    }
  }

  let bal = startBalance;
  for (const [k, v] of dayMap) {
    bal += v.pnl;
    daily.push({ label: k, pnl: v.pnl, pnlPercent: startBalance > 0 ? (v.pnl / startBalance) * 100 : 0, trades: v.count, wins: v.wins, balance: bal });
  }
  bal = startBalance;
  for (const [k, v] of weekMap) {
    bal += v.pnl;
    weekly.push({ label: k, pnl: v.pnl, pnlPercent: startBalance > 0 ? (v.pnl / startBalance) * 100 : 0, trades: v.count, wins: v.wins, balance: bal });
  }
  bal = startBalance;
  for (const [k, v] of monthMap) {
    bal += v.pnl;
    monthly.push({ label: k, pnl: v.pnl, pnlPercent: startBalance > 0 ? (v.pnl / startBalance) * 100 : 0, trades: v.count, wins: v.wins, balance: bal });
  }

  return { daily, weekly, monthly };
}

// ============================================================
// Helper: ISO week key (e.g. "2024-W12")
// ============================================================

function getWeekKey(date: Date): string {
  const tmp = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (tmp.getUTCDay() + 6) % 7;
  tmp.setUTCDate(tmp.getUTCDate() - dayNum + 3);
  const firstThursday = tmp.getTime();
  tmp.setUTCMonth(0, 1);
  if (tmp.getUTCDay() !== 4) {
    tmp.setUTCMonth(0, 1 + ((4 - tmp.getUTCDay()) + 7) % 7);
  }
  const weekNum = 1 + Math.ceil((firstThursday - tmp.getTime()) / (7 * 86400000));
  return `${date.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}