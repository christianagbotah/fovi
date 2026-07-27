import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel, ensureDemoUser } from '@/lib/db';
import { createBrokerFromAccount } from '@/lib/broker/factory';
import { generateSignals } from '@/lib/ai/signals';
import { getDemoCandles, getAssetType } from '@/lib/broker/demo';
import { v4 as uuidv4 } from 'uuid';

const DEMO_SIGNALS = [
  {
    id: 'sig_demo_1',
    symbol: 'BTC',
    assetType: 'crypto',
    direction: 'long',
    confidence: 0.78,
    signalType: 'momentum',
    timeframe: '1h',
    entryPrice: 68200,
    stopLoss: 66800,
    takeProfit: 71500,
    reasoning: 'Strong bullish momentum with MACD crossover and RSI bouncing off 40 support. Volume increasing on green candles.',
    status: 'active',
    expiresAt: new Date(Date.now() + 10800000).toISOString(),
    createdAt: new Date().toISOString(),
  },
  {
    id: 'sig_demo_2',
    symbol: 'ETH',
    assetType: 'crypto',
    direction: 'long',
    confidence: 0.72,
    signalType: 'breakout',
    timeframe: '1h',
    entryPrice: 3920,
    stopLoss: 3820,
    takeProfit: 4200,
    reasoning: 'Breakout above descending trendline with above-average volume. RSI at 55 with room to run.',
    status: 'active',
    expiresAt: new Date(Date.now() + 10800000).toISOString(),
    createdAt: new Date().toISOString(),
  },
];

export async function POST(req: NextRequest) {
  // Try DB path
  if (db && hasModel('tradingAccount') && hasModel('tradingSignal')) {
    try {
      const body = await req.json();
      const userId = await ensureDemoUser();
      if (!userId) {
        return NextResponse.json(DEMO_SIGNALS);
      }
      const symbol = body.symbol || 'AAPL';
      const timeframe = body.timeframe || '1h';
      const riskTolerance = body.riskTolerance || 'medium';

      const account = await db.tradingAccount.findFirst({
        where: { userId, isDefault: true },
      });
      if (!account) {
        return NextResponse.json(DEMO_SIGNALS);
      }

      const broker = createBrokerFromAccount(account);
      const candles = await broker.getCandles(symbol, timeframe, 100);
      if (candles.length < 30) {
        return NextResponse.json(DEMO_SIGNALS);
      }

      const candidates = generateSignals(candles, timeframe as any, riskTolerance);
      const now = new Date();
      const expiresAt = new Date(now.getTime() + getTimeframeMs(timeframe) * 3);
      const savedSignals = [];
      for (const c of candidates) {
        const signal = await db.tradingSignal.create({
          data: {
            id: uuidv4(),
            accountId: account.id,
            symbol,
            assetType: getAssetType(symbol),
            direction: c.direction,
            confidence: c.confidence,
            signalType: c.signalType,
            timeframe,
            entryPrice: c.entryPrice,
            stopLoss: c.stopLoss,
            takeProfit: c.takeProfit,
            reasoning: c.reasoning,
            expiresAt,
          },
        });
        savedSignals.push(signal);
      }
      return NextResponse.json(savedSignals);
    } catch (error) {
      // ANY database error falls through to demo fallback below
      console.warn('[signals/generate POST] DB error, falling through to demo:', error);
    }
  }

  // Fallback: generate from demo candles
  try {
    const body = await req.json().catch(() => ({}));
    const symbol = body.symbol || 'BTC';
    const timeframe = body.timeframe || '1h';
    const riskTolerance = body.riskTolerance || 'medium';
    const candles = getDemoCandles(symbol, timeframe as any, 100);
    if (candles.length >= 30) {
      const candidates = generateSignals(candles, timeframe as any, riskTolerance);
      return NextResponse.json(candidates.map(c => ({
        id: `sig_demo_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        symbol,
        assetType: getAssetType(symbol),
        direction: c.direction,
        confidence: c.confidence,
        signalType: c.signalType,
        timeframe,
        entryPrice: c.entryPrice,
        stopLoss: c.stopLoss,
        takeProfit: c.takeProfit,
        reasoning: c.reasoning,
        status: 'active',
        expiresAt: new Date(Date.now() + getTimeframeMs(timeframe) * 3).toISOString(),
        createdAt: new Date().toISOString(),
      })));
    }
  } catch {
    // fall through to static demo
  }

  return NextResponse.json(DEMO_SIGNALS);
}

function getTimeframeMs(tf: string): number {
  const map: Record<string, number> = {
    '1m': 60000, '5m': 300000, '15m': 900000,
    '1h': 3600000, '4h': 14400000, '1d': 86400000, '1w': 604800000,
  };
  return map[tf] || 3600000;
}