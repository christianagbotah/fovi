import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel, ensureDemoUser } from '@/lib/db';
import { createBrokerFromAccount } from '@/lib/broker/factory';
import { generateSignals } from '@/lib/ai/signals';
import { getDemoCandles, getAssetType, getDemoPrice } from '@/lib/broker/demo';
import { v4 as uuidv4 } from 'uuid';
import type { CandleData } from '@/lib/types';

// Symbols to scan when no specific symbol is requested
const SCAN_SYMBOLS = ['BTC', 'ETH', 'SOL', 'AAPL', 'NVDA', 'TSLA', 'EURUSD', 'XAUUSD', 'XRP', 'META'];

// CoinGecko IDs for crypto symbols
const COINGECKO_IDS: Record<string, string> = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', BNB: 'binancecoin',
  XRP: 'ripple', DOGE: 'dogecoin', ADA: 'cardano', AVAX: 'avalanche-2',
  DOT: 'polkadot', LINK: 'chainlink',
};

const COINGECKO_DAYS_MAP: Record<string, number> = {
  '1m': 1, '5m': 1, '15m': 1, '1h': 1, '4h': 1, '1d': 30, '1w': 90,
};

// In-memory cache
const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL = 30_000;

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data as T;
  return null;
}
function setCache(key: string, data: unknown) {
  cache.set(key, { data, ts: Date.now() });
}

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
  confidence: number;
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

// ============================================================
// Fetch REAL candle data from CoinGecko for crypto symbols
// ============================================================
async function fetchCoinGeckoCandles(symbol: string, timeframe: string, limit: number): Promise<CandleData[] | null> {
  const coinId = COINGECKO_IDS[symbol];
  if (!coinId) return null;

  const cacheKey = `cg_candles_${symbol}_${timeframe}`;
  const cached = getCached<CandleData[]>(cacheKey);
  if (cached) return cached;

  try {
    const days = COINGECKO_DAYS_MAP[timeframe] ?? 30;
    const url = `https://api.coingecko.com/api/v3/coins/${coinId}/ohlc?vs_currency=usd&days=${days}`;
    const res = await fetch(url, {
      next: { revalidate: 30 },
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`CoinGecko OHLC HTTP ${res.status}`);

    const raw = (await res.json()) as number[][];
    const candles = raw.slice(-limit).map((c) => ({
      timestamp: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: 0,
    }));

    if (candles.length === 0) return null;
    setCache(cacheKey, candles);
    return candles;
  } catch (err) {
    console.warn(`[signals/generate] CoinGecko failed for ${symbol}:`, err);
    return null;
  }
}

// ============================================================
// Fetch real current price from CoinGecko
// ============================================================
async function fetchCoinGeckoPrice(symbol: string): Promise<number | null> {
  const coinId = COINGECKO_IDS[symbol];
  if (!coinId) return null;

  const cacheKey = `cg_price_${symbol}`;
  const cached = getCached<number>(cacheKey);
  if (cached) return cached;

  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`;
    const res = await fetch(url, { next: { revalidate: 15 } });
    if (!res.ok) return null;
    const data = await res.json();
    const price = data[coinId]?.usd;
    if (price) setCache(cacheKey, price);
    return price || null;
  } catch { return null; }
}

// ============================================================
// Get candles: try real sources first, demo as last resort
// ============================================================
async function getCandlesForSymbol(symbol: string, timeframe: string, limit: number): Promise<CandleData[]> {
  // 1. Try CoinGecko for crypto
  const cgCandles = await fetchCoinGeckoCandles(symbol, timeframe, limit);
  if (cgCandles && cgCandles.length >= 30) return cgCandles;

  // 2. Try broker via DB account
  if (db && hasModel('tradingAccount')) {
    try {
      const userId = await ensureDemoUser();
      if (userId) {
        const account = await db.tradingAccount.findFirst({ where: { userId, isDefault: true } });
        if (account) {
          const broker = await createBrokerFromAccount(account);
          const brokerCandles = await broker.getCandles(symbol, timeframe, limit);
          if (brokerCandles && brokerCandles.length >= 30) return brokerCandles;
        }
      }
    } catch { /* broker unavailable */ }
  }

  // 3. Last resort: demo candles
  return getDemoCandles(symbol, timeframe, limit);
}

// ============================================================
// Get current price: real source first
// ============================================================
async function getPriceForSymbol(symbol: string): Promise<number> {
  // Try CoinGecko for crypto
  const cgPrice = await fetchCoinGeckoPrice(symbol);
  if (cgPrice) return cgPrice;

  // Try broker
  if (db && hasModel('tradingAccount')) {
    try {
      const userId = await ensureDemoUser();
      if (userId) {
        const account = await db.tradingAccount.findFirst({ where: { userId, isDefault: true } });
        if (account) {
          const broker = await createBrokerFromAccount(account);
          return await broker.getPrice(symbol);
        }
      }
    } catch { /* broker unavailable */ }
  }

  // Fallback
  return getDemoPrice(symbol);
}

// ============================================================
// Core signal generation with real data
// ============================================================
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
      // Get REAL candles
      const candles = await getCandlesForSymbol(symbol, timeframe, 100);
      if (candles.length < 30) continue;

      // Run technical analysis on real data
      const candidates = generateSignals(symbol, candles, timeframe as any, riskTolerance as any);

      // Get real current price
      const price = await getPriceForSymbol(symbol);

      for (const c of candidates) {
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

  return allSignals.sort((a, b) => b.confidence - a.confidence);
}

// ============================================================
// Persist signals to database
// ============================================================
async function persistSignalsToDb(signals: SignalOutput[]): Promise<void> {
  if (!db || !hasModel('tradingAccount') || !hasModel('tradingSignal')) return;
  try {
    const userId = await ensureDemoUser();
    if (!userId) return;
    const account = await db.tradingAccount.findFirst({ where: { userId, isDefault: true } });
    if (!account) return;

    for (const s of signals) {
      await db.tradingSignal.create({
        data: {
          id: uuidv4(), accountId: account.id, symbol: s.symbol,
          assetType: s.assetType, direction: s.direction,
          confidence: s.confidence, signalType: s.signalType,
          timeframe: s.timeframe, entryPrice: s.entryPrice,
          stopLoss: s.stopLoss, takeProfit: s.takeProfit,
          reasoning: s.reasoning, status: 'active',
          expiresAt: new Date(s.expiresAt),
        },
      }).catch(() => {}); // ignore duplicate errors
    }
  } catch (err) {
    console.warn('[signals/generate] DB persist error:', err);
  }
}

// ============================================================
// POST handler
// ============================================================
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const symbol = body.symbol || '';
    const timeframe = body.timeframe || '1h';
    const riskTolerance = body.riskTolerance || 'medium';
    const symbols = symbol ? [symbol.toUpperCase()] : SCAN_SYMBOLS;

    // Generate signals using real market data
    const signals = await generateRealSignals(symbols, timeframe, riskTolerance);

    // Persist to database in background (don't block response)
    if (signals.length > 0) {
      persistSignalsToDb(signals).catch(() => {});
    }

    return NextResponse.json(signals);
  } catch (error) {
    console.error('[signals/generate] Error:', error);
    return NextResponse.json({ error: 'Failed to generate signals' }, { status: 500 });
  }
}
