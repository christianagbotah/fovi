// ============================================================
// Phase 2D — Audited Paper Execution Contract
// ------------------------------------------------------------
// Pure, deterministic execution envelope used between the auto-trade
// engine and the internal Next.js execution adapter. It carries the exact
// strategy/risk decision plus verified market-data provenance. No broker
// I/O, database access, or live-trading enablement happens in this module.
// ============================================================

import { createHash } from 'node:crypto';

export const EXECUTION_CONTRACT_VERSION = 'phase2d-paper-execution-v1';
export const EXECUTION_MAX_MARKET_SNAPSHOT_AGE_MS = 120_000;
export const EXECUTION_MAX_FUTURE_SKEW_MS = 5_000;

export type ExecutionSide = 'buy' | 'sell';
export type ExecutionMarketEnvironment = 'live' | 'demo' | 'unknown';

export interface ExecutionMarketSnapshot {
  environment: ExecutionMarketEnvironment;
  isSynthetic: boolean;
  source: string;
  observedAt: string;
}

export interface PaperExecutionIntentInput {
  userId: string;
  botId: string;
  accountId: string;
  symbol: string;
  assetType?: string;
  side: ExecutionSide;
  quantity: number;
  referencePrice: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number;
  strategy: string;
  timeframe: string;
  strategyVersion: string;
  riskEngineVersion: string;
  positionNotional: number;
  riskAmount: number;
  riskPercentOfAllocation: number;
  riskReward: number;
  reason: string;
  marketData: ExecutionMarketSnapshot;
}

export interface PaperExecutionIntent extends PaperExecutionIntentInput {
  contractVersion: typeof EXECUTION_CONTRACT_VERSION;
  executionIntentId: string;
}

export type ExecutionIntentValidationCode =
  | 'INVALID_CONTRACT_VERSION'
  | 'INVALID_INTENT_ID'
  | 'INVALID_IDENTITY'
  | 'INVALID_TRADE'
  | 'INVALID_DECISION_METADATA'
  | 'UNVERIFIED_MARKET_DATA'
  | 'INVALID_MARKET_TIMESTAMP'
  | 'STALE_MARKET_SNAPSHOT'
  | 'FUTURE_MARKET_SNAPSHOT';

export type ExecutionIntentValidation =
  | { valid: true }
  | { valid: false; code: ExecutionIntentValidationCode; reason: string };

function normalizeText(value: string): string {
  return value.trim();
}

function normalizeSymbol(value: string): string {
  return value.trim().toUpperCase();
}

function normalizedPayload(input: PaperExecutionIntentInput): PaperExecutionIntentInput {
  return {
    userId: normalizeText(input.userId),
    botId: normalizeText(input.botId),
    accountId: normalizeText(input.accountId),
    symbol: normalizeSymbol(input.symbol),
    assetType: normalizeText(input.assetType || 'unknown').toLowerCase(),
    side: input.side,
    quantity: input.quantity,
    referencePrice: input.referencePrice,
    stopLoss: input.stopLoss,
    takeProfit: input.takeProfit,
    confidence: input.confidence,
    strategy: normalizeText(input.strategy).toLowerCase(),
    timeframe: normalizeText(input.timeframe).toLowerCase(),
    strategyVersion: normalizeText(input.strategyVersion),
    riskEngineVersion: normalizeText(input.riskEngineVersion),
    positionNotional: input.positionNotional,
    riskAmount: input.riskAmount,
    riskPercentOfAllocation: input.riskPercentOfAllocation,
    riskReward: input.riskReward,
    reason: normalizeText(input.reason),
    marketData: {
      environment: input.marketData.environment,
      isSynthetic: input.marketData.isSynthetic,
      source: normalizeText(input.marketData.source),
      observedAt: normalizeText(input.marketData.observedAt),
    },
  };
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function computeExecutionIntentId(input: PaperExecutionIntentInput): string {
  const normalized = normalizedPayload(input);
  const canonical = JSON.stringify({
    contractVersion: EXECUTION_CONTRACT_VERSION,
    ...normalized,
  });
  return `pxi_${digest(canonical).slice(0, 48)}`;
}

export function buildPaperExecutionIntent(input: PaperExecutionIntentInput): PaperExecutionIntent {
  const normalized = normalizedPayload(input);
  return {
    contractVersion: EXECUTION_CONTRACT_VERSION,
    executionIntentId: computeExecutionIntentId(normalized),
    ...normalized,
  };
}

export function buildPaperPositionId(intent: Pick<PaperExecutionIntent, 'accountId' | 'botId' | 'symbol'>): string {
  const key = `${normalizeText(intent.accountId)}|${normalizeText(intent.botId)}|${normalizeSymbol(intent.symbol)}`;
  return `ppos_${digest(key).slice(0, 40)}`;
}

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export function nearlyEqual(a: number, b: number, relativeTolerance = 1e-9): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (a === b) return true;
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= scale * relativeTolerance;
}

