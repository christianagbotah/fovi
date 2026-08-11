// ============================================================
// Fovi Auto-Trade Engine — Server-Side Execution Loop
// ============================================================
// Mini-service that polls the database for active bot configs,
// monitors positions for SL/TP hits, and executes trades.
//
// Architecture:
//   - Reads bot configs + positions directly from PostgreSQL (postgres package)
//   - Executes trades via HTTP calls to the Next.js API (localhost:3002)
//   - Updates bot stats + positions directly in PostgreSQL
//   - Falls back to demo mode when DB is unavailable
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

// ============================================================
// Configuration
// ============================================================

const PORT = 3012;
const POLL_INTERVAL_MS = 60_000; // 60 seconds
const NEXTJS_API = 'http://localhost:3002';

// ============================================================
// Types (mirrors Prisma schema, plain objects from SQL)
// ============================================================

interface BotConfigRow {
  id: string;
  userId: string;
  accountId: string;
  enabled: boolean;
  allocationAmount: number;
  riskTolerance: string;
  maxPositions: number;
  maxPositionSize: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  strategy: string;
  status: string;
  adminLevyPercent: number;
  adminLevyCollected: number;
  grossPnl: number;
  totalTrades: number;
  winTrades: number;
  totalPnl: number;
  lastTradeAt: string | null;
  lastError: string | null;
  // Joined from TradingAccount
  account_broker: string;
  account_accountType: string;
  account_apiKey: string | null;
  account_apiSecret: string | null;
  account_passphrase: string | null;
  account_balance: number;
  account_id: string;
}

interface PositionRow {
  id: string;
  accountId: string;
  symbol: string;
  side: string;
  qty: number;
  avgEntryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  stopLoss: number | null;
  takeProfit: number | null;
  status: string;
}

// ============================================================
// Database Connection
// ============================================================

let sql: ReturnType<typeof postgres> | null = null;
let dbAvailable = false;

function initDatabase() {
  const dbUrl = process.env.DATABASE_URL || '';
  if (!dbUrl.startsWith('postgresql://') && !dbUrl.startsWith('postgres://')) {
    console.warn(
      '[AutoTrade] DATABASE_URL is not PostgreSQL (%s) — running in demo mode',
      dbUrl.slice(0, 40)
    );
    dbAvailable = false;
    return;
  }

  try {
    sql = postgres(dbUrl, {
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
    });
    dbAvailable = true;
    console.log('[AutoTrade] Connected to PostgreSQL');
  } catch (err) {
    console.error('[AutoTrade] Failed to connect to PostgreSQL:', err);
    dbAvailable = false;
  }
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
        dbAvailable,
        cycleCount,
        lastCycleTime,
        lastCycleError,
        pollIntervalMs: POLL_INTERVAL_MS,
      });
    }

    if (url.pathname === '/status') {
      return Response.json({
        dbAvailable,
        cycleCount,
        lastCycleTime,
        lastCycleError,
        engineUptimeS: Math.floor((Date.now() - engineStartTime) / 1000),
      });
    }

    if (url.pathname === '/cycle' && req.method === 'POST') {
      // Trigger an immediate cycle (for testing)
      runCycle().catch((e) => {
        console.error('[AutoTrade] Manual cycle error:', e);
      });
      return Response.json({ triggered: true });
    }

    return new Response('Not Found', { status: 404 });
  },
});

console.log(`[AutoTrade] Engine HTTP server running on port ${PORT}`);
console.log(`[AutoTrade] Endpoints: GET /health, GET /status, POST /cycle`);

// ============================================================
// Admin Levy — read from SystemConfig table
// ============================================================

async function getAdminLevy(): Promise<number> {
  if (!sql || !dbAvailable) return 10;
  try {
    const rows = await sql`SELECT config FROM "SystemConfig" WHERE key = 'trading'`;
    if (rows.length > 0) {
      const parsed = JSON.parse(rows[0].config as string);
      return parsed.defaultAdminLevyPercent ?? 10;
    }
  } catch {
    /* non-critical */
  }
  return 10;
}

