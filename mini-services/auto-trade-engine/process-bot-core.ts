// ============================================================
// process-bot-core.ts — Startup-free processBot extraction
// Phase 2C/2D: eligibility first + verified data + canonical strategy/risk gates.
// ============================================================

import { type CandleData, type TradeSignal } from './strategies';
import { evaluateStrategyDecision } from '../../src/lib/trading-intelligence/strategy-engine';
import { evaluateAutomatedTradeRisk } from '../../src/lib/trading-intelligence/risk-engine';

export interface BotRow {
  id: string; userId?: string; accountId: string; name: string; strategy: string;
  symbols?: string; timeframe?: string; allocationAmount?: number; enabled?: boolean;
  status?: string; riskPerTrade?: number; maxPositions?: number; stopLossPercent?: number;
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

export interface GeneratedTradeSignal extends TradeSignal {
  signalType?: string;
  strategy?: string;
  timeframe?: string;
  strategyVersion?: string;
}

export interface ProcessBotDeps {
  fetchMarketPrice: (symbol: string, deps: { nextjsApi: string; fetchFn?: typeof fetch }) => Promise<PriceResult>;
  fetchCandles: (symbol: string, limit: number, deps: { nextjsApi: string; fetchFn?: typeof fetch }) => Promise<CandlesResult>;
  validateEngineProvenance: (prov: { environment: string; isSynthetic: boolean; source: string; observedAt?: string }) => { valid: boolean; reason?: string };
  /** @deprecated Phase 2C production decisions use the canonical strategy engine directly. */
  generateSignal?: (candles: CandleData[], strategy: string, risk: string, symbol: string) => TradeSignal | null;
  /** @deprecated Phase 2C production sizing uses the canonical risk engine directly. */
  calculatePositionSize?: (balance: number, risk: string, price: number, stopLoss: number, maxSize: number, allocAmount: number) => number;
  updateDCALastBuy: (symbol: string, price: number) => void;
  marketPriceDeps: { nextjsApi: string; fetchFn?: typeof fetch };
  candleDeps: { nextjsApi: string; fetchFn?: typeof fetch };
  positions: Map<string, { id: string; botId: string; accountId: string; symbol: string; side: 'long' | 'short'; qty: number; avgEntryPrice: number; currentPrice: number; stopLoss: number | null; takeProfit: number | null; openedAt: number; unrealizedPnl: number }>;
  addActivity: (entry: Record<string, unknown>) => void;
  callNextJSApi: (method: string, path: string, body?: Record<string, unknown>) => Promise<{ ok: boolean; data?: unknown; error?: string }>;
  executeTrade: (config: BotRow, trade: {
    symbol: string; side: 'buy' | 'sell'; qty: number; price: number; stopLoss: number; takeProfit: number;
    confidence: number; reason: string; strategyVersion?: string; riskEngineVersion: string;
    positionNotional: number; riskAmount: number; riskPercentOfAllocation: number; riskReward: number;
    marketData: {
      environment: 'live' | 'demo' | 'unknown'; isSynthetic: boolean; source: string; observedAt: string;
    };
  }) => Promise<void>;
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
  // Eligibility remains the FIRST operation. Nothing below may run first.
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
  const timeframe = config.timeframe?.trim().toLowerCase() || '';
  if (timeframe !== '4h') {
    deps.addActivity({
      type: 'strategy_hold', botId: config.id, botName: config.name,
      code: 'UNSUPPORTED_VERIFIED_TIMEFRAME', timeframe,
      reason: 'Verified automated decisions currently require 4h market data.',
    });
    return { processed: true, reason: 'unsupported-verified-timeframe' };
  }

  const strategy = config.strategy?.trim().toLowerCase() || '';
  const accountBalance = config.account?.balance ?? 0;
  const allocationAmount = config.allocationAmount ?? 0;
  const riskPerTradePct = config.riskPerTrade ?? 0;
  const maxPos = config.maxPositions ?? 0;

  const botPositions = Array.from(deps.positions.values()).filter(
    p => p.botId === config.id && p.accountId === config.accountId,
  );
  const closedSymbols: Set<string> = new Set();

  // Existing positions may only be re-priced and closed from verified prices.
  for (const pos of botPositions) {
    const priceResult = await deps.fetchMarketPrice(pos.symbol, deps.marketPriceDeps);
    if (!isVerifiedPrice(priceResult)) {
      deps.addActivity({
        type: 'market_data_unavailable', botId: config.id, botName: config.name,
        symbol: pos.symbol, reason: priceResult.reason || 'MARKET_DATA_UNAVAILABLE',
        action: 'skip-sl-tp-check',
      });
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
      void deps.callNextJSApi('POST', '/api/trading/engine/report', {
        botId: config.id, tradeType: 'closed', pnl, isWin: pnl > 0, reason: closeReason,
        symbol: pos.symbol, side: pos.side, price: priceResult.price,
      });
      deps.addActivity({
        type: closeReason === 'stop_loss' ? 'sl_hit' : 'tp_hit',
        botId: config.id, botName: config.name, symbol: pos.symbol,
        side: pos.side === 'long' ? 'sell' : 'buy', price: priceResult.price, pnl,
      });
    }
  }

  const activePositionCount = botPositions.length - closedSymbols.size;
  if (maxPos > 0 && activePositionCount >= maxPos) return { processed: true, reason: 'max-positions-reached' };

  const botSymbols = config.symbols
    ? config.symbols.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
    : deps.allSymbols;
  const openSymbols = new Set(
    botPositions.filter(p => !closedSymbols.has(p.symbol)).map(p => p.symbol.toUpperCase()),
  );
  const symbols = botSymbols.filter(s => !openSymbols.has(s.toUpperCase()));
  if (symbols.length === 0) return { processed: true, reason: 'no-symbols-available' };

