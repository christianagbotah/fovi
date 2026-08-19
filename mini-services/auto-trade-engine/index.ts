// ============================================================
// Fovi Auto-Trade Engine — Thin Startup Entry Point
// CR4.3A R7:
//   Imports all core logic from engine-core.ts.
//   processBot extracted to process-bot-core.ts with eligibility gate.
//   This file ONLY contains: config, DB setup, Bun.serve,
//   in-memory state, auth, SQL helpers, execution cycle, startup.
//   No duplicate fetch/cache/eligibility logic.
// ============================================================

import postgres from 'postgres';
import { createHash, timingSafeEqual as nodeTimingSafeEqual } from 'node:crypto';
import {
  generateSignal,
  calculatePositionSize,
  updateDCALastBuy,
  type CandleData,
  type TradeSignal,
} from './strategies';
import {
  fetchMarketPrice,
  fetchCandles,
  ALL_SYMBOLS,
  type FetchMarketPriceDeps,
  type FetchCandlesDeps,
} from './engine-core';
import { validateEngineProvenance } from './market-provenance';
import { processBotCore, type BotRow as ProcessBotRow, type ProcessBotDeps } from './process-bot-core';
import { evaluateEngineAccountEligibility } from '../../src/lib/engine-eligibility';

// ============================================================
// Configuration
// ============================================================

const PORT = 3012;
const POLL_INTERVAL_MS = 60_000;
const NEXTJS_API = 'http://localhost:3002';

function envBool(name: string): boolean {
  const raw = process.env[name];
  if (!raw) return false;
  const lower = raw.trim().toLowerCase();
  return lower === 'true' || lower === '1' || lower === 'yes';
}
const AUTOMATED_TRADING_ENABLED = envBool('AUTOMATED_TRADING_ENABLED');
const INTERNAL_SERVICE_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';

// Injectable deps for engine-core functions
const marketPriceDeps: FetchMarketPriceDeps = { nextjsApi: NEXTJS_API };
const candleDeps: FetchCandlesDeps = { nextjsApi: NEXTJS_API };

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
    isDemo: boolean | null;
    balance: number;
    isActive: boolean;
    apiKey: string | null;
    apiSecret: string | null;
    passphrase: string | null;
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
  accountBroker: string;
  accountType: string;
  accountIsDemo: boolean | null;
  accountBalance: number;
  accountIsActive: boolean;
  accountApiKey: string | null;
  accountApiSecret: string | null;
  accountPassphrase: string | null;
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
// Internal service auth
// ============================================================

function constantTimeEqual(a: string, b: string): boolean {
  try {
    const encoder = new TextEncoder();
    const digestA = createHash('sha256').update(encoder.encode(a)).digest();
    const digestB = createHash('sha256').update(encoder.encode(b)).digest();
    return nodeTimingSafeEqual(digestA, digestB);
  } catch {
    return false;
  }
}

function checkInternalAuth(req: Request): { valid: boolean; status: number } {
  if (!INTERNAL_SERVICE_SECRET) {
    return { valid: false, status: 503 };
  }
  const provided = req.headers.get('x-internal-service-secret') || '';
  if (constantTimeEqual(provided, INTERNAL_SERVICE_SECRET)) {
    return { valid: true, status: 200 };
  }
  return { valid: false, status: 401 };
}