// ============================================================
// Demo Mode — mock data when PostgreSQL is unavailable
// ============================================================

function getDemoBotConfigs(): BotConfigRow[] {
  return [
    {
      id: 'bc_demo_1',
      userId: 'usr_demo_1',
      accountId: 'acc_demo_1',
      enabled: true,
      allocationAmount: 25000,
      riskTolerance: 'medium',
      maxPositions: 3,
      maxPositionSize: 5000,
      stopLossPercent: 2.0,
      takeProfitPercent: 4.0,
      strategy: 'balanced',
      status: 'running',
      adminLevyPercent: 10,
      adminLevyCollected: 0,
      grossPnl: 0,
      totalTrades: 0,
      winTrades: 0,
      totalPnl: 0,
      lastTradeAt: null,
      lastError: null,
      account_broker: 'demo',
      account_accountType: 'demo',
      account_apiKey: null,
      account_apiSecret: null,
      account_passphrase: null,
      account_balance: 100000,
      account_id: 'acc_demo_1',
    },
  ];
}

function getDemoPositions(accountId: string): PositionRow[] {
  return [];
}

const DEMO_SYMBOLS = ['AAPL', 'NVDA', 'BTC', 'ETH', 'TSLA', 'GOOGL', 'MSFT', 'SOL', 'META', 'AMD'];

const DEMO_BASE_PRICES: Record<string, number> = {
  AAPL: 195.5, GOOGL: 178.2, MSFT: 445.8, AMZN: 198.3, NVDA: 920.5,
  TSLA: 245.6, META: 530.2, NFLX: 720.1, AMD: 178.5, INTC: 32.4,
  BTC: 67500, ETH: 3520, SOL: 172.5, BNB: 595, XRP: 0.58,
  DOGE: 0.165, ADA: 0.48, AVAX: 38.2, DOT: 7.35, LINK: 17.8,
};

function getDemoPrice(symbol: string): number {
  const base = DEMO_BASE_PRICES[symbol] || 100;
  const seed = Math.sin(Date.now() / 5000 + base) * 10000;
  const rand = seed - Math.floor(seed);
  return Math.max(0.01, Math.round((base + (rand - 0.48) * 2 * 0.002 * base) * 100) / 100);
}

// ============================================================
// Market Price Fetch — 3-layer: CoinGecko/Next.js API → direct DB → demo
// ============================================================

// CoinGecko ID mapping for crypto
const COINGECKO_IDS: Record<string, string> = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', BNB: 'binancecoin',
  XRP: 'ripple', DOGE: 'dogecoin', ADA: 'cardano', AVAX: 'avalanche-2',
  DOT: 'polkadot', LINK: 'chainlink',
};

/** Detect if a symbol is crypto */
function isCryptoSymbol(symbol: string): boolean {
  return symbol.toUpperCase() in COINGECKO_IDS;
}

async function fetchMarketPrice(symbol: string): Promise<number> {
  // Layer 1: Try Next.js market API for live price
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
  } catch {
    // fall through
  }

  // Layer 2: CoinGecko direct for crypto
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
    } catch {
      // fall through
    }
  }

  // Layer 3: Demo simulation
  return getDemoPrice(symbol);
}

// ============================================================
// Candle Data Fetching — for Technical Analysis
// ============================================================

// In-memory cache for candle data within a cycle
const candleCache = new Map<string, { candles: CandleData[]; ts: number }>();
const CANDLE_CACHE_TTL = 45_000; // 45 seconds — reuse within same cycle

