// ============================================================
// Phase 2C — Canonical Automated Trade Risk Engine
// ------------------------------------------------------------
// Pure, deterministic, fail-closed risk evaluation for AI-generated
// trade candidates. This module does not perform I/O or broker calls.
// ============================================================

export const RISK_ENGINE_VERSION = 'phase2c-risk-v1';

// Platform hard safety limits. Bot configuration may be stricter, never looser.
export const PLATFORM_MAX_RISK_PER_TRADE_PCT = 2;
export const PLATFORM_MAX_POSITION_ALLOCATION_PCT = 20;
export const PLATFORM_MIN_RISK_REWARD = 1;

export type AutomatedTradeSide = 'buy' | 'sell';

export type RiskRejectionCode =
  | 'INVALID_ACCOUNT_BALANCE'
  | 'INVALID_ALLOCATION'
  | 'ALLOCATION_EXCEEDS_BALANCE'
  | 'INVALID_RISK_PER_TRADE'
  | 'RISK_PER_TRADE_EXCEEDS_PLATFORM_CAP'
  | 'INVALID_POSITION_LIMIT'
  | 'MAX_POSITIONS_REACHED'
  | 'INVALID_CANDIDATE'
  | 'INVALID_STOP_LOSS_DIRECTION'
  | 'INVALID_TAKE_PROFIT_DIRECTION'
  | 'RISK_REWARD_TOO_LOW'
  | 'INVALID_MAX_POSITION_NOTIONAL'
  | 'ZERO_POSITION_SIZE';

export interface AutomatedTradeCandidate {
  symbol: string;
  side: AutomatedTradeSide;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number;
  strategy: string;
  timeframe: string;
}

export interface AutomatedRiskContext {
  accountBalance: number;
  allocationAmount: number;
  riskPerTradePct: number;
  maxPositions: number;
  currentOpenPositions: number;
  /** Optional stricter dollar cap. 0/undefined means use the platform allocation cap. */
  maxPositionNotional?: number | null;
}

export interface ApprovedRiskDecision {
  approved: true;
  engineVersion: typeof RISK_ENGINE_VERSION;
  quantity: number;
  positionNotional: number;
  riskAmount: number;
  riskPercentOfAllocation: number;
  riskReward: number;
  stopDistance: number;
  rewardDistance: number;
  effectivePositionCap: number;
}

export interface RejectedRiskDecision {
  approved: false;
  engineVersion: typeof RISK_ENGINE_VERSION;
  code: RiskRejectionCode;
  reason: string;
}

export type AutomatedRiskDecision = ApprovedRiskDecision | RejectedRiskDecision;

function reject(code: RiskRejectionCode, reason: string): RejectedRiskDecision {
  return { approved: false, engineVersion: RISK_ENGINE_VERSION, code, reason };
}

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

