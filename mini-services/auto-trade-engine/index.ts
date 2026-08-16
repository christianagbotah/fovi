// ============================================================
// Fovi Auto-Trade Engine — API-first Execution Loop
// ============================================================
// Mini-service that polls the Next.js API for active bot configs,
// monitors in-memory positions for SL/TP hits, and executes trades.
//
// Architecture (v2 — API-first + Bot table):
//   - Fetches active BotConfig bots via GET /api/trading/engine/bots
//   - ALSO queries the "Bot" table directly (PostgreSQL) for Bot Manager bots
//   - Executes trades via POST /api/trading/orders
//   - Reports results via POST /api/trading/engine/report
//   - Updates Bot table stats (totalTrades, winTrades, totalPnl, etc.) directly
//   - Maintains in-memory position tracking for SL/TP monitoring
//   - Uses real technical analysis (RSI, MACD, SMA, BB, ATR) for signals
//   - Fetches real candle data (CoinGecko OHLC) when available
// ============================================================

import postgres from 'postgres';
import {
  generateSignal,
  calculatePositionSize,
  updateDCALastBuy,
  type CandleData,
  type TradeSignal,
} from './strategies';
import { isEligibleForTrading } from './engine-eligibility';

// ============================================================
// Configuration
// ============================================================

const PORT = 3012;
const POLL_INTERVAL_MS = 60_000; // 60 seconds
const NEXTJS_API = 'http://localhost:3002';

// ============================================================
// PostgreSQL Connection (for Bot table queries)
// ============================================================

const databaseUrl = process.env.DATABASE_URL || '';
let sql: ReturnType<typeof postgres> | null = null;
let pgReady = false;

if (databaseUrl.startsWith('postgresql://') || databaseUrl.startsWith('postgres://')) {
  sql = postgres(databaseUrl);
  pgReady = true;
  console.log('[AutoTrade] PostgreSQL connection established — Bot table processing enabled');
} else {
  console.warn('[AutoTrade] DATABASE_URL is not PostgreSQL — Bot table processing will be skipped.');
}

// ============================================================
// Types
// ============================================================

interface BotRow {
  id: string;
  userId: string;
  accountId: string;
  name: string;
  strategy: string;
  symbols: string;
  timeframe: string;
  allocationAmount: number;
  enabled: boolean;
  status: string;
  riskPerTrade: number;
  maxPositions: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  totalTrades: number;
  winTrades: number;
  totalPnl: number;
  account: {
    id: string;
    broker: string;
    accountType: string;
    balance: number;
    isActive: boolean;
  } | null;
}

interface InMemoryPosition {
  id: string;
  botId: string;
  accountId: string;
  symbol: string;
  side: 'long' | 'short';
  qty: number;
  avgEntryPrice: number;
  currentPrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
  openedAt: number;
  unrealizedPnl: number;
}

// Bot table row (from direct SQL query — Bot Manager bots)
interface BotTableBot {
  id: string;
  userId: string;
  accountId: string;
  name: string;
  strategy: string;
  symbols: string;
  timeframe: string;
  allocationAmount: number;
  enabled: boolean;
  status: string;
  riskPerTrade: number;
  maxPositions: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  trailingStopPct: number;
  positionSizing: string;
  totalTrades: number;
  winTrades: number;
  lossTrades: number;
  totalPnl: number;
  bestTrade: number;
  worstTrade: number;
  currentStreak: number;
  lastTradeAt: string | null;
  lastError: string | null;
  // Joined TradingAccount fields
  accountBroker: string;
  accountType: string;
  accountBalance: number;
  accountIsActive: boolean;
}

interface ActivityEntry {
  id: string;
  timestamp: string;
  type: 'trade_opened' | 'trade_closed' | 'signal_generated' | 'cycle_start' | 'cycle_end' | 'error' | 'sl_hit' | 'tp_hit';
  botId: string;
  botName: string;
  symbol: string;
  side?: string;
  qty?: number;
  price?: number;
  pnl?: number;
  reason?: string;
  confidence?: number;
  error?: string;
}

// ============================================================
// In-Memory State
// ============================================================