function authErrorResponse(status: number): Response {
  const code = status === 503 ? 'INTERNAL_AUTH_REQUIRED' : 'INTERNAL_AUTH_INVALID';
  const msg = status === 503 ? 'Internal service authentication not configured.' : 'Unauthorized.';
  return new Response(
    JSON.stringify({ error: msg, code }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
}

// ============================================================
// HTTP Server
// ============================================================

const engineStartTime = Date.now();
let cycleCount = 0;
let lastCycleTime: string | null = null;
let lastCycleError: string | null = null;

Bun.serve({
  port: PORT,
  hostname: '127.0.0.1',
  fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === '/health' || url.pathname === '/') {
      return Response.json({
        status: 'ok', service: 'fovi-auto-trade-engine', port: PORT,
        uptime: Math.floor((Date.now() - engineStartTime) / 1000),
        cycleCount, lastCycleTime, lastCycleError,
        pollIntervalMs: POLL_INTERVAL_MS, automatedTradingEnabled: AUTOMATED_TRADING_ENABLED,
      });
    }

    if (url.pathname === '/status') {
      const auth = checkInternalAuth(req);
      if (!auth.valid) return authErrorResponse(auth.status);
      return Response.json({
        cycleCount, lastCycleTime, lastCycleError,
        engineUptimeS: Math.floor((Date.now() - engineStartTime) / 1000),
        managedPositions: positions.size, activeBots: 0,
        dbReady: pgReady, automatedTradingEnabled: AUTOMATED_TRADING_ENABLED,
      });
    }

    if (url.pathname === '/cycle' && req.method === 'POST') {
      const auth = checkInternalAuth(req);
      if (!auth.valid) return authErrorResponse(auth.status);
      if (!AUTOMATED_TRADING_ENABLED) {
        return Response.json(
          { triggered: false, code: 'PHASE1_LIVE_TRADING_DISABLED', remediationPhase: 'containment' },
          { status: 403 },
        );
      }
      runCycle().catch((e) => console.error('[AutoTrade] Manual cycle error:', e));
      return Response.json({ triggered: true });
    }

    if (url.pathname === '/activity') {
      const auth = checkInternalAuth(req);
      if (!auth.valid) return authErrorResponse(auth.status);
      return Response.json(activityLog);
    }

    if (url.pathname === '/positions') {
      const auth = checkInternalAuth(req);
      if (!auth.valid) return authErrorResponse(auth.status);
      return Response.json(Array.from(positions.values()));
    }

    return new Response('Not Found', { status: 404 });
  },
});

console.log(`[AutoTrade] Engine HTTP server running on 127.0.0.1:${PORT}`);
console.log(`[AutoTrade] AUTOMATED_TRADING_ENABLED: ${AUTOMATED_TRADING_ENABLED}`);
console.log(`[AutoTrade] Endpoints: GET /health, GET /status, POST /cycle, GET /activity, GET /positions`);
console.log(`[AutoTrade] Next.js API target: ${NEXTJS_API}`);

