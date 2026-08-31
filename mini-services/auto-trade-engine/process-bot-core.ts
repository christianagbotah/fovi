// ============================================================
// process-bot-core.ts — Startup-free processBot extraction
// Phase 2B: eligibility first + verified market data fail-closed.
// ============================================================

import { type CandleData, type TradeSignal } from './strategies';

export interface BotRow {
  id: string; userId?: string; accountId: string; name: string; strategy: string;
  symbols?: string; timeframe?: string; allocationAmount?: number; enabled?: boolean;
  status?: string; riskPerTrade?: string; maxPositions?: number; stopLossPercent?: number;
  takeProfitPercent?: number; totalTrades?: number; winTrades?: number; totalPnl?: number;
  account: {
    id: string; broker: string; accountType: string; isDemo: boolean | null; balance?: number;
    isActive?: boolean; apiKey?: string | null; apiSecret?: string | null; passphrase?: string | null;
  } | null;
}

interface PriceResult {
  price: number; isDemoData: boolean; environment: 'live' | 'demo' | 'unknown';
  source: string; observedAt: string; dataUnavailable?: boolean; reason?: string;
}
interface CandlesResult {
  candles: CandleData[];
  provenance: { environment: 'live' | 'demo' | 'unknown'; isSynthetic: boolean; source: string; observedAt: string };
  dataUnavailable?: boolean; reason?: string; volumeAvailable?: boolean;
}

export interface ProcessBotDeps {
  fetchMarketPrice: (symbol: string, deps: { nextjsApi: string; fetchFn?: typeof fetch }) => Promise<PriceResult>;
  fetchCandles: (symbol: string, limit: number, deps: { nextjsApi: string; fetchFn?: typeof fetch }) => Promise<CandlesResult>;
  validateEngineProvenance: (prov: { environment: string; isSynthetic: boolean; source: string; observedAt?: string }) => { valid: boolean; reason?: string };
  generateSignal: (candles: CandleData[], strategy: string, risk: string, symbol: string) => TradeSignal | null;
  calculatePositionSize: (balance: number, risk: string, price: number, stopLoss: number, maxSize: number, allocAmount: number) => number;
  updateDCALastBuy: (symbol: string, price: number) => void;
  marketPriceDeps: { nextjsApi: string; fetchFn?: typeof fetch };
  candleDeps: { nextjsApi: string; fetchFn?: typeof fetch };
  positions: Map<string, { id: string; botId: string; accountId: string; symbol: string; side: 'long' | 'short'; qty: number; avgEntryPrice: number; currentPrice: number; stopLoss: number | null; takeProfit: number | null; openedAt: number; unrealizedPnl: number }>;
  addActivity: (entry: Record<string, unknown>) => void;
  callNextJSApi: (method: string, path: string, body?: Record<string, unknown>) => Promise<{ ok: boolean; data?: unknown; error?: string }>;
  executeTrade: (config: BotRow, trade: { symbol: string; side: 'buy' | 'sell'; qty: number; price: number; stopLoss: number; takeProfit: number; confidence: number; reason: string }) => Promise<void>;
  automatedTradingEnabled: boolean;
  allSymbols: string[];
  evaluateEngineAccountEligibility: (account: { broker: string; accountType: string; isDemo: boolean | null | undefined; isActive: boolean | null | undefined; apiKey: string | null | undefined; apiSecret: string | null | undefined; passphrase: string | null | undefined } | null) => { eligible: boolean; reason?: string };
}

function isVerifiedPrice(result: PriceResult): boolean {
  return !result.dataUnavailable && !result.isDemoData && result.environment === 'live' && result.price > 0;
}