const positions = new Map<string, InMemoryPosition>();
const activityLog: ActivityEntry[] = [];
const MAX_ACTIVITY = 200;

function addActivity(entry: Omit<ActivityEntry, 'id' | 'timestamp'>) {
  activityLog.unshift({
    ...entry,
    id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
  });
  if (activityLog.length > MAX_ACTIVITY) activityLog.length = MAX_ACTIVITY;
}

// ============================================================
// HTTP Health Check Server (Bun.serve)
// ============================================================

const engineStartTime = Date.now();
let cycleCount = 0;
let lastCycleTime: string | null = null;
let lastCycleError: string | null = null;

Bun.serve({
  port: PORT,
  fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === '/health' || url.pathname === '/') {
      return Response.json({
        status: 'ok',
        service: 'fovi-auto-trade-engine',
        port: PORT,
        uptime: Math.floor((Date.now() - engineStartTime) / 1000),
        cycleCount,
        lastCycleTime,
        lastCycleError,
        pollIntervalMs: POLL_INTERVAL_MS,
      });
    }

    if (url.pathname === '/status') {
      return Response.json({
        cycleCount,
        lastCycleTime,
        lastCycleError,
        engineUptimeS: Math.floor((Date.now() - engineStartTime) / 1000),
        managedPositions: positions.size,
        activeBots: 0,
        dbReady: pgReady,
      });
    }

    if (url.pathname === '/cycle' && req.method === 'POST') {
      runCycle().catch((e) => {
        console.error('[AutoTrade] Manual cycle error:', e);
      });
      return Response.json({ triggered: true });
    }

    if (url.pathname === '/activity') {
      return Response.json(activityLog);
    }

    if (url.pathname === '/positions') {
      return Response.json(Array.from(positions.values()));
    }

    return new Response('Not Found', { status: 404 });
  },
});

console.log(`[AutoTrade] Engine HTTP server running on port ${PORT}`);
console.log(`[AutoTrade] Endpoints: GET /health, GET /status, POST /cycle, GET /activity, GET /positions`);
console.log(`[AutoTrade] Next.js API target: ${NEXTJS_API}`);

// ============================================================
// Bot Table Direct SQL Helpers
// ============================================================

/** Fetch running bots from the Bot table (Bot Manager page) */
async function fetchBotTableBots(): Promise<BotTableBot[]> {
  if (!sql || !pgReady) return [];
  try {
    const rows = await sql<BotTableBot[]>`
      SELECT
        b.id, b."userId", b."accountId", b.name, b.strategy, b.symbols,
        b.timeframe, b."allocationAmount", b.enabled, b.status,
        b."riskPerTrade", b."maxPositions", b."stopLossPercent",
        b."takeProfitPercent", b."trailingStopPct", b."positionSizing",
        b."totalTrades", b."winTrades", b."lossTrades", b."totalPnl",
        b."bestTrade", b."worstTrade", b."currentStreak",
        b."lastTradeAt", b."lastError",
        a.broker AS "accountBroker",
        a."accountType",
        a.balance AS "accountBalance",
        a."isActive" AS "accountIsActive"
      FROM "Bot" b
      LEFT JOIN "TradingAccount" a ON a.id = b."accountId"
      WHERE b.enabled = true
        AND b.status = 'running'
        AND a."isActive" = true
    `;
    return rows;
  } catch (err) {
    console.warn('[AutoTrade] Failed to query Bot table:', err instanceof Error ? err.message : err);
    return [];
  }
}

/** Update stats columns on a Bot row after processing */
async function updateBotStats(
  botId: string,
  stats: {
    totalTrades: number;
    winTrades: number;
    lossTrades: number;
    totalPnl: number;
    bestTrade: number;
    worstTrade: number;
    lastTradeAt?: Date | null;
  },
) {
  if (!sql || !pgReady) return;
  try {
    await sql`
      UPDATE "Bot"
      SET
        "totalTrades"  = ${stats.totalTrades},
        "winTrades"    = ${stats.winTrades},
        "lossTrades"   = ${stats.lossTrades},
        "totalPnl"     = ${stats.totalPnl},
        "bestTrade"    = ${stats.bestTrade},
        "worstTrade"   = ${stats.worstTrade},
        "lastTradeAt"  = ${stats.lastTradeAt ?? new Date()},
        "updatedAt"    = NOW()
      WHERE id = ${botId}
    `;
  } catch (err) {
    console.warn(`[AutoTrade] Failed to update Bot stats for ${botId}:`, err instanceof Error ? err.message : err);
  }
}