// ============================================================
// Bot Table Direct SQL Helpers
// ============================================================

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
        a."isDemo" AS "accountIsDemo",
        a.balance AS "accountBalance",
        a."isActive" AS "accountIsActive",
        a."apiKey" AS "accountApiKey",
        a."apiSecret" AS "accountApiSecret",
        a."passphrase" AS "accountPassphrase"
      FROM "Bot" b
      LEFT JOIN "TradingAccount" a ON a.id = b."accountId"
      WHERE b.enabled = true
        AND b.status = 'running'
        AND a."isActive" = true
        AND a.broker = 'demo'
        AND a."accountType" = 'demo'
        AND a."isDemo" = true
        AND a."apiKey" IS NULL
        AND a."apiSecret" IS NULL
        AND a."passphrase" IS NULL
    `;
    return rows;
  } catch (err) {
    console.warn('[AutoTrade] Failed to query Bot table:', err instanceof Error ? err.message : err);
    return [];
  }
}

async function updateBotStats(
  botId: string,
  stats: {
    totalTrades: number; winTrades: number; lossTrades: number;
    totalPnl: number; bestTrade: number; worstTrade: number;
    lastTradeAt?: Date | null;
  },
) {
  if (!sql || !pgReady) return;
  try {
    await sql`
      UPDATE "Bot"
      SET "totalTrades" = ${stats.totalTrades}, "winTrades" = ${stats.winTrades},
          "lossTrades" = ${stats.lossTrades}, "totalPnl" = ${stats.totalPnl},
          "bestTrade" = ${stats.bestTrade}, "worstTrade" = ${stats.worstTrade},
          "lastTradeAt" = ${stats.lastTradeAt ?? new Date()}, "updatedAt" = NOW()
      WHERE id = ${botId}
    `;
  } catch (err) {
    console.warn(`[AutoTrade] Failed to update Bot stats for ${botId}:`, err instanceof Error ? err.message : err);
  }
}

async function updateBotLastError(botId: string, error: string | null) {
  if (!sql || !pgReady) return;
  try {
    await sql`UPDATE "Bot" SET "lastError" = ${error}, "updatedAt" = NOW() WHERE id = ${botId}`;
  } catch (err) {
    console.warn(`[AutoTrade] Failed to update Bot lastError for ${botId}:`, err instanceof Error ? err.message : err);
  }
}

// ============================================================
// HTTP API Calls to Next.js
// ============================================================

async function callNextJSApi(
  method: string, path: string, body?: Record<string, unknown>,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  try {
    const url = `${NEXTJS_API}${path}`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (INTERNAL_SERVICE_SECRET) {
      headers['X-Internal-Service-Secret'] = INTERNAL_SERVICE_SECRET;
    }
    const opts: RequestInit = { method, headers, signal: AbortSignal.timeout(30_000) };
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

  if (!AUTOMATED_TRADING_ENABLED) {
    console.log('[AutoTrade] AUTOMATED_TRADING_ENABLED=false — skipping cycle');
    lastCycleTime = new Date().toISOString();
    lastCycleError = null;
    cycleCount++;
    return;
  }

  try {
    const result = await callNextJSApi('GET', '/api/trading/engine/bots');
    if (!result.ok || !Array.isArray(result.data)) {
      console.warn('[AutoTrade] Failed to fetch bots from API:', result.error);
      lastCycleError = 'Failed to fetch bots';
      return;
    }

    const botConfigs = result.data as BotRow[];
    console.log(`[AutoTrade] Found ${botConfigs.length} active bot(s)`);

    for (const config of botConfigs) {
      addActivity({ type: 'cycle_start', botId: config.id, botName: config.name, symbol: '—' });
    }

    for (const config of botConfigs) {
      try {
        await processBot(config);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[AutoTrade] ✗ Error processing bot ${config.id}:`, errMsg);
        lastCycleError = errMsg;
        addActivity({ type: 'error', botId: config.id, botName: config.name, symbol: '—', error: errMsg });
        callNextJSApi('POST', '/api/trading/engine/report', { botId: config.id, tradeType: 'error', reason: errMsg });
      }
    }

    for (const config of botConfigs) {
      addActivity({ type: 'cycle_end', botId: config.id, botName: config.name, symbol: '—' });
    }

    // Bot Manager bots (Bot table)
    try {
      const botTableBots = await fetchBotTableBots();
      if (botTableBots.length > 0) {
        console.log(`[AutoTrade] Found ${botTableBots.length} running Bot Manager bot(s) from "Bot" table`);
      }

      for (const bot of botTableBots) {
        const tag = `[AutoTrade] [BotTable:${bot.id.slice(0, 8)}]`;
        console.log(`${tag} Processing "${bot.name}" (strategy: ${bot.strategy}, symbols: ${bot.symbols})`);
        addActivity({ type: 'cycle_start', botId: bot.id, botName: bot.name, symbol: '—' });

        const config: BotRow = {
          id: bot.id, userId: bot.userId, accountId: bot.accountId,
          name: bot.name, strategy: bot.strategy, symbols: bot.symbols,
          timeframe: bot.timeframe, allocationAmount: bot.allocationAmount,
          enabled: bot.enabled, status: bot.status,
          riskPerTrade: bot.riskPerTrade, maxPositions: bot.maxPositions,
          stopLossPercent: bot.stopLossPercent, takeProfitPercent: bot.takeProfitPercent,
          totalTrades: bot.totalTrades, winTrades: bot.winTrades, totalPnl: bot.totalPnl,
          account: bot.accountId ? {
            id: bot.accountId, broker: bot.accountBroker, accountType: bot.accountType,
            isDemo: bot.accountIsDemo, balance: bot.accountBalance, isActive: bot.accountIsActive,
            apiKey: bot.accountApiKey, apiSecret: bot.accountApiSecret, passphrase: bot.accountPassphrase,
          } : null,
        };

        const preActivityLen = activityLog.length;
        try {
          await processBot(config);
          const newEntries = activityLog.slice(0, activityLog.length - preActivityLen);

          let deltaTrades = 0, deltaWins = 0, deltaLosses = 0, deltaPnl = 0;
          let bestTrade = bot.bestTrade, worstTrade = bot.worstTrade, hadTrade = false;

          for (const entry of newEntries) {
            if (entry.botId !== bot.id) continue;
            if (entry.type === 'trade_opened') { deltaTrades++; hadTrade = true; }
            if (entry.type === 'sl_hit' || entry.type === 'tp_hit') {
              const pnl = entry.pnl ?? 0;
              deltaTrades++; deltaPnl += pnl;
              if (pnl > 0) { deltaWins++; if (pnl > bestTrade) bestTrade = pnl; }
              else { deltaLosses++; if (pnl < worstTrade) worstTrade = pnl; }
              hadTrade = true;
            }
          }

          if (hadTrade) {
            await updateBotStats(bot.id, {
              totalTrades: bot.totalTrades + deltaTrades, winTrades: bot.winTrades + deltaWins,
              lossTrades: bot.lossTrades + deltaLosses, totalPnl: bot.totalPnl + deltaPnl,
              bestTrade, worstTrade, lastTradeAt: new Date(),
            });
            console.log(`${tag} Stats updated: +${deltaTrades} trades, PnL Δ=${deltaPnl.toFixed(2)}`);
          }
          if (bot.lastError) await updateBotLastError(bot.id, null);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error(`${tag} ✗ Error:`, errMsg);
          lastCycleError = errMsg;
          addActivity({ type: 'error', botId: bot.id, botName: bot.name, symbol: '—', error: errMsg });
          await updateBotLastError(bot.id, errMsg);
        }

        addActivity({ type: 'cycle_end', botId: bot.id, botName: bot.name, symbol: '—' });
      }
    } catch (err) {
      console.warn('[AutoTrade] Bot table processing phase error:', err instanceof Error ? err.message : err);
    }

    lastCycleError = null;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[AutoTrade] ✗ Cycle failed:', errMsg);
    lastCycleError = errMsg;
    addActivity({ type: 'error', botId: 'system', botName: 'System', symbol: '—', error: errMsg });
  }

  cycleCount++;
  lastCycleTime = new Date().toISOString();
  const elapsed = Date.now() - cycleStart;
  console.log(`[AutoTrade] ═══ Cycle #${cycleCount} completed in ${elapsed}ms ═══\n`);
}

