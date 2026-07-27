import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';
import { runBacktest, type EngineConfig } from '@/lib/trading-engine';
import { getDemoCandles } from '@/lib/broker/demo';
import type { CandleData } from '@/lib/types';

// Generate inline random-walk candles as fallback if getDemoCandles fails
function generateInlineCandles(
  symbol: string,
  timeframe: string,
  startDate: string,
  endDate: string,
): CandleData[] {
  const intervalMs: Record<string, number> = {
    '1m': 60000, '5m': 300000, '15m': 900000,
    '1h': 3600000, '4h': 14400000, '1d': 86400000, '1w': 604800000,
  };
  const interval = intervalMs[timeframe] || 86400000;
  const basePrice: Record<string, number> = {
    BTC: 67500, ETH: 3520, SOL: 172.5, AAPL: 195.5, NVDA: 920.5,
    TSLA: 245.6, MSFT: 445.8, GOOGL: 178.2,
  };
  const base = basePrice[symbol] || 100;
  const startTs = new Date(startDate).getTime();
  const endTs = new Date(endDate).getTime();
  const candles: CandleData[] = [];
  let price = base * (0.92 + Math.random() * 0.16);
  for (let ts = startTs; ts <= endTs; ts += interval) {
    const volatility = base * 0.008;
    const drift = (Math.random() - 0.48) * volatility;
    const open = price;
    const close = price + drift;
    const high = Math.max(open, close) + Math.random() * volatility * 0.5;
    const low = Math.min(open, close) - Math.random() * volatility * 0.5;
    const volume = Math.floor(Math.random() * 5000000) + 500000;
    candles.push({ timestamp: ts, open, high, low, close, volume });
    price = close;
  }
  return candles;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const {
    symbol = 'BTC',
    timeframe = '1d',
    strategy = 'signal_based',
    allocationAmount = 10000,
    startDate,
    endDate,
    stopLossPercent = 2.0,
    takeProfitPercent = 4.0,
    positionSizing = 'fixed_fractional',
    riskPerTrade = 2.0,
    trailingStopPct = 0,
    gridLevels = 5,
    gridSpacing = 1.0,
    dcaTotalBuys = 10,
  } = body;

  // 1) Build candles — this does NOT require db. Use getDemoCandles or inline fallback.
  let candles: CandleData[] = [];
  const now = Date.now();
  const start = startDate
    ? new Date(startDate).getTime()
    : now - 86400000 * 90; // default 90 days back
  const end = endDate ? new Date(endDate).getTime() : now;
  const intervalMs: Record<string, number> = {
    '1m': 60000, '5m': 300000, '15m': 900000,
    '1h': 3600000, '4h': 14400000, '1d': 86400000, '1w': 604800000,
  };
  const interval = intervalMs[timeframe] || 86400000;
  const neededCandles = Math.min(
    2000,
    Math.max(100, Math.ceil((end - start) / interval)),
  );

  try {
    candles = getDemoCandles(symbol, timeframe, neededCandles);
    if (candles.length < 60) {
      candles = generateInlineCandles(
        symbol,
        timeframe,
        new Date(start).toISOString(),
        new Date(end).toISOString(),
      );
    }
  } catch {
    candles = generateInlineCandles(
      symbol,
      timeframe,
      new Date(start).toISOString(),
      new Date(end).toISOString(),
    );
  }

  // 2) Build engine config
  const config: EngineConfig = {
    strategy: strategy as EngineConfig['strategy'],
    symbols: [symbol],
    timeframe,
    allocationAmount: Number(allocationAmount),
    accountBalance: Number(allocationAmount),
    positionSizing: positionSizing as EngineConfig['positionSizing'],
    riskPerTrade: Number(riskPerTrade),
    maxPositions: 5,
    stopLossPercent: Number(stopLossPercent),
    takeProfitPercent: Number(takeProfitPercent),
    trailingStopPct: Number(trailingStopPct),
    gridLevels: Number(gridLevels),
    gridSpacing: Number(gridSpacing),
    dcaTotalBuys: Number(dcaTotalBuys),
    winRate: 55,
    avgWinLossRatio: 1.5,
  };

  // 3) Run backtest (pure compute, never throws db errors)
  let result;
  try {
    result = runBacktest(candles, config);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Backtest engine error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  // 4) Persist to DB if available (non-blocking — failure here does NOT affect the response)
  if (db && hasModel('backtest')) {
    try {
      await db.backtest.create({
        data: {
          userId: 'usr_demo_1',
          name: `${strategy} ${symbol} ${timeframe}`,
          strategy,
          symbol,
          timeframe,
          startDate: new Date(start),
          endDate: new Date(end),
          initialBalance: Number(allocationAmount),
          finalBalance: Number(allocationAmount) + result.stats.totalPnl,
          totalPnl: result.stats.totalPnl,
          pnlPercent: result.stats.pnlPercent,
          totalTrades: result.stats.totalTrades,
          winTrades: result.stats.winTrades,
          lossTrades: result.stats.lossTrades,
          maxDrawdown: result.stats.maxDrawdown,
          sharpeRatio: result.stats.sharpeRatio,
          sortinoRatio: result.stats.sortinoRatio,
          profitFactor: result.stats.profitFactor,
          avgWin: result.stats.avgWin,
          avgLoss: result.stats.avgLoss,
          config: JSON.stringify(config),
          tradesJson: JSON.stringify(result.trades),
          equityCurveJson: JSON.stringify(result.equityCurve),
        },
      });
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes('validating datasource')) {
        // Ignore — return the result anyway
      } else {
        // Log but do not fail the response — backtest result is more important than DB persistence
        console.warn('[backtest] failed to persist result:', error);
      }
    }
  }

  return NextResponse.json({
    symbol,
    timeframe,
    strategy,
    config,
    ...result,
  });
}
