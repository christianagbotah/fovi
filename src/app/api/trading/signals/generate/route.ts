import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel, ensureDemoUser } from '@/lib/db';
import { createBrokerFromAccount } from '@/lib/broker/factory';
import { generateSignals } from '@/lib/ai/signals';
import { getDemoCandles, getAssetType, getDemoPrice } from '@/lib/broker/demo';
import { v4 as uuidv4 } from 'uuid';

// Symbols to scan when no specific symbol is requested
const SCAN_SYMBOLS = ['BTC', 'ETH', 'SOL', 'AAPL', 'NVDA', 'TSLA', 'EURUSD', 'XAUUSD', 'XRP', 'META'];

function getTimeframeMs(tf: string): number {
  const map: Record<string, number> = {
    '1m': 60000, '5m': 300000, '15m': 900000,
    '1h': 3600000, '4h': 14400000, '1d': 86400000, '1w': 604800000,
  };
  return map[tf] || 3600000;
}

interface SignalOutput {
  id: string;
  symbol: string;
  assetType: string;
  direction: string;
  confidence: number; // 0-100
  signalType: string;
  timeframe: string;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  reasoning: string;
  status: string;
  createdAt: string;
  expiresAt: string;
}

/**
 * Generate real trading signals using technical analysis (RSI, MACD, Bollinger, etc.)
 * on actual candle data. Returns signals with 0-100 confidence range.
 */
async function generateRealSignals(
  symbols: string[],
  timeframe: string,
  riskTolerance: string,
): Promise<SignalOutput[]> {
  const allSignals: SignalOutput[] = [];
  const now = new Date();
  const expiresAt = new Date(now.getTime() + getTimeframeMs(timeframe) * 3);

  for (const symbol of symbols) {
    try {
      // Get candles (real for crypto via CoinGecko, simulated for stocks)
      const candles = getDemoCandles(symbol, timeframe, 100);
      if (candles.length < 30) continue;

      // Run real technical analysis
      const candidates = generateSignals(symbol, candles, timeframe as any, riskTolerance as any);

      for (const c of candidates) {
        const price = getDemoPrice(symbol);
        allSignals.push({
          id: `sig_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          symbol,
          assetType: getAssetType(symbol),
          direction: c.direction === 'long' ? 'bullish' : c.direction === 'short' ? 'bearish' : c.direction,
          confidence: Math.round(c.confidence),
          signalType: c.signalType,
          timeframe,
          entryPrice: c.entryPrice || price,
          stopLoss: c.stopLoss || 0,
          takeProfit: c.takeProfit || 0,
          reasoning: c.reasoning,
          status: 'active',
          createdAt: now.toISOString(),
          expiresAt: expiresAt.toISOString(),
        });
      }
    } catch (err) {
      console.warn(`[signals/generate] Error analyzing ${symbol}:`, err);
    }
  }

  // Sort by confidence descending
  return allSignals.sort((a, b) => b.confidence - a.confidence);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const symbol = body.symbol || '';
    const timeframe = body.timeframe || '1h';
    const riskTolerance = body.riskTolerance || 'medium';
    const symbols = symbol ? [symbol.toUpperCase()] : SCAN_SYMBOLS;

    // Generate real TA-based signals
    const signals = await generateRealSignals(symbols, timeframe, riskTolerance);

    // If no signals found from TA, try DB path for persistence
    if (signals.length === 0 && db && hasModel('tradingAccount') && hasModel('tradingSignal')) {
      try {
        const userId = await ensureDemoUser();
        if (userId) {
          const account = await db.tradingAccount.findFirst({ where: { userId, isDefault: true } });
          if (account) {
            const broker = createBrokerFromAccount(account);
            for (const sym of symbols) {
              const candles = await broker.getCandles(sym, timeframe, 100);
              if (candles.length < 30) continue;
              const candidates = generateSignals(sym, candles, timeframe as any, riskTolerance as any);
              const now = new Date();
              for (const c of candidates) {
                const signal = await db.tradingSignal.create({
                  data: {
                    id: uuidv4(), accountId: account.id, symbol: sym,
                    assetType: getAssetType(sym), direction: c.direction,
                    confidence: c.confidence, signalType: c.signalType,
                    timeframe, entryPrice: c.entryPrice, stopLoss: c.stopLoss,
                    takeProfit: c.takeProfit, reasoning: c.reasoning,
                    status: 'active',
                    expiresAt: new Date(now.getTime() + getTimeframeMs(timeframe) * 3),
                  },
                });
                signals.push({
                  id: signal.id, symbol: sym, assetType: getAssetType(sym),
                  direction: signal.direction === 'long' ? 'bullish' : signal.direction === 'short' ? 'bearish' : signal.direction,
                  confidence: Math.round(signal.confidence),
                  signalType: signal.signalType, timeframe,
                  entryPrice: signal.entryPrice || 0, stopLoss: signal.stopLoss || 0,
                  takeProfit: signal.takeProfit || 0, reasoning: signal.reasoning || '',
                  status: 'active', createdAt: now.toISOString(),
                  expiresAt: new Date(now.getTime() + getTimeframeMs(timeframe) * 3).toISOString(),
                });
              }
            }
          }
        }
      } catch (err) {
        console.warn('[signals/generate] DB path error:', err);
      }
    }

    return NextResponse.json(signals);
  } catch (error) {
    console.error('[signals/generate] Error:', error);
    return NextResponse.json({ error: 'Failed to generate signals' }, { status: 500 });
  }
}
