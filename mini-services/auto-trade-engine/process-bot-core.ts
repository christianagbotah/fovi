// ============================================================
// process-bot-core.ts — Startup-free processBot extraction
// Phase 2C–2E: eligibility first + verified data + durable execution truth.
// ============================================================

import { type CandleData, type TradeSignal } from './strategies';
import { evaluateStrategyDecision } from '../../src/lib/trading-intelligence/strategy-engine';
import { evaluateAutomatedTradeRisk } from '../../src/lib/trading-intelligence/risk-engine';
import { evaluateAutonomySupervisor } from '../../src/lib/trading-intelligence/autonomy-supervisor';
import {
  buildAiDecisionJournalEntry,
  type AiDecisionJournalEntry,
  type AiDecisionJournalInput,
  type AiDecisionMarketData,
} from '../../src/lib/trading-intelligence/decision-journal';

export interface BotRow {
  id: string; userId?: string; accountId: string; name: string; strategy: string;
  symbols?: string; timeframe?: string; allocationAmount?: number; enabled?: boolean;
  status?: string; riskPerTrade?: number; maxPositions?: number; stopLossPercent?: number;
  takeProfitPercent?: number; totalTrades?: number; winTrades?: number; totalPnl?: number;
  lastTradeAt?: string | Date | null;
  account: {
    id: string; broker: string; accountType: string; isDemo: boolean | null; balance?: number;
    isActive?: boolean; apiKey?: string | null; apiSecret?: string | null; passphrase?: string | null;
  } | null;
}

export interface EnginePosition {
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
  positions: Map<string, EnginePosition>;
  addActivity: (entry: Record<string, unknown>) => void;
  decisionCycleId: string;
  recordDecision: (entry: AiDecisionJournalEntry) => Promise<void>;
  callNextJSApi: (method: string, path: string, body?: Record<string, unknown>) => Promise<{ ok: boolean; data?: unknown; error?: string }>;
  executeTrade: (config: BotRow, trade: {
    symbol: string; side: 'buy' | 'sell'; qty: number; price: number; stopLoss: number; takeProfit: number;
    confidence: number; reason: string; strategyVersion?: string; riskEngineVersion: string;
    positionNotional: number; riskAmount: number; riskPercentOfAllocation: number; riskReward: number;
    marketData: {
      environment: 'live' | 'demo' | 'unknown'; isSynthetic: boolean; source: string; observedAt: string;
    };
  }) => Promise<void>;
  closePosition: (config: BotRow, position: EnginePosition, close: {
    reason: 'stop_loss' | 'take_profit' | 'automation_stopped';
    price: number;
    marketData: {
      environment: 'live' | 'demo' | 'unknown'; isSynthetic: boolean; source: string; observedAt: string;
    };
  }) => Promise<void>;
  /** Finalize Running -> Stopping -> Stopped only after no paper exposure remains. */
  finalizeAutomationStop: (config: BotRow) => Promise<void>;
  automatedTradingEnabled: boolean;
  /** Consecutive failures from the single-flight engine cycle coordinator. */
  consecutiveCycleFailures?: number;
  allSymbols: string[];
  evaluateEngineAccountEligibility: (account: { broker: string; accountType: string; isDemo: boolean | null | undefined; isActive: boolean | null | undefined; apiKey: string | null | undefined; apiSecret: string | null | undefined; passphrase: string | null | undefined } | null) => { eligible: boolean; reason?: string };
}

function isVerifiedPrice(result: PriceResult): boolean {
  return !result.dataUnavailable && !result.isDemoData && result.environment === 'live' && result.price > 0;
}

type DecisionDetails = Omit<AiDecisionJournalInput, 'userId' | 'botId' | 'accountId' | 'cycleId'>;

async function persistDecision(
  config: BotRow,
  deps: ProcessBotDeps,
  details: DecisionDetails,
): Promise<void> {
  if (!config.userId) {
    throw new Error('AI decision journaling requires a verified bot userId.');
  }
  const entry = buildAiDecisionJournalEntry({
    userId: config.userId,
    botId: config.id,
    accountId: config.accountId,
    cycleId: deps.decisionCycleId,
    ...details,
  });
  await deps.recordDecision(entry);
}

