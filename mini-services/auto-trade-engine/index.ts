// ============================================================
// Fovi Auto-Trade Engine — Thin Startup Entry Point
// Phase 2H:
//   - Next.js internal APIs are the single control/persistence plane.
//   - No direct database reads/writes from the mini-service.
//   - Every enabled cycle hydrates authoritative persisted open positions.
//   - process-bot-core owns eligibility + strategy + risk decisions.
//   - Opens and closes go only to deterministic audited paper adapters.
//   - Persisted API responses are the only accepted execution truth.
//   - Execution cycles are single-flight and internal retries are bounded.
// ============================================================

import { createHash, timingSafeEqual as nodeTimingSafeEqual } from 'node:crypto';
import { updateDCALastBuy } from './strategies';
import {
  fetchMarketPrice,
  fetchCandles,
  ALL_SYMBOLS,
  type FetchMarketPriceDeps,
  type FetchCandlesDeps,
} from './engine-core';
import { validateEngineProvenance } from './market-provenance';
import {
  processBotCore,
  type BotRow as ProcessBotRow,
  type EnginePosition,
  type ProcessBotDeps,
} from './process-bot-core';
import {
  createEngineCycleCoordinator,
  INTERNAL_API_MAX_ATTEMPTS,
  retryDelayMsAfterAttempt,
  shouldRetryInternalApi,
} from './engine-reliability';
import { evaluateEngineAccountEligibility } from '../../src/lib/engine-eligibility';
import { buildPaperExecutionIntent } from '../../src/lib/trading-intelligence/execution-contract';
import { buildPaperCloseIntent } from '../../src/lib/trading-intelligence/position-reconciliation';
import { STRATEGY_ENGINE_VERSION } from '../../src/lib/trading-intelligence/strategy-engine';

const PORT = 3012;
const POLL_INTERVAL_MS = 60_000;
const NEXTJS_API = 'http://localhost:3002';
const INTERNAL_API_TIMEOUT_MS = 30_000;

function envBool(name: string): boolean {
  const raw = process.env[name];
  if (!raw) return false;
  const lower = raw.trim().toLowerCase();
  return lower === 'true' || lower === '1' || lower === 'yes';
}

const AUTOMATED_TRADING_ENABLED = envBool('AUTOMATED_TRADING_ENABLED');
const INTERNAL_SERVICE_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';
const marketPriceDeps: FetchMarketPriceDeps = { nextjsApi: NEXTJS_API };
const candleDeps: FetchCandlesDeps = { nextjsApi: NEXTJS_API };

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

interface ActivityEntry {
  id: string;
  timestamp: string;
  type: string;
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
  [key: string]: unknown;
}

type ActivityInput = Pick<ActivityEntry, 'type' | 'botId' | 'botName' | 'symbol'> & Record<string, unknown>;

const positions = new Map<string, EnginePosition>();
const activityLog: ActivityEntry[] = [];
const MAX_ACTIVITY = 200;
const cycleCoordinator = createEngineCycleCoordinator();

function addActivity(entry: ActivityInput) {
  activityLog.unshift({
    ...entry,
    id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
  });
  if (activityLog.length > MAX_ACTIVITY) activityLog.length = MAX_ACTIVITY;
}

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
  if (!INTERNAL_SERVICE_SECRET) return { valid: false, status: 503 };
  const provided = req.headers.get('x-internal-service-secret') || '';
  if (constantTimeEqual(provided, INTERNAL_SERVICE_SECRET)) return { valid: true, status: 200 };
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

const engineStartTime = Date.now();
let cycleCount = 0;
let lastCycleTime: string | null = null;
let lastCycleError: string | null = null;
let lastActiveBotCount = 0;