// ============================================================
// Process a Single Bot
// ============================================================

// processBot is now delegated to process-bot-core.ts with eligibility gate
async function processBot(config: BotRow) {
  await processBotCore(config as unknown as ProcessBotRow, {
    fetchMarketPrice,
    fetchCandles,
    validateEngineProvenance: validateEngineProvenance as ProcessBotDeps['validateEngineProvenance'],
    generateSignal,
    calculatePositionSize,
    updateDCALastBuy,
    marketPriceDeps,
    candleDeps,
    positions,
    addActivity: (entry) => addActivity(entry as Omit<ActivityEntry, 'id' | 'timestamp'>),
    callNextJSApi,
    executeTrade: executeTrade as unknown as ProcessBotDeps['executeTrade'],
    automatedTradingEnabled: AUTOMATED_TRADING_ENABLED,
    allSymbols: ALL_SYMBOLS,
    evaluateEngineAccountEligibility,
  });
}

// ============================================================
// Execute a Trade
// ============================================================

async function executeTrade(
  config: BotRow,
  trade: { symbol: string; side: 'buy' | 'sell'; qty: number; price: number; stopLoss: number; takeProfit: number; confidence: number; reason: string },
) {
  const orderBody = {
    symbol: trade.symbol, side: trade.side, type: 'market', qty: trade.qty,
    stopLoss: trade.stopLoss, takeProfit: trade.takeProfit, aiGenerated: true,
    accountId: config.accountId, reason: trade.reason,
  };

  const result = await callNextJSApi('POST', '/api/trading/orders', orderBody);

  if (result.ok && result.data) {
    const orderData = result.data as Record<string, unknown>;
    console.log(`  Order placed via API: id=${orderData.id} status=${orderData.status}`);
    const positionId = `eng_${config.id}_${trade.symbol}_${Date.now()}`;
    positions.set(positionId, {
      id: positionId, botId: config.id, accountId: config.accountId,
      symbol: trade.symbol, side: trade.side === 'buy' ? 'long' : 'short',
      qty: trade.qty, avgEntryPrice: trade.price, currentPrice: trade.price,
      stopLoss: trade.stopLoss, takeProfit: trade.takeProfit,
      openedAt: Date.now(), unrealizedPnl: 0,
    });
    callNextJSApi('POST', '/api/trading/engine/report', { botId: config.id, tradeType: 'opened', symbol: trade.symbol, side: trade.side, qty: trade.qty, price: trade.price });
    addActivity({ type: 'trade_opened', botId: config.id, botName: config.name, symbol: trade.symbol, side: trade.side, qty: trade.qty, price: trade.price });
  } else {
    console.warn(`  Order failed: ${result.error}`);
    addActivity({ type: 'error', botId: config.id, botName: config.name, symbol: trade.symbol, side: trade.side, error: `Order failed: ${result.error}` });
  }
}

// ============================================================
// Start the Engine
// ============================================================

runCycle().catch((err) => console.error('[AutoTrade] Initial cycle failed:', err));

setInterval(() => {
  runCycle().catch((err) => console.error('[AutoTrade] Scheduled cycle failed:', err));
}, POLL_INTERVAL_MS);

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