function safeDecisionMarketData(
  value: { environment: 'live' | 'demo' | 'unknown'; isSynthetic: boolean; source: string; observedAt: string },
): AiDecisionMarketData | null {
  if (!value.source.trim() || !Number.isFinite(Date.parse(value.observedAt))) return null;
  return {
    environment: value.environment,
    isSynthetic: value.isSynthetic,
    source: value.source.trim(),
    observedAt: value.observedAt,
  };
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

  const strategy = config.strategy?.trim().toLowerCase() || '';
  const accountBalance = config.account?.balance ?? 0;
  const allocationAmount = config.allocationAmount ?? 0;
  const riskPerTradePct = config.riskPerTrade ?? 0;
  const maxPos = config.maxPositions ?? 0;

  const botPositions = Array.from(deps.positions.values()).filter(
    p => p.botId === config.id && p.accountId === config.accountId,
  );
  const closedSymbols: Set<string> = new Set();

  // Existing positions may only be re-priced and durably closed from verified
  // market snapshots. Memory is released only AFTER persisted close truth is
  // returned. A failed close keeps the position present and therefore blocks
  // replacement trades for the same exposure.
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
    let closeReason: 'stop_loss' | 'take_profit' | 'automation_stopped' | null =
      config.status === 'stopping' ? 'automation_stopped' : null;
    if (!closeReason && sl !== null && sl > 0) {
      if (pos.side === 'long' && priceResult.price <= sl) closeReason = 'stop_loss';
      else if (pos.side === 'short' && priceResult.price >= sl) closeReason = 'stop_loss';
    }
    if (!closeReason && tp !== null && tp > 0) {
      if (pos.side === 'long' && priceResult.price >= tp) closeReason = 'take_profit';
      else if (pos.side === 'short' && priceResult.price <= tp) closeReason = 'take_profit';
    }

    if (closeReason) {
      const pnl = pos.unrealizedPnl;
      try {
        await deps.closePosition(config, pos, {
          reason: closeReason,
          price: priceResult.price,
          marketData: {
            environment: priceResult.environment,
            isSynthetic: priceResult.isDemoData,
            source: priceResult.source,
            observedAt: priceResult.observedAt,
          },
        });
        deps.positions.delete(pos.id);
        closedSymbols.add(pos.symbol);
        deps.addActivity({
          type: closeReason === 'automation_stopped'
            ? 'automation_position_closed'
            : closeReason === 'stop_loss' ? 'sl_hit' : 'tp_hit',
          botId: config.id, botName: config.name, symbol: pos.symbol,
          side: pos.side === 'long' ? 'sell' : 'buy', price: priceResult.price, pnl,
          settlement: 'persisted',
        });
      } catch (err) {
        deps.addActivity({
          type: 'position_close_failed',
          botId: config.id,
          botName: config.name,
          symbol: pos.symbol,
          side: pos.side === 'long' ? 'sell' : 'buy',
          price: priceResult.price,
          reason: closeReason,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  const activePositionCount = botPositions.filter((position) => deps.positions.has(position.id)).length;

  // A user-confirmed Stop is a two-phase paper lifecycle. No new exposure is
  // possible in "stopping". We finalize "stopped" only after every persisted
  // paper position has settled successfully.
  if (config.status === 'stopping') {
    if (activePositionCount > 0) {
      deps.addActivity({
        type: 'automation_stop_pending',
        botId: config.id,
        botName: config.name,
        symbol: '—',
        reason: `${activePositionCount} paper position(s) still require settlement before Stop completes.`,
      });
      return { processed: true, reason: 'automation-stop-pending' };
    }

    await deps.finalizeAutomationStop(config);
    deps.addActivity({
      type: 'automation_stopped',
      botId: config.id,
      botName: config.name,
      symbol: '—',
      reason: 'All AI-created paper positions are settled; automation is fully stopped.',
    });
    return { processed: true, reason: 'automation-stop-complete' };
  }

  // The 4h requirement governs NEW AI decisions only. Existing persisted
  // paper exposure must still receive verified-price protective/Stop closes
  // even if a legacy or corrupted bot carries an unsupported timeframe.
  if (timeframe !== '4h') {
    deps.addActivity({
      type: 'strategy_hold', botId: config.id, botName: config.name,
      code: 'UNSUPPORTED_VERIFIED_TIMEFRAME', timeframe,
      reason: 'Verified automated decisions currently require 4h market data.',
    });
    return { processed: true, reason: 'unsupported-verified-timeframe' };
  }

  // Phase 2I supervisory policy runs AFTER existing-position safety exits and
  // BEFORE any new strategy scan. Circuit breakers therefore stop NEW paper
  // exposure without suppressing stop-loss/take-profit reconciliation.
  const supervisorDecision = evaluateAutonomySupervisor({
    enabled: config.enabled === true,
    status: config.status || '',
    allocationAmount,
    totalPnl: config.totalPnl ?? 0,
    currentOpenPositions: activePositionCount,
    maxPositions: maxPos,
    consecutiveCycleFailures: deps.consecutiveCycleFailures ?? 0,
    lastTradeAt: config.lastTradeAt ?? null,
  });
  if (supervisorDecision.action !== 'scan') {
    deps.addActivity({
      type: supervisorDecision.action === 'suspend' ? 'autonomy_suspend' : 'autonomy_hold',
      botId: config.id,
      botName: config.name,
      symbol: '—',
      code: supervisorDecision.code,
      reason: supervisorDecision.reason,
      supervisorVersion: supervisorDecision.supervisorVersion,
      drawdownPct: supervisorDecision.drawdownPct,
      cooldownRemainingMs: supervisorDecision.cooldownRemainingMs,
    });
    return { processed: true, reason: `autonomy-${supervisorDecision.code.toLowerCase()}` };
  }

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