export async function processBotCore(
  config: BotRow,
  deps: ProcessBotDeps,
): Promise<{ processed: boolean; reason?: string }> {
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
  if (!eligibility.eligible) return { processed: false, reason: 'ineligible-account' };

  const tag = `[AutoTrade] [${config.id.slice(0, 8)}]`;
  if (config.timeframe && config.timeframe !== '4h') {
    deps.addActivity({ type: 'market_data_unavailable', botId: config.id, botName: config.name, reason: 'UNSUPPORTED_MARKET_DATA', timeframe: config.timeframe });
    return { processed: true, reason: 'unsupported-market-data' };
  }

  const strategyMap: Record<string, string> = { signal_based: 'balanced', scalping: 'momentum' };
  const strategy = strategyMap[config.strategy] || config.strategy || 'balanced';
  const risk = 'medium';
  const accountBalance = config.account?.balance ?? 100000;
  const maxPos = config.maxPositions || 5;

  const botPositions = Array.from(deps.positions.values()).filter(p => p.botId === config.id && p.accountId === config.accountId);
  const closedSymbols: Set<string> = new Set();

  for (const pos of botPositions) {
    const priceResult = await deps.fetchMarketPrice(pos.symbol, deps.marketPriceDeps);
    if (!isVerifiedPrice(priceResult)) {
      deps.addActivity({ type: 'market_data_unavailable', botId: config.id, botName: config.name, symbol: pos.symbol, reason: priceResult.reason || 'MARKET_DATA_UNAVAILABLE', action: 'skip-sl-tp-check' });
      continue;
    }

    pos.currentPrice = priceResult.price;
    pos.unrealizedPnl = pos.side === 'long'
      ? (priceResult.price - pos.avgEntryPrice) * pos.qty
      : (pos.avgEntryPrice - priceResult.price) * pos.qty;

    const sl = pos.stopLoss;
    const tp = pos.takeProfit;
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
      deps.positions.delete(pos.id);
      closedSymbols.add(pos.symbol);
      deps.callNextJSApi('POST', '/api/trading/engine/report', {
        botId: config.id, tradeType: 'closed', pnl, isWin: pnl > 0, reason: closeReason,
        symbol: pos.symbol, side: pos.side, price: priceResult.price,
      });
      deps.addActivity({ type: closeReason === 'stop_loss' ? 'sl_hit' : 'tp_hit', botId: config.id, botName: config.name, symbol: pos.symbol, side: pos.side === 'long' ? 'sell' : 'buy', price: priceResult.price, pnl });
    }
  }

  const activePositionCount = botPositions.length - closedSymbols.size;
  if (activePositionCount >= maxPos) return { processed: true };

  const botSymbols = config.symbols ? config.symbols.split(',').map(s => s.trim()).filter(Boolean) : deps.allSymbols;
  const openSymbols = new Set(botPositions.filter(p => !closedSymbols.has(p.symbol)).map(p => p.symbol));
  const symbols = botSymbols.filter(s => !openSymbols.has(s));
  if (symbols.length === 0) return { processed: true };

  let bestSignal: TradeSignal | null = null;
  for (const symbol of symbols) {
    try {
      const candleResult = await deps.fetchCandles(symbol, 100, deps.candleDeps);
      if (candleResult.dataUnavailable || candleResult.candles.length < 35) {
        deps.addActivity({ type: 'market_data_unavailable', botId: config.id, botName: config.name, symbol, reason: candleResult.reason || 'INSUFFICIENT_HISTORY' });
        continue;
      }

      const candleValidation = deps.validateEngineProvenance(candleResult.provenance);
      if (!candleValidation.valid || candleResult.provenance.environment !== 'live' || candleResult.provenance.isSynthetic) {
        deps.addActivity({ type: 'market_data_unavailable', botId: config.id, botName: config.name, symbol, reason: candleValidation.reason || 'SYNTHETIC_DATA' });
        continue;
      }

      const signal = deps.generateSignal(candleResult.candles, strategy, risk, symbol);
      if (!signal) continue;
      if (!bestSignal || signal.confidence > bestSignal.confidence) bestSignal = signal;
    } catch (err) {
      console.warn(`${tag} [${symbol}] Analysis error:`, err instanceof Error ? err.message : err);
    }
  }

  if (!bestSignal || bestSignal.confidence < 50) return { processed: true };

  const priceResult = await deps.fetchMarketPrice(bestSignal.symbol, deps.marketPriceDeps);
  if (!isVerifiedPrice(priceResult)) {
    deps.addActivity({ type: 'market_data_unavailable', botId: config.id, botName: config.name, symbol: bestSignal.symbol, reason: priceResult.reason || 'MARKET_DATA_UNAVAILABLE', action: 'skip-new-trade' });
    return { processed: true, reason: 'market-data-unavailable' };
  }

  const livePrice = priceResult.price;
  const allocAmount = config.allocationAmount || 10000;
  const maxPosSize = allocAmount * 0.2;
  const qty = deps.calculatePositionSize(accountBalance, risk, livePrice, bestSignal.stopLoss, maxPosSize, allocAmount);
  if (qty <= 0) return { processed: true };

  if (bestSignal.side === 'buy') deps.updateDCALastBuy(bestSignal.symbol, livePrice);

  // Phase 1 containment remains authoritative: this branch never enables it.
  if (!deps.automatedTradingEnabled) {
    console.log(`${tag} AUTOMATED_TRADING_ENABLED=false — not executing trade`);
    return { processed: true };
  }

  await deps.executeTrade(config, {
    symbol: bestSignal.symbol, side: bestSignal.side, qty, price: livePrice,
    stopLoss: bestSignal.stopLoss, takeProfit: bestSignal.takeProfit,
    confidence: bestSignal.confidence, reason: bestSignal.reason,
  });

  deps.addActivity({ type: 'signal_generated', botId: config.id, botName: config.name, symbol: bestSignal.symbol, side: bestSignal.side, confidence: bestSignal.confidence, reason: bestSignal.reason });
  return { processed: true };
}