/** Update lastError on a Bot row */
async function updateBotLastError(botId: string, error: string | null) {
  if (!sql || !pgReady) return;
  try {
    await sql`
      UPDATE "Bot"
      SET "lastError" = ${error}, "updatedAt" = NOW()
      WHERE id = ${botId}
    `;
  } catch (err) {
    console.warn(`[AutoTrade] Failed to update Bot lastError for ${botId}:`, err instanceof Error ? err.message : err);
  }
}

// ============================================================
// Market Price Fetch — CoinGecko → Next.js API → demo
// ============================================================

const COINGECKO_IDS: Record<string, string> = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', BNB: 'binancecoin',
  XRP: 'ripple', DOGE: 'dogecoin', ADA: 'cardano', AVAX: 'avalanche-2',
  DOT: 'polkadot', LINK: 'chainlink',
};

function isCryptoSymbol(symbol: string): boolean {
  return symbol.toUpperCase() in COINGECKO_IDS;
}

const DEMO_BASE_PRICES: Record<string, number> = {
  AAPL: 195.5, GOOGL: 178.2, MSFT: 445.8, AMZN: 198.3, NVDA: 920.5,
  TSLA: 245.6, META: 530.2, NFLX: 720.1, AMD: 178.5, INTC: 32.4,
  BTC: 67500, ETH: 3520, SOL: 172.5, BNB: 595, XRP: 0.58,
  DOGE: 0.165, ADA: 0.48, AVAX: 38.2, DOT: 7.35, LINK: 17.8,
};

const ALL_SYMBOLS = Object.keys(DEMO_BASE_PRICES);

function getDemoPrice(symbol: string): number {
  const base = DEMO_BASE_PRICES[symbol] || 100;
  const seed = Math.sin(Date.now() / 5000 + base) * 10000;
  const rand = seed - Math.floor(seed);
  return Math.max(0.01, Math.round((base + (rand - 0.48) * 2 * 0.002 * base) * 100) / 100);
}