Bun.serve({
  port: PORT,
  hostname: '127.0.0.1',
  fetch(req) {
    const url = new URL(req.url);
    const reliability = cycleCoordinator.snapshot(AUTOMATED_TRADING_ENABLED);

    if (url.pathname === '/health' || url.pathname === '/') {
      return Response.json({
        status: reliability.readiness === 'degraded' ? 'degraded' : 'ok',
        service: 'fovi-auto-trade-engine',
        port: PORT,
        uptime: Math.floor((Date.now() - engineStartTime) / 1000),
        cycleCount,
        lastCycleTime,
        lastCycleError,
        pollIntervalMs: POLL_INTERVAL_MS,
        automatedTradingEnabled: AUTOMATED_TRADING_ENABLED,
        controlPlane: 'nextjs-internal-api',
        positionTruth: 'persisted-db-hydration',
        readiness: reliability.readiness,
        cycleInProgress: reliability.cycleInProgress,
        consecutiveCycleFailures: reliability.consecutiveCycleFailures,
        lastSuccessfulCycleTime: reliability.lastSuccessfulCycleTime,
        lastFailedCycleTime: reliability.lastFailedCycleTime,
        lastFailureReason: reliability.lastFailureReason,
      });
    }

    if (url.pathname === '/status') {
      const auth = checkInternalAuth(req);
      if (!auth.valid) return authErrorResponse(auth.status);
      return Response.json({
        cycleCount,
        lastCycleTime,
        lastCycleError,
        engineUptimeS: Math.floor((Date.now() - engineStartTime) / 1000),
        managedPositions: positions.size,
        activeBots: lastActiveBotCount,
        automatedTradingEnabled: AUTOMATED_TRADING_ENABLED,
        controlPlane: 'nextjs-internal-api',
        positionTruth: 'persisted-db-hydration',
        ...reliability,
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
      if (cycleCoordinator.isCycleInProgress()) {
        return Response.json(
          { triggered: false, code: 'ENGINE_CYCLE_ALREADY_RUNNING' },
          { status: 409 },
        );
      }
      void runCycle();
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
console.log('[AutoTrade] Control plane: Next.js internal API only');
console.log('[AutoTrade] Reliability: single-flight cycles + bounded deterministic internal retries');
console.log(`[AutoTrade] Endpoints: GET /health, GET /status, POST /cycle, GET /activity, GET /positions`);
console.log(`[AutoTrade] Next.js API target: ${NEXTJS_API}`);

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function callNextJSApi(
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const url = `${NEXTJS_API}${path}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (INTERNAL_SERVICE_SECRET) headers['X-Internal-Service-Secret'] = INTERNAL_SERVICE_SECRET;

  for (let attempt = 1; attempt <= INTERNAL_API_MAX_ATTEMPTS; attempt++) {
    try {
      const opts: RequestInit = {
        method,
        headers,
        signal: AbortSignal.timeout(INTERNAL_API_TIMEOUT_MS),
      };
      if (body) opts.body = JSON.stringify(body);

      const res = await fetch(url, opts);
      const text = await res.text();
      let data: unknown;
      try { data = JSON.parse(text); } catch { data = text; }

      if (res.ok) return { ok: true, data };

      let error: string;
      if (data && typeof data === 'object' && 'error' in data && typeof (data as { error?: unknown }).error === 'string') {
        error = (data as { error: string }).error;
      } else {
        error = `HTTP ${res.status}`;
      }

      if (!shouldRetryInternalApi({ method, path, attempt, status: res.status })) {
        return { ok: false, data, error };
      }

      const delayMs = retryDelayMsAfterAttempt(attempt);
      console.warn(`[AutoTrade] Internal API retry ${attempt + 1}/${INTERNAL_API_MAX_ATTEMPTS}: ${method} ${path} after HTTP ${res.status}`);
      await sleep(delayMs);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      if (!shouldRetryInternalApi({ method, path, attempt, transportError: true })) {
        return { ok: false, error };
      }

      const delayMs = retryDelayMsAfterAttempt(attempt);
      console.warn(`[AutoTrade] Internal API retry ${attempt + 1}/${INTERNAL_API_MAX_ATTEMPTS}: ${method} ${path} after transport failure`);
      await sleep(delayMs);
    }
  }

  return { ok: false, error: 'Internal API retry budget exhausted.' };
}

function parseHydratedPosition(value: unknown): EnginePosition | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === 'string' ? raw.id : '';
  const botId = typeof raw.botId === 'string' ? raw.botId : '';
  const accountId = typeof raw.accountId === 'string' ? raw.accountId : '';
  const symbol = typeof raw.symbol === 'string' ? raw.symbol.trim().toUpperCase() : '';
  const side = raw.side === 'long' ? 'long' : raw.side === 'short' ? 'short' : null;
  const qty = Number(raw.qty);
  const avgEntryPrice = Number(raw.avgEntryPrice);
  const currentPrice = Number(raw.currentPrice);
  const unrealizedPnl = Number(raw.unrealizedPnl ?? 0);
  const openedAt = Date.parse(String(raw.openedAt || ''));
  const stopLoss = raw.stopLoss === null || raw.stopLoss === undefined ? null : Number(raw.stopLoss);
  const takeProfit = raw.takeProfit === null || raw.takeProfit === undefined ? null : Number(raw.takeProfit);

  if (
    raw.executionEnvironment !== 'paper' ||
    !id.startsWith('ppos_') || !botId || !accountId || !symbol || !side ||
    !Number.isFinite(qty) || qty <= 0 ||
    !Number.isFinite(avgEntryPrice) || avgEntryPrice <= 0 ||
    !Number.isFinite(currentPrice) || currentPrice <= 0 ||
    !Number.isFinite(unrealizedPnl) ||
    !Number.isFinite(openedAt) ||
    (stopLoss !== null && (!Number.isFinite(stopLoss) || stopLoss <= 0)) ||
    (takeProfit !== null && (!Number.isFinite(takeProfit) || takeProfit <= 0))
  ) {
    return null;
  }

  return {
    id,
    botId,
    accountId,
    symbol,
    side,
    qty,
    avgEntryPrice,
    currentPrice,
    stopLoss,
    takeProfit,
    openedAt,
    unrealizedPnl,
  };
}

async function hydrateAuthoritativePositions(): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const result = await callNextJSApi('GET', '/api/trading/engine/positions');
  if (!result.ok || !Array.isArray(result.data)) {
    return { ok: false, error: result.error || 'Authoritative position feed returned no position array.' };
  }

  const nextPositions = new Map<string, EnginePosition>();
  const exposureKeys = new Set<string>();
  for (const value of result.data) {
    const position = parseHydratedPosition(value);
    if (!position) {
      return { ok: false, error: 'Authoritative position feed contained an invalid paper position.' };
    }
    if (nextPositions.has(position.id)) {
      return { ok: false, error: `Duplicate persisted paper position ID: ${position.id}` };
    }
    const exposureKey = `${position.botId}|${position.accountId}|${position.symbol}`;
    if (exposureKeys.has(exposureKey)) {
      return { ok: false, error: `Duplicate persisted paper exposure: ${exposureKey}` };
    }
    exposureKeys.add(exposureKey);
    nextPositions.set(position.id, position);
  }

  positions.clear();
  for (const [id, position] of nextPositions) positions.set(id, position);
  return { ok: true, count: positions.size };
}

async function runCycle(): Promise<boolean> {
  if (!cycleCoordinator.tryStartCycle()) {
    console.warn('[AutoTrade] Cycle skipped because another cycle is still in progress.');
    addActivity({
      type: 'cycle_overlap_blocked',
      botId: 'system',
      botName: 'System',
      symbol: '—',
      reason: 'ENGINE_CYCLE_ALREADY_RUNNING',
    });
    return false;
  }

  const cycleStart = Date.now();
  let cycleFailure: string | null = null;
  console.log(`[AutoTrade] ═══ Cycle #${cycleCount + 1} starting at ${new Date().toISOString()} ═══`);

  try {
    if (!AUTOMATED_TRADING_ENABLED) {
      console.log('[AutoTrade] AUTOMATED_TRADING_ENABLED=false — skipping cycle');
      lastActiveBotCount = 0;
      return true;
    }

    const hydration = await hydrateAuthoritativePositions();
    if (!hydration.ok) {
      throw new Error(`Position hydration failed: ${hydration.error}`);
    }
    console.log(`[AutoTrade] Hydrated ${hydration.count} persisted paper position(s)`);

    const result = await callNextJSApi('GET', '/api/trading/engine/bots');
    if (!result.ok || !Array.isArray(result.data)) {
      throw new Error(result.error || 'Failed to fetch bots from API');
    }

    const botConfigs = result.data as BotRow[];
    lastActiveBotCount = botConfigs.length;
    console.log(`[AutoTrade] Found ${botConfigs.length} active bot(s)`);

    for (const config of botConfigs) {
      addActivity({ type: 'cycle_start', botId: config.id, botName: config.name, symbol: '—' });
      try {
        await processBot(config);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (!cycleFailure) cycleFailure = `Bot ${config.id}: ${errMsg}`;
        console.error(`[AutoTrade] ✗ Error processing bot ${config.id}:`, errMsg);
        addActivity({ type: 'error', botId: config.id, botName: config.name, symbol: '—', error: errMsg });
        void callNextJSApi('POST', '/api/trading/engine/report', {
          botId: config.id,
          tradeType: 'error',
          reason: errMsg,
        });
      } finally {
        addActivity({ type: 'cycle_end', botId: config.id, botName: config.name, symbol: '—' });
      }
    }

    return true;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    cycleFailure = errMsg;
    console.error('[AutoTrade] ✗ Cycle failed:', errMsg);
    lastActiveBotCount = 0;
    addActivity({ type: 'error', botId: 'system', botName: 'System', symbol: '—', error: errMsg });
    return true;
  } finally {
    cycleCount++;
    lastCycleTime = new Date().toISOString();
    lastCycleError = cycleFailure;
    if (cycleFailure) cycleCoordinator.completeCycleFailure(cycleFailure);
    else cycleCoordinator.completeCycleSuccess();

    const elapsed = Date.now() - cycleStart;
    console.log(`[AutoTrade] ═══ Cycle #${cycleCount} completed in ${elapsed}ms state=${cycleCoordinator.snapshot(AUTOMATED_TRADING_ENABLED).readiness} ═══\n`);
  }
}

async function processBot(config: BotRow) {
  await processBotCore(config as ProcessBotRow, {
    fetchMarketPrice,
    fetchCandles,
    validateEngineProvenance: validateEngineProvenance as ProcessBotDeps['validateEngineProvenance'],
    updateDCALastBuy,
    marketPriceDeps,
    candleDeps,
    positions,
    addActivity: (entry) => addActivity(entry as ActivityInput),
    callNextJSApi,
    executeTrade,
    closePosition,
    automatedTradingEnabled: AUTOMATED_TRADING_ENABLED,
    allSymbols: ALL_SYMBOLS,
    evaluateEngineAccountEligibility,
  });
}

async function executeTrade(
  config: ProcessBotRow,
  trade: Parameters<ProcessBotDeps['executeTrade']>[1],
) {
  if (!config.userId) throw new Error('Paper execution requires a verified bot userId.');

  const source = trade.marketData.source.toLowerCase();
  const assetType = source.includes('coingecko') ? 'crypto' : 'unknown';
  const intent = buildPaperExecutionIntent({
    userId: config.userId,
    botId: config.id,
    accountId: config.accountId,
    symbol: trade.symbol,
    assetType,
    side: trade.side,
    quantity: trade.qty,
    referencePrice: trade.price,
    stopLoss: trade.stopLoss,
    takeProfit: trade.takeProfit,
    confidence: trade.confidence,
    strategy: config.strategy,
    timeframe: config.timeframe || '',
    strategyVersion: trade.strategyVersion || STRATEGY_ENGINE_VERSION,
    riskEngineVersion: trade.riskEngineVersion,
    positionNotional: trade.positionNotional,
    riskAmount: trade.riskAmount,
    riskPercentOfAllocation: trade.riskPercentOfAllocation,
    riskReward: trade.riskReward,
    reason: trade.reason,
    marketData: trade.marketData,
  });

  const result = await callNextJSApi(
    'POST',
    '/api/trading/engine/execute',
    intent as unknown as Record<string, unknown>,
  );
  if (!result.ok || !result.data || typeof result.data !== 'object') {
    const message = result.error || 'Paper execution adapter returned no result.';
    addActivity({
      type: 'error',
      botId: config.id,
      botName: config.name,
      symbol: trade.symbol,
      side: trade.side,
      error: `Paper execution failed: ${message}`,
    });
    throw new Error(message);
  }

  const payload = result.data as {
    idempotent?: boolean;
    order?: Record<string, unknown>;
    position?: Record<string, unknown> | null;
  };
  const orderData = payload.order;
  const positionData = payload.position;
  if (!orderData || !positionData) {
    throw new Error('Paper execution adapter did not return persisted order and position truth.');
  }

  const hydrated = parseHydratedPosition({ ...positionData, executionEnvironment: 'paper' });
  if (!hydrated || hydrated.botId !== config.id || hydrated.accountId !== config.accountId) {
    throw new Error('Paper execution adapter returned an invalid persisted position.');
  }
  positions.set(hydrated.id, hydrated);

  const orderId = String(orderData.id || intent.executionIntentId);
  const fillPrice = Number(orderData.filledPrice ?? hydrated.avgEntryPrice);
  console.log(`  Paper order reconciled: id=${orderId} idempotent=${payload.idempotent === true}`);

  if (payload.idempotent !== true) {
    void callNextJSApi('POST', '/api/trading/engine/report', {
      botId: config.id,
      tradeType: 'opened',
      symbol: trade.symbol,
      side: trade.side,
      qty: hydrated.qty,
      price: Number.isFinite(fillPrice) && fillPrice > 0 ? fillPrice : hydrated.avgEntryPrice,
      executionIntentId: intent.executionIntentId,
      executionEnvironment: 'paper',
    });
    addActivity({
      type: 'trade_opened',
      botId: config.id,
      botName: config.name,
      symbol: trade.symbol,
      side: trade.side,
      qty: hydrated.qty,
      price: Number.isFinite(fillPrice) && fillPrice > 0 ? fillPrice : hydrated.avgEntryPrice,
    });
  }
}

async function closePosition(
  config: ProcessBotRow,
  position: EnginePosition,
  close: Parameters<ProcessBotDeps['closePosition']>[2],
) {
  if (!config.userId) throw new Error('Paper close requires a verified bot userId.');

  const intent = buildPaperCloseIntent({
    userId: config.userId,
    botId: config.id,
    accountId: config.accountId,
    positionId: position.id,
    symbol: position.symbol,
    side: position.side,
    quantity: position.qty,
    referencePrice: close.price,
    reason: close.reason,
    marketData: close.marketData,
  });

  const result = await callNextJSApi(
    'POST',
    '/api/trading/engine/close',
    intent as unknown as Record<string, unknown>,
  );
  if (!result.ok || !result.data || typeof result.data !== 'object') {
    throw new Error(result.error || 'Paper close adapter returned no result.');
  }

  const payload = result.data as {
    idempotent?: boolean;
    order?: Record<string, unknown>;
    position?: Record<string, unknown> | null;
  };
  const orderData = payload.order;
  const positionData = payload.position;
  if (!orderData || !positionData) {
    throw new Error('Paper close adapter did not return persisted close order and position truth.');
  }
  if (
    String(positionData.id || '') !== position.id ||
    String(positionData.status || '') !== 'closed' ||
    String(positionData.botId || '') !== config.id ||
    String(positionData.accountId || '') !== config.accountId
  ) {
    throw new Error('Paper close adapter returned invalid persisted closed-position truth.');
  }

  console.log(
    `  Paper close reconciled: position=${position.id} order=${String(orderData.id || '')} idempotent=${payload.idempotent === true}`,
  );
}

void runCycle();

setInterval(() => {
  void runCycle();
}, POLL_INTERVAL_MS);

process.on('SIGTERM', () => {
  console.log('[AutoTrade] SIGTERM — shutting down');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[AutoTrade] SIGINT — shutting down');
  process.exit(0);
});

console.log(`[AutoTrade] Poll interval: ${POLL_INTERVAL_MS / 1000}s`);
console.log('[AutoTrade] Strategies: momentum | balanced | conservative | dca | grid');
console.log('[AutoTrade] Ready — waiting for first cycle...');
