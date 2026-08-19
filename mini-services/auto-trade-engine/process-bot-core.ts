// ============================================================
// process-bot-core.ts — Startup-free processBot extraction
// CR4.3A R8: Complete processBot logic with eligibility gate
//   as the FIRST operation.
//
//   ZERO side effects before eligibility check.
//   Importable without Bun.serve, no global state, no top-level I/O.
// ============================================================

import { type CandleData, type TradeSignal } from './strategies';

// ============================================================
// Types
// ============================================================

export interface BotRow {
  id: string;
  userId?: string;
  accountId: string;
  name: string;
  strategy: string;
  symbols?: string;
  timeframe?: string;
  allocationAmount?: number;
  enabled?: boolean;
  status?: string;
  riskPerTrade?: string;
  maxPositions?: number;
  stopLossPercent?: number;
  takeProfitPercent?: number;
  totalTrades?: number;
  winTrades?: number;
  totalPnl?: number;
  account: {
    id: string;
    broker: string;
    accountType: string;
    isDemo: boolean | null;
    balance?: number;
    isActive?: boolean;
    apiKey?: string | null;
    apiSecret?: string | null;
    passphrase?: string | null;
  } | null;
}

export interface ProcessBotDeps {
  fetchMarketPrice: (symbol: string, deps: { nextjsApi: string; fetchFn?: typeof fetch }) => Promise<{ price: number; isDemoData: boolean; environment: 'live' | 'demo' | 'unknown'; source: string; observedAt: string }>;
  fetchCandles: (symbol: string, limit: number, deps: { nextjsApi: string; fetchFn?: typeof fetch }) => Promise<{ candles: CandleData[]; provenance: { environment: 'live' | 'demo' | 'unknown'; isSynthetic: boolean; source: string; observedAt: string } }>;
  validateEngineProvenance: (prov: { environment: string; isSynthetic: boolean; source: string; observedAt?: string }) => { valid: boolean; reason?: string };
  generateSignal: (candles: CandleData[], strategy: string, risk: string, symbol: string) => TradeSignal | null;
  calculatePositionSize: (balance: number, risk: string, price: number, stopLoss: number, maxSize: number, allocAmount: number) => number;
  updateDCALastBuy: (symbol: string, price: number) => void;
  marketPriceDeps: { nextjsApi: string; fetchFn?: typeof fetch };
  candleDeps: { nextjsApi: string; fetchFn?: typeof fetch };
  positions: Map<string, {
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
  }>;
  addActivity: (entry: Record<string, unknown>) => void;
  callNextJSApi: (method: string, path: string, body?: Record<string, unknown>) => Promise<{ ok: boolean; data?: unknown; error?: string }>;
  executeTrade: (config: BotRow, trade: { symbol: string; side: 'buy' | 'sell'; qty: number; price: number; stopLoss: number; takeProfit: number; confidence: number; reason: string }) => Promise<void>;
  automatedTradingEnabled: boolean;
  allSymbols: string[];
  evaluateEngineAccountEligibility: (account: {
    broker: string;
    accountType: string;
    isDemo: boolean | null | undefined;
    isActive: boolean | null | undefined;
    apiKey: string | null | undefined;
    apiSecret: string | null | undefined;
    passphrase: string | null | undefined;
  } | null) => { eligible: boolean; reason?: string };
}

// ============================================================
// processBotCore — Full processBot logic with eligibility gate
// ============================================================