async function fetchMarketPrice(symbol: string): Promise<number> {
  // Layer 1: Next.js market API
  try {
    const res = await fetch(
      `${NEXTJS_API}/api/trading/market/symbols?symbol=${encodeURIComponent(symbol)}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (res.ok) {
      const data = await res.json() as Record<string, unknown>;
      const price = data.price ?? data.currentPrice;
      if (typeof price === 'number' && price > 0) return price;
    }
  } catch { /* fall through */ }

  // Layer 2: CoinGecko for crypto
  if (isCryptoSymbol(symbol)) {
    try {
      const id = COINGECKO_IDS[symbol.toUpperCase()];
      const res = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (res.ok) {
        const data = await res.json() as Record<string, { usd?: number }>;
        const price = data[id]?.usd;
        if (price && price > 0) return price;
      }
    } catch { /* fall through */ }
  }

  // Layer 3: Demo
  return getDemoPrice(symbol);
}

// ============================================================
// Candle Data Fetching
// ============================================================

const candleCache = new Map<string, { candles: CandleData[]; ts: number }>();
const CANDLE_CACHE_TTL = 45_000;

async function fetchCandles(symbol: string, limit: number = 100): Promise<CandleData[]> {
  const cacheKey = `${symbol}_${limit}`;
  const cached = candleCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CANDLE_CACHE_TTL) {
    return cached.candles;
  }

  let candles: CandleData[] | null = null;

  // Layer 1: CoinGecko OHLC
  if (isCryptoSymbol(symbol)) {
    candles = await fetchCoinGeckoOHLC(symbol, limit);
  }

  // Layer 2: Next.js API
  if (!candles || candles.length < 10) {
    candles = await fetchNextJSCandles(symbol, limit);
  }

  // Layer 3: Demo
  if (!candles || candles.length < 10) {
    candles = generateDemoCandles(symbol, limit);
  }

  candleCache.set(cacheKey, { candles, ts: Date.now() });
  return candles;
}

async function fetchCoinGeckoOHLC(symbol: string, limit: number): Promise<CandleData[] | null> {
  const coinId = COINGECKO_IDS[symbol.toUpperCase()];
  if (!coinId) return null;

  try {
    const url = `https://api.coingecko.com/api/v3/coins/${coinId}/ohlc?vs_currency=usd&days=30`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`CoinGecko OHLC HTTP ${res.status}`);

    const raw = (await res.json()) as number[][];
    if (!Array.isArray(raw) || raw.length === 0) return null;

    const candles: CandleData[] = raw.slice(-limit).map((c) => ({
      timestamp: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: 0,
    }));

    console.log(`[AutoTrade] Fetched ${candles.length} real OHLC candles for ${symbol} from CoinGecko`);
    return candles;
  } catch (err) {
    console.warn(`[AutoTrade] CoinGecko OHLC failed for ${symbol}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

async function fetchNextJSCandles(symbol: string, limit: number): Promise<CandleData[] | null> {
  try {
    const url = `${NEXTJS_API}/api/trading/market/symbols?symbol=${encodeURIComponent(symbol)}&timeframe=1d&limit=${limit}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;

    const data = await res.json() as CandleData[];
    if (!Array.isArray(data) || data.length === 0) return null;

    console.log(`[AutoTrade] Fetched ${data.length} candles for ${symbol} from Next.js API`);
    return data;
  } catch (err) {
    console.warn(`[AutoTrade] Next.js candle fetch failed for ${symbol}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

function generateDemoCandles(symbol: string, limit: number): CandleData[] {
  const base = DEMO_BASE_PRICES[symbol] || 100;
  const now = Date.now();
  const candles: CandleData[] = [];
  let price = base;
  const volatility = base > 1000 ? 0.015 : base > 10 ? 0.02 : 0.03;
  const minuteSeed = Math.floor(now / 60000);

  for (let i = 0; i < limit; i++) {
    const seed = Math.sin(minuteSeed + i * 1.618 + base * 0.01) * 10000;
    const rand = seed - Math.floor(seed);
    const change = (rand - 0.49) * 2 * volatility;
    const open = price;
    const close = price * (1 + change);
    const high = Math.max(open, close) * (1 + Math.abs(rand - 0.5) * volatility * 0.5);
    const low = Math.min(open, close) * (1 - Math.abs(rand - 0.5) * volatility * 0.5);

    candles.push({
      timestamp: now - (limit - i) * 86400000,
      open: roundPrice(open), high: roundPrice(high),
      low: roundPrice(low), close: roundPrice(close),
      volume: Math.round(base * 1000 * (0.8 + rand * 0.4)),
    });
    price = close;
  }

  console.log(`[AutoTrade] Generated ${candles.length} demo candles for ${symbol} (base=${base})`);
  return candles;
}

function roundPrice(price: number): number {
  if (price >= 1000) return Math.round(price * 100) / 100;
  if (price >= 1) return Math.round(price * 1000) / 1000;
  if (price >= 0.01) return Math.round(price * 100000) / 100000;
  return Math.round(price * 1000000) / 1000000;
}

// ============================================================
// HTTP API Calls to Next.js
// ============================================================

async function callNextJSApi(
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  try {
    const url = `${NEXTJS_API}${path}`;
    const opts: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30_000),
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    const text = await res.text();
    let data: unknown;
    try { data = JSON.parse(text); } catch { data = text; }
    return { ok: res.ok, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ============================================================
// Main Execution Cycle
// ============================================================

async function runCycle() {
  const cycleStart = Date.now();
  console.log(`[AutoTrade] ═══ Cycle #${cycleCount + 1} starting at ${new Date().toISOString()} ═══`);

  try {
    // Fetch active bots from Next.js API
    const result = await callNextJSApi('GET', '/api/trading/engine/bots');

    if (!result.ok || !Array.isArray(result.data)) {
      console.warn('[AutoTrade] Failed to fetch bots from API:', result.error);
      lastCycleError = 'Failed to fetch bots';
      return;
    }

    const botConfigs = result.data as BotRow[];
    console.log(`[AutoTrade] Found ${botConfigs.length} active bot(s)`);

    // Log cycle start for each bot
    for (const config of botConfigs) {
      addActivity({
        type: 'cycle_start',
        botId: config.id,
        botName: config.name,
        symbol: '—',
      });
    }

    for (const config of botConfigs) {
      try {
        await processBot(config);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[AutoTrade] ✗ Error processing bot ${config.id}:`, errMsg);
        lastCycleError = errMsg;

        addActivity({
          type: 'error',
          botId: config.id,
          botName: config.name,
          symbol: '—',
          error: errMsg,
        });

        // Report error to Next.js
        callNextJSApi('POST', '/api/trading/engine/report', {
          botId: config.id,
          tradeType: 'error',
          reason: errMsg,
        });
      }
    }

    // Log cycle end
    for (const config of botConfigs) {
      addActivity({
        type: 'cycle_end',
        botId: config.id,
        botName: config.name,
        symbol: '—',
      });
    }

    // ── Phase 2: Process Bot Manager bots (Bot table) ──
    try {
      const botTableBots = await fetchBotTableBots();
      if (botTableBots.length > 0) {
        console.log(`[AutoTrade] Found ${botTableBots.length} running Bot Manager bot(s) from "Bot" table`);
      }

      for (const bot of botTableBots) {
        const tag = `[AutoTrade] [BotTable:${bot.id.slice(0, 8)}]`;
        console.log(`${tag} Processing "${bot.name}" (strategy: ${bot.strategy}, symbols: ${bot.symbols})`);

        // Log cycle start for this bot
        addActivity({
          type: 'cycle_start',
          botId: bot.id,
          botName: bot.name,
          symbol: '—',
        });

        // Map BotTableBot → BotRow (same shape processBot expects)
        // Phase 1: only demo accounts allowed
        if (bot.accountType !== 'demo') {
          console.log(`${tag} SKIP — Phase 1: non-demo account blocked (credentialsAbsent=false)`);
          continue;
        }
        if (!bot.accountIsActive) {
          console.log(`${tag} SKIP — Account not active (credentialsAbsent=false)`);
          continue;
        }

        const config: BotRow = {
          id: bot.id,
          userId: bot.userId,
          accountId: bot.accountId,
          name: bot.name,
          strategy: bot.strategy,
          symbols: bot.symbols,
          timeframe: bot.timeframe,
          allocationAmount: bot.allocationAmount,
          enabled: bot.enabled,
          status: bot.status,
          riskPerTrade: bot.riskPerTrade,
          maxPositions: bot.maxPositions,
          stopLossPercent: bot.stopLossPercent,
          takeProfitPercent: bot.takeProfitPercent,
          totalTrades: bot.totalTrades,
          winTrades: bot.winTrades,
          totalPnl: bot.totalPnl,
          account: bot.accountId ? {
            id: bot.accountId,
            broker: bot.accountBroker,
            accountType: bot.accountType,
            balance: bot.accountBalance,
            isActive: bot.accountIsActive,
          } : null,
        };

        // Record activity log length before processing to detect new events
        const preActivityLen = activityLog.length;

        try {
          await processBot(config);

          // Scan new activity entries to derive stat deltas
          const newEntryCount = activityLog.length - preActivityLen;
          const newEntries = activityLog.slice(0, newEntryCount);

          let deltaTrades = 0;
          let deltaWins = 0;
          let deltaLosses = 0;
          let deltaPnl = 0;
          let bestTrade = bot.bestTrade;
          let worstTrade = bot.worstTrade;
          let hadTrade = false;

          for (const entry of newEntries) {
            if (entry.botId !== bot.id) continue;

            if (entry.type === 'trade_opened') {
              deltaTrades++;
              hadTrade = true;
            }

            if (entry.type === 'sl_hit' || entry.type === 'tp_hit') {
              const pnl = entry.pnl ?? 0;
              deltaTrades++;
              deltaPnl += pnl;
              if (pnl > 0) {
                deltaWins++;
                if (pnl > bestTrade) bestTrade = pnl;
              } else {
                deltaLosses++;
                if (pnl < worstTrade) worstTrade = pnl;
              }
              hadTrade = true;
            }
          }

          if (hadTrade) {
            await updateBotStats(bot.id, {
              totalTrades: bot.totalTrades + deltaTrades,
              winTrades: bot.winTrades + deltaWins,
              lossTrades: bot.lossTrades + deltaLosses,
              totalPnl: bot.totalPnl + deltaPnl,
              bestTrade,
              worstTrade,
              lastTradeAt: new Date(),
            });
            console.log(`${tag} Stats updated: +${deltaTrades} trades, PnL Δ=${deltaPnl.toFixed(2)}`);
          }

          // Clear lastError on successful processing
          if (bot.lastError) {
            await updateBotLastError(bot.id, null);
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error(`${tag} ✗ Error:`, errMsg);
          lastCycleError = errMsg;

          addActivity({
            type: 'error',
            botId: bot.id,
            botName: bot.name,
            symbol: '—',
            error: errMsg,
          });

          // Persist error to Bot table
          await updateBotLastError(bot.id, errMsg);
        }

        // Log cycle end for this bot
        addActivity({
          type: 'cycle_end',
          botId: bot.id,
          botName: bot.name,
          symbol: '—',
        });
      }
    } catch (err) {
      console.warn('[AutoTrade] Bot table processing phase error:', err instanceof Error ? err.message : err);
      // Don't set lastCycleError — BotConfig phase may have succeeded
    }

    lastCycleError = null;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[AutoTrade] ✗ Cycle failed:', errMsg);
    lastCycleError = errMsg;

    addActivity({
      type: 'error',
      botId: 'system',
      botName: 'System',
      symbol: '—',
      error: errMsg,
    });
  }

  cycleCount++;
  lastCycleTime = new Date().toISOString();
  const elapsed = Date.now() - cycleStart;
  console.log(`[AutoTrade] ═══ Cycle #${cycleCount} completed in ${elapsed}ms ═\n`);
}

// ============================================================
// Process a Single Bot
// ============================================================

async function processBot(config: BotRow) {
  const tag = `[AutoTrade] [${config.id.slice(0, 8)}]`;
  const eligibility = isEligibleForTrading(config);
  if (!eligibility.eligible) {
    console.log(`${tag} SKIP — ${eligibility.reason} (credentialsAbsent=${eligibility.credentialsAbsent})`);
    return;
  }
  // Map frontend strategy names to engine strategy names
  const strategyMap: Record<string, string> = {
    signal_based: 'balanced',
    scalping: 'momentum',
  };
  const strategy = strategyMap[config.strategy] || config.strategy || 'balanced';
  const risk = 'medium'; // Use medium as default risk tolerance
  const accountBalance = config.account?.balance ?? 100000;
  const maxPos = config.maxPositions || 5;

  console.log(`${tag} Processing "${config.name}" (strategy: ${strategy}, account: ${config.accountId})`);

  // ── Step 1: Check SL/TP on in-memory positions ──
  const botPositions = Array.from(positions.values()).filter(
    (p) => p.botId === config.id && p.accountId === config.accountId
  );

  const closedSymbols: Set<string> = new Set();

  for (const pos of botPositions) {
    const currentPrice = await fetchMarketPrice(pos.symbol);
    pos.currentPrice = currentPrice;
    pos.unrealizedPnl =
      pos.side === 'long'
        ? (currentPrice - pos.avgEntryPrice) * pos.qty
        : (pos.avgEntryPrice - currentPrice) * pos.qty;

    const sl = pos.stopLoss;
    const tp = pos.takeProfit;
    let closeReason: string | null = null;

    if (sl !== null && sl > 0) {
      if (pos.side === 'long' && currentPrice <= sl) closeReason = 'stop_loss';
      else if (pos.side === 'short' && currentPrice >= sl) closeReason = 'stop_loss';
    }

    if (!closeReason && tp !== null && tp > 0) {
      if (pos.side === 'long' && currentPrice >= tp) closeReason = 'take_profit';
      else if (pos.side === 'short' && currentPrice <= tp) closeReason = 'take_profit';
    }

    if (closeReason) {
      const pnl = pos.unrealizedPnl;
      const isWin = pnl > 0;

      console.log(
        `${tag} ${closeReason.toUpperCase()} hit for ${pos.symbol}: price=${currentPrice.toFixed(2)} PnL=${pnl.toFixed(2)}`
      );

      // Remove from in-memory positions
      positions.delete(pos.id);
      closedSymbols.add(pos.symbol);

      // Report to Next.js
      callNextJSApi('POST', '/api/trading/engine/report', {
        botId: config.id,
        tradeType: 'closed',
        pnl,
        isWin,
        reason: closeReason,
        symbol: pos.symbol,
        side: pos.side,
        price: currentPrice,
      });

      addActivity({
        type: closeReason === 'stop_loss' ? 'sl_hit' : 'tp_hit',
        botId: config.id,
        botName: config.name,
        symbol: pos.symbol,
        side: pos.side === 'long' ? 'sell' : 'buy',
        price: currentPrice,
        pnl,
      });
    }
  }

  // ── Step 2: Open new position if room ──
  const activePositionCount = botPositions.length - closedSymbols.size;
  if (activePositionCount >= maxPos) {
    console.log(`${tag} Max positions reached (${activePositionCount}/${maxPos})`);
    return;
  }

  // Get symbols from bot config, or use defaults
  const botSymbols = config.symbols
    ? config.symbols.split(',').map((s) => s.trim()).filter(Boolean)
    : ALL_SYMBOLS;

  // Exclude symbols with existing open positions
  const openSymbols = new Set(
    botPositions
      .filter((p) => !closedSymbols.has(p.symbol))
      .map((p) => p.symbol),
  );
  const symbols = botSymbols.filter((s) => !openSymbols.has(s));

  if (symbols.length === 0) {
    console.log(`${tag} No symbols available to scan`);
    return;
  }

  // ── Step 3: Run technical analysis ──
  let bestSignal: TradeSignal | null = null;

  for (const symbol of symbols) {
    try {
      const candles = await fetchCandles(symbol, 100);
      if (candles.length < 10) {
        console.log(`${tag} [${symbol}] Not enough candles (${candles.length}) — skipping`);
        continue;
      }

      const signal = generateSignal(candles, strategy, risk, symbol);
      if (!signal) continue;

      if (!bestSignal || signal.confidence > bestSignal.confidence) {
        bestSignal = signal;
      }
    } catch (err) {
      console.warn(`${tag} [${symbol}] Analysis error:`, err instanceof Error ? err.message : err);
    }
  }

  if (!bestSignal) {
    console.log(`${tag} No actionable signal (scanned ${symbols.length} symbols)`);
    return;
  }

  // ── Step 4: Validate confidence ──
  const minConfidence = 50; // Fixed minimum for all risk levels
  if (bestSignal.confidence < minConfidence) {
    console.log(`${tag} Signal confidence ${bestSignal.confidence}% below ${minConfidence}% — skipping`);
    return;
  }

  // ── Step 5: Position sizing ──
  const allocAmount = config.allocationAmount || 10000;
  const maxPosSize = allocAmount * 0.2;
  const livePrice = await fetchMarketPrice(bestSignal.symbol);
  if (livePrice <= 0) {
    console.log(`${tag} Invalid price for ${bestSignal.symbol}: ${livePrice}`);
    return;
  }

  const qty = calculatePositionSize(
    accountBalance,
    risk,
    livePrice,
    bestSignal.stopLoss,
    maxPosSize,
    allocAmount,
  );

  if (qty <= 0) {
    console.log(`${tag} Calculated qty=0 for ${bestSignal.symbol}`);
    return;
  }

  if (bestSignal.side === 'buy') {
    updateDCALastBuy(bestSignal.symbol, livePrice);
  }

  console.log(
    `${tag} Executing ${bestSignal.side.toUpperCase()} ${bestSignal.symbol} qty=${qty.toFixed(6)} @ ${livePrice.toFixed(2)} SL=${bestSignal.stopLoss.toFixed(2)} TP=${bestSignal.takeProfit.toFixed(2)} (confidence: ${bestSignal.confidence}%)`
  );

  // ── Step 6: Execute via Next.js API ──
  await executeTrade(config, {
    symbol: bestSignal.symbol,
    side: bestSignal.side,
    qty,
    price: livePrice,
    stopLoss: bestSignal.stopLoss,
    takeProfit: bestSignal.takeProfit,
    confidence: bestSignal.confidence,
    reason: bestSignal.reason,
  });

  // Also log signal
  addActivity({
    type: 'signal_generated',
    botId: config.id,
    botName: config.name,
    symbol: bestSignal.symbol,
    side: bestSignal.side,
    confidence: bestSignal.confidence,
    reason: bestSignal.reason,
  });
}

// ============================================================
// Execute a Trade (Open Position)
// ============================================================

async function executeTrade(
  config: BotRow,
  trade: {
    symbol: string;
    side: 'buy' | 'sell';
    qty: number;
    price: number;
    stopLoss: number;
    takeProfit: number;
    confidence: number;
    reason: string;
  }
) {
  const orderBody = {
    symbol: trade.symbol,
    side: trade.side,
    type: 'market',
    qty: trade.qty,
    stopLoss: trade.stopLoss,
    takeProfit: trade.takeProfit,
    aiGenerated: true,
    accountId: config.accountId,
    reason: trade.reason,
  };

  const result = await callNextJSApi('POST', '/api/trading/orders', orderBody);

  if (result.ok && result.data) {
    const orderData = result.data as Record<string, unknown>;
    console.log(`  Order placed via API: id=${orderData.id} status=${orderData.status}`);

    // Create in-memory position for SL/TP tracking
    const positionId = `eng_${config.id}_${trade.symbol}_${Date.now()}`;
    positions.set(positionId, {
      id: positionId,
      botId: config.id,
      accountId: config.accountId,
      symbol: trade.symbol,
      side: trade.side === 'buy' ? 'long' : 'short',
      qty: trade.qty,
      avgEntryPrice: trade.price,
      currentPrice: trade.price,
      stopLoss: trade.stopLoss,
      takeProfit: trade.takeProfit,
      openedAt: Date.now(),
      unrealizedPnl: 0,
    });

    // Report to Next.js
    callNextJSApi('POST', '/api/trading/engine/report', {
      botId: config.id,
      tradeType: 'opened',
      symbol: trade.symbol,
      side: trade.side,
      qty: trade.qty,
      price: trade.price,
    });

    addActivity({
      type: 'trade_opened',
      botId: config.id,
      botName: config.name,
      symbol: trade.symbol,
      side: trade.side,
      qty: trade.qty,
      price: trade.price,
    });
  } else {
    console.warn(`  Order failed: ${result.error}`);

    addActivity({
      type: 'error',
      botId: config.id,
      botName: config.name,
      symbol: trade.symbol,
      side: trade.side,
      error: `Order failed: ${result.error}`,
    });
  }
}

// ============================================================
// Start the Engine
// ============================================================

// Run first cycle immediately
runCycle().catch((err) => {
  console.error('[AutoTrade] Initial cycle failed:', err);
});

// Schedule recurring cycles
setInterval(() => {
  runCycle().catch((err) => {
    console.error('[AutoTrade] Scheduled cycle failed:', err);
  });
}, POLL_INTERVAL_MS);

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[AutoTrade] SIGTERM — shutting down');
  if (sql) sql.end().then(() => process.exit(0));
  else process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[AutoTrade] SIGINT — shutting down');
  if (sql) sql.end().then(() => process.exit(0));
  else process.exit(0);
});

console.log(`[AutoTrade] Poll interval: ${POLL_INTERVAL_MS / 1000}s`);
console.log(`[AutoTrade] Strategies: momentum | balanced | conservative | dca | grid`);
console.log(`[AutoTrade] Ready — waiting for first cycle...`);