export function validatePaperExecutionIntent(
  intent: PaperExecutionIntent,
  nowMs: number = Date.now(),
): ExecutionIntentValidation {
  if (intent.contractVersion !== EXECUTION_CONTRACT_VERSION) {
    return {
      valid: false,
      code: 'INVALID_CONTRACT_VERSION',
      reason: `Execution contract must be ${EXECUTION_CONTRACT_VERSION}.`,
    };
  }

  const expectedId = computeExecutionIntentId(intent);
  if (!intent.executionIntentId || intent.executionIntentId !== expectedId) {
    return {
      valid: false,
      code: 'INVALID_INTENT_ID',
      reason: 'Execution intent ID does not match the canonical decision payload.',
    };
  }

  if (!intent.userId.trim() || !intent.botId.trim() || !intent.accountId.trim() || !intent.symbol.trim()) {
    return { valid: false, code: 'INVALID_IDENTITY', reason: 'Execution identity fields must be present.' };
  }

  if (
    (intent.side !== 'buy' && intent.side !== 'sell') ||
    !isFinitePositive(intent.quantity) ||
    !isFinitePositive(intent.referencePrice) ||
    !isFinitePositive(intent.stopLoss) ||
    !isFinitePositive(intent.takeProfit) ||
    !Number.isFinite(intent.confidence) || intent.confidence < 0 || intent.confidence > 100 ||
    !isFinitePositive(intent.positionNotional) ||
    !isFinitePositive(intent.riskAmount) ||
    !isFinitePositive(intent.riskPercentOfAllocation) ||
    !isFinitePositive(intent.riskReward)
  ) {
    return { valid: false, code: 'INVALID_TRADE', reason: 'Execution trade fields contain invalid values.' };
  }

  if (
    !intent.strategy.trim() ||
    !intent.timeframe.trim() ||
    !intent.strategyVersion.trim() ||
    !intent.riskEngineVersion.trim() ||
    !intent.reason.trim()
  ) {
    return {
      valid: false,
      code: 'INVALID_DECISION_METADATA',
      reason: 'Execution decision metadata must be complete.',
    };
  }

  if (
    intent.marketData.environment !== 'live' ||
    intent.marketData.isSynthetic ||
    !intent.marketData.source.trim()
  ) {
    return {
      valid: false,
      code: 'UNVERIFIED_MARKET_DATA',
      reason: 'Paper execution requires a verified, non-synthetic live-market snapshot.',
    };
  }

  const observedAtMs = Date.parse(intent.marketData.observedAt);
  if (!Number.isFinite(observedAtMs)) {
    return {
      valid: false,
      code: 'INVALID_MARKET_TIMESTAMP',
      reason: 'Market snapshot observedAt must be a valid timestamp.',
    };
  }

  const ageMs = nowMs - observedAtMs;
  if (ageMs > EXECUTION_MAX_MARKET_SNAPSHOT_AGE_MS) {
    return {
      valid: false,
      code: 'STALE_MARKET_SNAPSHOT',
      reason: `Market snapshot is older than ${EXECUTION_MAX_MARKET_SNAPSHOT_AGE_MS}ms.`,
    };
  }
  if (ageMs < -EXECUTION_MAX_FUTURE_SKEW_MS) {
    return {
      valid: false,
      code: 'FUTURE_MARKET_SNAPSHOT',
      reason: 'Market snapshot timestamp is too far in the future.',
    };
  }

  return { valid: true };
}