export async function processBotCore(
  config: BotRow,
  deps: ProcessBotDeps,
): Promise<{ processed: boolean; reason?: string }> {
  // ============================================================
  // CRITICAL: Eligibility check MUST be the FIRST thing.
  // ZERO side effects before this check passes.
  // ============================================================
  const eligibility = deps.evaluateEngineAccountEligibility(
    config.account ? {
      broker: config.account.broker,
      accountType: config.account.accountType,
      isDemo: config.account.isDemo,
      isActive: config.account.isActive,
      apiKey: config.account.apiKey,
      apiSecret: config.account.apiSecret,
      passphrase: config.account.passphrase,
    } : null,
  );
  if (!eligibility.eligible) {
    return { processed: false, reason: 'ineligible-account' };
  }

  const tag = `[AutoTrade] [${config.id.slice(0, 8)}]`;
  const strategyMap: Record<string, string> = { signal_based: 'balanced', scalping: 'momentum' };
  const strategy = strategyMap[config.strategy] || config.strategy || 'balanced';
  const risk = 'medium';
  const accountBalance = config.account?.balance ?? 100000;
  const maxPos = config.maxPositions || 5;

  console.log(`${tag} Processing "${config.name}" (strategy: ${strategy}, account: ${config.accountId})`);

  // Step 1: Check SL/TP on in-memory positions
  const botPositions = Array.from(deps.positions.values()).filter(
    p => p.botId === config.id && p.accountId === config.accountId,
  );
  const closedSymbols: Set<string> = new Set();

  for (const pos of botPositions) {
    const priceResult = await deps.fetchMarketPrice(pos.symbol, deps.marketPriceDeps);
    pos.currentPrice = priceResult.price;
    pos.unrealizedPnl = pos.side === 'long'
      ? (priceResult.price - pos.avgEntryPrice) * pos.qty
      : (pos.avgEntryPrice - priceResult.price) * pos.qty;

    const sl = pos.stopLoss; const tp = pos.takeProfit;
    let closeReason: string | null = null;

    if (sl !== null && sl > 0) {
      if (pos.side === 'long' && priceResult.price <= sl) closeReason = 'stop_loss';
      else if (pos.side === 'short' && priceResult.price >= sl) closeReason = 'stop_loss';
    }
    if (!closeReason && tp !== null && tp > 0) {
      if (pos.side === 'long' && priceResult.price >= tp) closeReason = 'take_profit';
      else if (pos.side === 'short' && priceResult.price <= tp) closeReason = 'take_profit';
    }

    if (closeReason) {
      const pnl = pos.unrealizedPnl;
      console.log(`${tag} ${closeReason.toUpperCase()} hit for ${pos.symbol}: price=${priceResult.price.toFixed(2)} PnL=${pnl.toFixed(2)}`);
      deps.positions.delete(pos.id);
      closedSymbols.add(pos.symbol);
      deps.callNextJSApi('POST', '/api/trading/engine/report', {
        botId: config.id, tradeType: 'closed', pnl, isWin: pnl > 0,
        reason: closeReason, symbol: pos.symbol, side: pos.side, price: priceResult.price,
      });
      deps.addActivity({
        type: closeReason === 'stop_loss' ? 'sl_hit' : 'tp_hit',
        botId: config.id, botName: config.name, symbol: pos.symbol,
        side: pos.side === 'long' ? 'sell' : 'buy', price: priceResult.price, pnl,
      });
    }
  }

  // Step 2: Open new position if room
  const activePositionCount = botPositions.length - closedSymbols.size;
  if (activePositionCount >= maxPos) {
    console.log(`${tag} Max positions reached (${activePositionCount}/${maxPos})`);
    return { processed: true };
  }

  const botSymbols = config.symbols
    ? config.symbols.split(',').map(s => s.trim()).filter(Boolean)
    : deps.allSymbols;
  const openSymbols = new Set(
    botPositions.filter(p => !closedSymbols.has(p.symbol)).map(p => p.symbol),
  );
  const symbols = botSymbols.filter(s => !openSymbols.has(s));

  if (symbols.length === 0) {
    console.log(`${tag} No symbols available to scan`);
    return { processed: true };
  }

  // Step 3: Run technical analysis
  let bestSignal: TradeSignal | null = null;
  for (const symbol of symbols) {
    try {
      const { candles, provenance: candleProvenance } = await deps.fetchCandles(symbol, 100, deps.candleDeps);
      if (candles.length < 10) {
        console.log(`${tag} [${symbol}] Not enough candles (${candles.length}) — skipping`);
        continue;
      }
      const candleValidation = deps.validateEngineProvenance(candleProvenance);
      if (!candleValidation.valid) {
        console.log(`${tag} [${symbol}] Skipping: candle provenance invalid: ${candleValidation.reason}`);
        deps.addActivity({
          type: 'error', botId: config.id, botName: config.name, symbol,
          error: `Candle provenance invalid: ${candleValidation.reason}`,
        });
        continue;
      }
      // After eligibility passes, we know this is a demo bot, so demo candles are fine
      const signal = deps.generateSignal(candles, strategy, risk, symbol);
      if (!signal) continue;
      if (!bestSignal || signal.confidence > bestSignal.confidence) bestSignal = signal;
    } catch (err) {
      console.warn(`${tag} [${symbol}] Analysis error:`, err instanceof Error ? err.message : err);
    }
  }

  if (!bestSignal) {
    console.log(`${tag} No actionable signal (scanned ${symbols.length} symbols)`);
    return { processed: true };
  }

  // Step 4: Validate confidence
  const minConfidence = 50;
  if (bestSignal.confidence < minConfidence) {
    console.log(`${tag} Signal confidence ${bestSignal.confidence}% below ${minConfidence}% — skipping`);
    return { processed: true };
  }

  // Step 5: Fetch live price with provenance
  const priceResult = await deps.fetchMarketPrice(bestSignal.symbol, deps.marketPriceDeps);

  const livePrice = priceResult.price;
  if (livePrice <= 0) {
    console.log(`${tag} Invalid price for ${bestSignal.symbol}: ${livePrice}`);
    return { processed: true };
  }

  const allocAmount = config.allocationAmount || 10000;
  const maxPosSize = allocAmount * 0.2;
  const qty = deps.calculatePositionSize(accountBalance, risk, livePrice, bestSignal.stopLoss, maxPosSize, allocAmount);

  if (qty <= 0) {
    console.log(`${tag} Calculated qty=0 for ${bestSignal.symbol}`);
    return { processed: true };
  }

  if (bestSignal.side === 'buy') deps.updateDCALastBuy(bestSignal.symbol, livePrice);

  console.log(
    `${tag} Executing ${bestSignal.side.toUpperCase()} ${bestSignal.symbol} qty=${qty.toFixed(6)} ` +
    `@ ${livePrice.toFixed(2)} SL=${bestSignal.stopLoss.toFixed(2)} TP=${bestSignal.takeProfit.toFixed(2)} ` +
    `(confidence: ${bestSignal.confidence}%, isDemoData: ${priceResult.isDemoData})`,
  );

  if (!deps.automatedTradingEnabled) {
    console.log(`${tag} AUTOMATED_TRADING_ENABLED=false — not executing trade`);
    return { processed: true };
  }

  await deps.executeTrade(config, {
    symbol: bestSignal.symbol, side: bestSignal.side, qty, price: livePrice,
    stopLoss: bestSignal.stopLoss, takeProfit: bestSignal.takeProfit,
    confidence: bestSignal.confidence, reason: bestSignal.reason,
  });

  deps.addActivity({
    type: 'signal_generated', botId: config.id, botName: config.name,
    symbol: bestSignal.symbol, side: bestSignal.side,
    confidence: bestSignal.confidence, reason: bestSignal.reason,
  });

  return { processed: true };
}