  let bestSignal: GeneratedTradeSignal | null = null;
  for (const symbol of symbols) {
    try {
      const candleResult = await deps.fetchCandles(symbol, 100, deps.candleDeps);
      if (candleResult.dataUnavailable || candleResult.candles.length < 35) {
        deps.addActivity({
          type: 'market_data_unavailable', botId: config.id, botName: config.name,
          symbol, reason: candleResult.reason || 'INSUFFICIENT_HISTORY',
        });
        continue;
      }

      const candleValidation = deps.validateEngineProvenance(candleResult.provenance);
      if (
        !candleValidation.valid ||
        candleResult.provenance.environment !== 'live' ||
        candleResult.provenance.isSynthetic
      ) {
        deps.addActivity({
          type: 'market_data_unavailable', botId: config.id, botName: config.name,
          symbol, reason: candleValidation.reason || 'SYNTHETIC_DATA',
        });
        continue;
      }

      const strategyDecision = evaluateStrategyDecision(candleResult.candles, {
        symbol,
        strategy,
        timeframe,
      });
      if (strategyDecision.action === 'hold') {
        if (strategyDecision.code !== 'NO_VALID_CANDIDATE') {
          deps.addActivity({
            type: 'strategy_hold', botId: config.id, botName: config.name,
            symbol, code: strategyDecision.code, reason: strategyDecision.reason,
          });
        }
        continue;
      }

      const signal: GeneratedTradeSignal = strategyDecision.trade;
      if (
        !bestSignal ||
        signal.confidence > bestSignal.confidence ||
        (signal.confidence === bestSignal.confidence && signal.symbol.localeCompare(bestSignal.symbol) < 0)
      ) {
        bestSignal = signal;
      }
    } catch (err) {
      console.warn(`${tag} [${symbol}] Analysis error:`, err instanceof Error ? err.message : err);
    }
  }

  if (!bestSignal) return { processed: true, reason: 'no-strategy-decision' };

  // Re-price the selected candidate immediately before sizing/risk evaluation.
  const priceResult = await deps.fetchMarketPrice(bestSignal.symbol, deps.marketPriceDeps);
  if (!isVerifiedPrice(priceResult)) {
    deps.addActivity({
      type: 'market_data_unavailable', botId: config.id, botName: config.name,
      symbol: bestSignal.symbol, reason: priceResult.reason || 'MARKET_DATA_UNAVAILABLE',
      action: 'skip-new-trade',
    });
    return { processed: true, reason: 'market-data-unavailable' };
  }

  const riskDecision = evaluateAutomatedTradeRisk(
    {
      symbol: bestSignal.symbol,
      side: bestSignal.side,
      entryPrice: priceResult.price,
      stopLoss: bestSignal.stopLoss,
      takeProfit: bestSignal.takeProfit,
      confidence: bestSignal.confidence,
      strategy,
      timeframe,
    },
    {
      accountBalance,
      allocationAmount,
      riskPerTradePct,
      maxPositions: maxPos,
      currentOpenPositions: activePositionCount,
    },
  );

  if (!riskDecision.approved) {
    deps.addActivity({
      type: 'risk_rejected', botId: config.id, botName: config.name,
      symbol: bestSignal.symbol, code: riskDecision.code,
      reason: riskDecision.reason, riskEngineVersion: riskDecision.engineVersion,
    });
    return { processed: true, reason: `risk-rejected:${riskDecision.code}` };
  }

  // Containment remains authoritative. A valid strategy+risk decision is NOT
  // permission to execute while automated trading is disabled.
  if (!deps.automatedTradingEnabled) {
    deps.addActivity({
      type: 'risk_approved_execution_disabled', botId: config.id, botName: config.name,
      symbol: bestSignal.symbol, riskEngineVersion: riskDecision.engineVersion,
      positionNotional: riskDecision.positionNotional, riskAmount: riskDecision.riskAmount,
    });
    console.log(`${tag} AUTOMATED_TRADING_ENABLED=false — approved decision not executed`);
    return { processed: true, reason: 'execution-disabled' };
  }

  await deps.executeTrade(config, {
    symbol: bestSignal.symbol,
    side: bestSignal.side,
    qty: riskDecision.quantity,
    price: priceResult.price,
    stopLoss: bestSignal.stopLoss,
    takeProfit: bestSignal.takeProfit,
    confidence: bestSignal.confidence,
    reason: bestSignal.reason,
    strategyVersion: bestSignal.strategyVersion,
    riskEngineVersion: riskDecision.engineVersion,
    positionNotional: riskDecision.positionNotional,
    riskAmount: riskDecision.riskAmount,
    riskPercentOfAllocation: riskDecision.riskPercentOfAllocation,
    riskReward: riskDecision.riskReward,
    marketData: {
      environment: priceResult.environment,
      isSynthetic: priceResult.isDemoData,
      source: priceResult.source,
      observedAt: priceResult.observedAt,
    },
  });

  if (bestSignal.side === 'buy') deps.updateDCALastBuy(bestSignal.symbol, priceResult.price);

  deps.addActivity({
    type: 'signal_generated', botId: config.id, botName: config.name,
    symbol: bestSignal.symbol, side: bestSignal.side, confidence: bestSignal.confidence,
    reason: bestSignal.reason, strategyVersion: bestSignal.strategyVersion,
    riskEngineVersion: riskDecision.engineVersion,
  });
  return { processed: true };
}