async function fetchCandles(symbol: string, limit: number = 100): Promise<CandleData[]> {
  // Check cache first
  const cacheKey = `${symbol}_${limit}`;
  const cached = candleCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CANDLE_CACHE_TTL) {
    return cached.candles;
  }

  let candles: CandleData[] | null = null;

  // Layer 1: Try CoinGecko OHLC for crypto
  if (isCryptoSymbol(symbol)) {
    candles = await fetchCoinGeckoOHLC(symbol, limit);
  }

  // Layer 2: Try Next.js API (which proxies to various sources)
  if (!candles || candles.length < 10) {
    candles = await fetchNextJSCandles(symbol, limit);
  }

  // Layer 3: Generate demo candles
  if (!candles || candles.length < 10) {
    candles = generateDemoCandles(symbol, limit);
  }

  // Cache the result
  candleCache.set(cacheKey, { candles, ts: Date.now() });
  return candles;
}

/** Fetch real OHLC from CoinGecko */
async function fetchCoinGeckoOHLC(symbol: string, limit: number): Promise<CandleData[] | null> {
  const coinId = COINGECKO_IDS[symbol.toUpperCase()];
  if (!coinId) return null;

  try {
    // CoinGecko OHLC: days=30 gives ~720 hourly candles or ~30 daily candles
    const days = 30;
    const url = `https://api.coingecko.com/api/v3/coins/${coinId}/ohlc?vs_currency=usd&days=${days}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`CoinGecko OHLC HTTP ${res.status}`);

    const raw = (await res.json()) as number[][];
    if (!Array.isArray(raw) || raw.length === 0) return null;

    // CoinGecko OHLC format: [timestamp_ms, open, high, low, close]
    const candles: CandleData[] = raw.slice(-limit).map((c) => ({
      timestamp: c[0],
      open: c[1],
      high: c[2],
      low: c[3],
      close: c[4],
      volume: 0, // CoinGecko OHLC doesn't include volume
    }));

    console.log(`[AutoTrade] Fetched ${candles.length} real OHLC candles for ${symbol} from CoinGecko`);
    return candles;
  } catch (err) {
    console.warn(`[AutoTrade] CoinGecko OHLC failed for ${symbol}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/** Fetch candles from Next.js market API */
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

/** Generate realistic demo candles for backtesting / fallback */
function generateDemoCandles(symbol: string, limit: number): CandleData[] {
  const base = DEMO_BASE_PRICES[symbol] || 100;
  const now = Date.now();
  const candles: CandleData[] = [];

  // Use deterministic seed for consistent candles within a cycle
  let price = base;
  const volatility = base > 1000 ? 0.015 : base > 10 ? 0.02 : 0.03;

  // Seed from current minute so it changes slowly
  const minuteSeed = Math.floor(now / 60000);

  for (let i = 0; i < limit; i++) {
    // Pseudo-random walk with mean reversion
    const seed = Math.sin(minuteSeed + i * 1.618 + base * 0.01) * 10000;
    const rand = seed - Math.floor(seed); // 0-1
    const change = (rand - 0.49) * 2 * volatility; // slight upward bias

    const open = price;
    const close = price * (1 + change);
    const high = Math.max(open, close) * (1 + Math.abs(rand - 0.5) * volatility * 0.5);
    const low = Math.min(open, close) * (1 - Math.abs(rand - 0.5) * volatility * 0.5);

    candles.push({
      timestamp: now - (limit - i) * 86400000, // daily candles going back
      open: roundPrice(open),
      high: roundPrice(high),
      low: roundPrice(low),
      close: roundPrice(close),
      volume: Math.round(base * 1000 * (0.8 + rand * 0.4)),
    });

    price = close;
  }

  console.log(`[AutoTrade] Generated ${candles.length} demo candles for ${symbol} (base=${base})`);
  return candles;
}

/** Round price to reasonable precision */
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
    if (body) {
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    const data = await res.json();
    return { ok: res.ok, data };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ============================================================
// Main Execution Cycle
// ============================================================

async function runCycle() {
  const cycleStart = Date.now();
  console.log(`[AutoTrade] ═══ Cycle #${cycleCount + 1} starting at ${new Date().toISOString()} ═══`);

  try {
    let botConfigs: BotConfigRow[];

    if (dbAvailable && sql) {
      // Query all running bot configs with their trading accounts
      botConfigs = await sql`
        SELECT
          bc.id, bc."userId", bc."accountId", bc.enabled, bc."allocationAmount",
          bc."riskTolerance", bc."maxPositions", bc."maxPositionSize",
          bc."stopLossPercent", bc."takeProfitPercent", bc.strategy,
          bc.status, bc."adminLevyPercent", bc."adminLevyCollected",
          bc."grossPnl", bc."totalTrades", bc."winTrades", bc."totalPnl",
          bc."lastTradeAt", bc."lastError",
          ta.broker AS account_broker, ta."accountType" AS account_accountType,
          ta."apiKey" AS account_apiKey, ta."apiSecret" AS account_apiSecret,
          ta."passphrase" AS account_passphrase, ta.balance AS account_balance,
          ta.id AS account_id
        FROM "BotConfig" bc
        JOIN "TradingAccount" ta ON ta.id = bc."accountId"
        WHERE bc.status = 'running' AND bc.enabled = true
          AND ta."isActive" = true
      `;
    } else {
      console.log('[AutoTrade] DB unavailable — using demo bot configs');
      botConfigs = getDemoBotConfigs();
    }

    console.log(`[AutoTrade] Found ${botConfigs.length} active bot config(s)`);

    for (const config of botConfigs) {
      try {
        await processBot(config);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[AutoTrade] ✗ Error processing bot ${config.id}:`, errMsg);
        lastCycleError = errMsg;
        // Persist error to DB
        if (sql && dbAvailable) {
          try {
            await sql`UPDATE "BotConfig" SET "lastError" = ${errMsg}, "updatedAt" = NOW() WHERE id = ${config.id}`;
          } catch { /* non-critical */ }
        }
      }
    }

    lastCycleError = null;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[AutoTrade] ✗ Cycle failed:', errMsg);
    lastCycleError = errMsg;
  }

  cycleCount++;
  lastCycleTime = new Date().toISOString();
  const elapsed = Date.now() - cycleStart;
  console.log(`[AutoTrade] ═══ Cycle #${cycleCount} completed in ${elapsed}ms ═══\n`);
}

// ============================================================
// Process a Single Bot Config
// ============================================================

async function processBot(config: BotConfigRow) {
  const tag = `[AutoTrade] [${config.id.slice(0, 8)}]`;
  const strategy = config.strategy || 'balanced';
  const risk = config.riskTolerance || 'medium';
  console.log(`${tag} Processing bot (strategy: ${strategy}, risk: ${risk}, account: ${config.account_id})`);

  // ── Step 1: Get current positions from DB ──
  let positions: PositionRow[] = [];
  if (dbAvailable && sql) {
    positions = await sql`
      SELECT id, "accountId", symbol, side, qty, "avgEntryPrice", "currentPrice",
             "unrealizedPnl", "stopLoss", "takeProfit", status
      FROM "Position"
      WHERE "accountId" = ${config.account_id} AND status = 'open'
    `;
  } else {
    positions = getDemoPositions(config.account_id);
  }

  console.log(`${tag} ${positions.length} open position(s)`);

  // ── Step 2: Check SL/TP on open positions using live prices ──
  const closedSymbols: Set<string> = new Set();

  for (const pos of positions) {
    const currentPrice = await fetchMarketPrice(pos.symbol);
    const sl = pos.stopLoss;
    const tp = pos.takeProfit;
    let closeReason: string | null = null;

    // Stop Loss check
    if (sl !== null && sl > 0) {
      if (pos.side === 'long' && currentPrice <= sl) {
        closeReason = 'stop_loss';
      } else if (pos.side === 'short' && currentPrice >= sl) {
        closeReason = 'stop_loss';
      }
    }

    // Take Profit check
    if (!closeReason && tp !== null && tp > 0) {
      if (pos.side === 'long' && currentPrice >= tp) {
        closeReason = 'take_profit';
      } else if (pos.side === 'short' && currentPrice <= tp) {
        closeReason = 'take_profit';
      }
    }

    if (closeReason) {
      console.log(
        `${tag} ${closeReason.toUpperCase()} hit for ${pos.symbol}: price=${currentPrice.toFixed(2)} SL=${sl?.toFixed(2) ?? 'N/A'} TP=${tp?.toFixed(2) ?? 'N/A'}`
      );
      await closeAndRecord(config, pos, currentPrice, closeReason);
      closedSymbols.add(pos.symbol);
    } else {
      // Update current price in DB
      if (sql && dbAvailable) {
        const pnl =
          pos.side === 'long'
            ? (currentPrice - pos.avgEntryPrice) * pos.qty
            : (pos.avgEntryPrice - currentPrice) * pos.qty;
        try {
          await sql`
            UPDATE "Position" SET "currentPrice" = ${currentPrice}, "unrealizedPnl" = ${pnl}, "updatedAt" = NOW()
            WHERE id = ${pos.id}
          `;
        } catch { /* non-critical */ }
      }
    }
  }

  // ── Step 3: Open new position if room available ──
  const activePositionCount = positions.length - closedSymbols.size;
  const maxPos = config.maxPositions || 5;

  if (activePositionCount >= maxPos) {
    console.log(`${tag} Max positions reached (${activePositionCount}/${maxPos}) — skipping new entries`);
    return;
  }

  // Determine symbols to scan (exclude symbols with existing open positions)
  const openSymbols = new Set(
    positions
      .filter((p) => !closedSymbols.has(p.symbol))
      .map((p) => p.symbol),
  );
  const symbols = DEMO_SYMBOLS.filter((s) => !openSymbols.has(s));

  if (symbols.length === 0) {
    console.log(`${tag} No symbols available to scan`);
    return;
  }

  // ── Step 4: Run technical analysis on each symbol, pick best signal ──
  let bestSignal: TradeSignal | null = null;

  for (const symbol of symbols) {
    try {
      // Fetch candle data for analysis
      const candles = await fetchCandles(symbol, 100);
      if (candles.length < 10) {
        console.log(`${tag} [${symbol}] Not enough candles (${candles.length}) — skipping`);
        continue;
      }

      // Generate signal using the configured strategy
      const signal = generateSignal(candles, strategy, risk, symbol);
      if (!signal) continue;

      // Track best signal (highest confidence)
      if (!bestSignal || signal.confidence > bestSignal.confidence) {
        bestSignal = signal;
      }
    } catch (err) {
      console.warn(`${tag} [${symbol}] Analysis error:`, err instanceof Error ? err.message : err);
    }
  }

  if (!bestSignal) {
    console.log(`${tag} No actionable signal generated this cycle (scanned ${symbols.length} symbols with ${strategy} strategy)`);
    return;
  }

  // ── Step 5: Validate confidence threshold ──
  const minConfidence = risk === 'aggressive' ? 50 : risk === 'conservative' ? 70 : 60;
  if (bestSignal.confidence < minConfidence) {
    console.log(`${tag} Best signal confidence ${bestSignal.confidence}% below threshold ${minConfidence}% — skipping`);
    return;
  }

  // ── Step 6: Get live price for execution ──
  const livePrice = await fetchMarketPrice(bestSignal.symbol);
  if (livePrice <= 0) {
    console.log(`${tag} Invalid live price for ${bestSignal.symbol}: ${livePrice} — skipping`);
    return;
  }

  // ── Step 7: Risk-based position sizing ──
  const accountBalance = config.account_balance || 100000;
  const allocAmount = config.allocationAmount || 10000;
  const maxPosSize = config.maxPositionSize || allocAmount * 0.2;

  const qty = calculatePositionSize(
    accountBalance,
    risk,
    livePrice,
    bestSignal.stopLoss,
    maxPosSize,
    allocAmount,
  );

  if (qty <= 0) {
    console.log(`${tag} Calculated qty=0 for ${bestSignal.symbol} — skipping`);
    return;
  }

  // Update DCA tracker if this is a buy
  if (bestSignal.side === 'buy') {
    updateDCALastBuy(bestSignal.symbol, livePrice);
  }

  console.log(
    `${tag} Executing ${bestSignal.side.toUpperCase()} ${bestSignal.symbol} qty=${qty.toFixed(6)} @ ${livePrice.toFixed(2)} SL=${bestSignal.stopLoss.toFixed(2)} TP=${bestSignal.takeProfit.toFixed(2)} (confidence: ${bestSignal.confidence}% strategy: ${strategy})`
  );

  // ── Step 8: Execute via Next.js API ──
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
}

// ============================================================
// Close a Position and Record PnL
// ============================================================

async function closeAndRecord(
  config: BotConfigRow,
  pos: PositionRow,
  currentPrice: number,
  reason: string
) {
  // Calculate PnL
  const closedPnl =
    pos.side === 'long'
      ? (currentPrice - pos.avgEntryPrice) * pos.qty
      : (pos.avgEntryPrice - currentPrice) * pos.qty;

  // Apply admin levy on profitable trades
  let levyAmount = 0;
  let userPnl = closedPnl;
  if (closedPnl > 0) {
    try {
      const levyPercent = await getAdminLevy();
      levyAmount = closedPnl * (levyPercent / 100);
      userPnl = closedPnl - levyAmount;
    } catch {
      /* non-critical */
    }
  }

  const isWin = closedPnl > 0;

  // Try closing via Next.js API first
  try {
    const result = await callNextJSApi('DELETE', `/api/trading/positions/${pos.id}`);
    if (result.ok) {
      console.log(`  Closed via API: ${JSON.stringify(result.data)}`);
    } else {
      console.warn(`  API close failed: ${result.error} — updating DB directly`);
      await closePositionInDB(config, pos, userPnl, levyAmount, isWin);
    }
  } catch {
    // Fallback: update DB directly
    await closePositionInDB(config, pos, userPnl, levyAmount, isWin);
  }

  // Update bot stats
  if (sql && dbAvailable) {
    try {
      await sql`
        UPDATE "BotConfig" SET
          "totalTrades" = "totalTrades" + 1,
          "winTrades" = "winTrades" + ${isWin ? 1 : 0},
          "totalPnl" = "totalPnl" + ${userPnl},
          "adminLevyCollected" = "adminLevyCollected" + ${levyAmount},
          "lastTradeAt" = NOW(),
          "updatedAt" = NOW()
        WHERE id = ${config.id}
      `;
    } catch { /* non-critical */ }

    try {
      await sql`
        UPDATE "TradingAccount" SET
          "totalAdminLevyCollected" = COALESCE("totalAdminLevyCollected", 0) + ${levyAmount},
          "totalRealizedProfit" = COALESCE("totalRealizedProfit", 0) + ${userPnl},
          "lastSyncedAt" = NOW(),
          "updatedAt" = NOW()
        WHERE id = ${config.account_id}
      `;
    } catch { /* non-critical */ }
  }

  console.log(
    `  Closed ${pos.symbol}: rawPnl=${closedPnl.toFixed(2)} levy=${levyAmount.toFixed(2)} userPnl=${userPnl.toFixed(2)} (${reason})`
  );
}

async function closePositionInDB(
  config: BotConfigRow,
  pos: PositionRow,
  userPnl: number,
  levyAmount: number,
  isWin: boolean
) {
  if (!sql || !dbAvailable) return;
  try {
    await sql`
      UPDATE "Position" SET
        status = 'closed',
        "closedAt" = NOW(),
        "realizedPnl" = ${userPnl},
        "updatedAt" = NOW()
      WHERE id = ${pos.id} AND status = 'open'
    `;
  } catch { /* non-critical */ }
}

// ============================================================
// Execute a Trade (Open New Position)
// ============================================================

async function executeTrade(
  config: BotConfigRow,
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
  // Try placing order via Next.js API
  const orderBody = {
    symbol: trade.symbol,
    side: trade.side,
    type: 'market',
    qty: trade.qty,
    stopLoss: trade.stopLoss,
    takeProfit: trade.takeProfit,
    aiGenerated: true,
    accountId: config.account_id,
    reason: trade.reason,
  };

  const result = await callNextJSApi('POST', '/api/trading/orders', orderBody);

  if (result.ok && result.data) {
    const orderData = result.data as Record<string, unknown>;
    console.log(`  Order placed via API: id=${orderData.id} status=${orderData.status}`);

    // Update bot stats
    if (sql && dbAvailable) {
      try {
        await sql`
          UPDATE "BotConfig" SET
            "totalTrades" = "totalTrades" + 1,
            "lastTradeAt" = NOW(),
            "updatedAt" = NOW()
          WHERE id = ${config.id}
        `;
      } catch { /* non-critical */ }
    }
  } else {
    console.warn(`  Order failed via API: ${result.error} — recording directly in DB`);

    // Fallback: record the order and position directly in DB
    if (sql && dbAvailable) {
      try {
        const orderId = `engine_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        await sql`
          INSERT INTO "Order" (id, "accountId", symbol, "assetType", side, type, qty, "filledQty", "filledPrice", status, "aiGenerated", reason, "createdAt", "updatedAt")
          VALUES (${orderId}, ${config.account_id}, ${trade.symbol}, 'stock', ${trade.side}, 'market', ${trade.qty}, ${trade.qty}, ${trade.price}, 'filled', true, ${trade.reason}, NOW(), NOW())
        `;

        const positionId = `${config.account_id}_${trade.symbol}`;
        await sql`
          INSERT INTO "Position" (id, "accountId", symbol, "assetType", side, qty, "avgEntryPrice", "currentPrice", "stopLoss", "takeProfit", status, "openedAt", "updatedAt")
          VALUES (${positionId}, ${config.account_id}, ${trade.symbol}, 'stock', ${trade.side === 'buy' ? 'long' : 'short'}, ${trade.qty}, ${trade.price}, ${trade.price}, ${trade.stopLoss}, ${trade.takeProfit}, 'open', NOW(), NOW())
          ON CONFLICT (id) DO UPDATE SET
            qty = "Position".qty + ${trade.qty},
            "avgEntryPrice" = ${trade.price},
            "currentPrice" = ${trade.price},
            "stopLoss" = ${trade.stopLoss},
            "takeProfit" = ${trade.takeProfit},
            "updatedAt" = NOW()
        `;

        await sql`
          UPDATE "BotConfig" SET
            "totalTrades" = "totalTrades" + 1,
            "lastTradeAt" = NOW(),
            "updatedAt" = NOW()
          WHERE id = ${config.id}
        `;

        console.log(`  Order recorded directly in DB: orderId=${orderId}`);
      } catch (dbErr) {
        console.error(`  Failed to record order in DB:`, dbErr);
        // Record error on bot config
        const errMsg = dbErr instanceof Error ? dbErr.message : String(dbErr);
        try {
          await sql`UPDATE "BotConfig" SET "lastError" = ${errMsg}, "updatedAt" = NOW() WHERE id = ${config.id}`;
        } catch { /* non-critical */ }
      }
    } else {
      console.log(`  DB unavailable — trade ${trade.symbol} simulated in demo mode (no persistence)`);
    }
  }
}

// ============================================================
// Start the Engine
// ============================================================

initDatabase();

// Run first cycle immediately on startup
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
  console.log('[AutoTrade] SIGTERM received — shutting down');
  if (sql) sql.end();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[AutoTrade] SIGINT received — shutting down');
  if (sql) sql.end();
  process.exit(0);
});

console.log(`[AutoTrade] Poll interval: ${POLL_INTERVAL_MS / 1000}s`);
console.log(`[AutoTrade] Next.js API target: ${NEXTJS_API}`);
console.log(`[AutoTrade] Strategies: momentum | balanced | conservative | dca | grid`);
console.log(`[AutoTrade] Ready — waiting for first cycle...`);