export function evaluateAutomatedTradeRisk(
  candidate: AutomatedTradeCandidate,
  context: AutomatedRiskContext,
): AutomatedRiskDecision {
  if (!isFinitePositive(context.accountBalance)) {
    return reject('INVALID_ACCOUNT_BALANCE', 'Account balance must be a positive finite number.');
  }
  if (!isFinitePositive(context.allocationAmount)) {
    return reject('INVALID_ALLOCATION', 'Bot allocation must be a positive finite number.');
  }
  if (context.allocationAmount > context.accountBalance) {
    return reject('ALLOCATION_EXCEEDS_BALANCE', 'Bot allocation cannot exceed the verified account balance.');
  }
  if (!isFinitePositive(context.riskPerTradePct)) {
    return reject('INVALID_RISK_PER_TRADE', 'riskPerTradePct must be a positive finite percentage.');
  }
  if (context.riskPerTradePct > PLATFORM_MAX_RISK_PER_TRADE_PCT) {
    return reject(
      'RISK_PER_TRADE_EXCEEDS_PLATFORM_CAP',
      `riskPerTradePct exceeds the platform cap of ${PLATFORM_MAX_RISK_PER_TRADE_PCT}%.`,
    );
  }
  if (!Number.isInteger(context.maxPositions) || context.maxPositions <= 0) {
    return reject('INVALID_POSITION_LIMIT', 'maxPositions must be a positive integer.');
  }
  if (!Number.isInteger(context.currentOpenPositions) || context.currentOpenPositions < 0) {
    return reject('INVALID_POSITION_LIMIT', 'currentOpenPositions must be a non-negative integer.');
  }
  if (context.currentOpenPositions >= context.maxPositions) {
    return reject('MAX_POSITIONS_REACHED', 'The bot has reached its configured open-position limit.');
  }

  const symbol = normalizeSymbol(candidate.symbol);
  if (
    !symbol ||
    (candidate.side !== 'buy' && candidate.side !== 'sell') ||
    !isFinitePositive(candidate.entryPrice) ||
    !isFinitePositive(candidate.stopLoss) ||
    !isFinitePositive(candidate.takeProfit) ||
    !Number.isFinite(candidate.confidence) ||
    candidate.confidence < 0 ||
    candidate.confidence > 100 ||
    !candidate.strategy.trim() ||
    !candidate.timeframe.trim()
  ) {
    return reject('INVALID_CANDIDATE', 'Trade candidate contains missing, non-finite, or out-of-range values.');
  }

  if (candidate.side === 'buy' && candidate.stopLoss >= candidate.entryPrice) {
    return reject('INVALID_STOP_LOSS_DIRECTION', 'Buy stop-loss must be below the decision price.');
  }
  if (candidate.side === 'sell' && candidate.stopLoss <= candidate.entryPrice) {
    return reject('INVALID_STOP_LOSS_DIRECTION', 'Sell stop-loss must be above the decision price.');
  }
  if (candidate.side === 'buy' && candidate.takeProfit <= candidate.entryPrice) {
    return reject('INVALID_TAKE_PROFIT_DIRECTION', 'Buy take-profit must be above the decision price.');
  }
  if (candidate.side === 'sell' && candidate.takeProfit >= candidate.entryPrice) {
    return reject('INVALID_TAKE_PROFIT_DIRECTION', 'Sell take-profit must be below the decision price.');
  }

  const stopDistance = Math.abs(candidate.entryPrice - candidate.stopLoss);
  const rewardDistance = Math.abs(candidate.takeProfit - candidate.entryPrice);
  if (!isFinitePositive(stopDistance) || !isFinitePositive(rewardDistance)) {
    return reject('INVALID_CANDIDATE', 'Stop and reward distances must be positive.');
  }

  const riskReward = rewardDistance / stopDistance;
  if (!Number.isFinite(riskReward) || riskReward < PLATFORM_MIN_RISK_REWARD) {
    return reject(
      'RISK_REWARD_TOO_LOW',
      `Risk/reward must be at least ${PLATFORM_MIN_RISK_REWARD.toFixed(2)}:1.`,
    );
  }

  const platformPositionCap = context.allocationAmount * (PLATFORM_MAX_POSITION_ALLOCATION_PCT / 100);
  let effectivePositionCap = platformPositionCap;
  if (context.maxPositionNotional !== undefined && context.maxPositionNotional !== null) {
    if (!Number.isFinite(context.maxPositionNotional) || context.maxPositionNotional < 0) {
      return reject('INVALID_MAX_POSITION_NOTIONAL', 'maxPositionNotional must be zero or a positive finite amount.');
    }
    if (context.maxPositionNotional > 0) {
      effectivePositionCap = Math.min(effectivePositionCap, context.maxPositionNotional);
    }
  }

  const riskBudget = context.allocationAmount * (context.riskPerTradePct / 100);
  const riskSizedQty = riskBudget / stopDistance;
  const notionalCappedQty = effectivePositionCap / candidate.entryPrice;
  const quantity = Math.min(riskSizedQty, notionalCappedQty);

  if (!isFinitePositive(quantity)) {
    return reject('ZERO_POSITION_SIZE', 'Risk controls reduced the trade quantity to zero.');
  }

  const positionNotional = quantity * candidate.entryPrice;
  const riskAmount = quantity * stopDistance;
  const riskPercentOfAllocation = (riskAmount / context.allocationAmount) * 100;

  if (
    !isFinitePositive(positionNotional) ||
    !isFinitePositive(riskAmount) ||
    positionNotional > effectivePositionCap + Number.EPSILON ||
    riskAmount > riskBudget + Number.EPSILON
  ) {
    return reject('ZERO_POSITION_SIZE', 'Calculated position violates the canonical risk caps.');
  }

  return {
    approved: true,
    engineVersion: RISK_ENGINE_VERSION,
    quantity,
    positionNotional,
    riskAmount,
    riskPercentOfAllocation,
    riskReward,
    stopDistance,
    rewardDistance,
    effectivePositionCap,
  };
}
