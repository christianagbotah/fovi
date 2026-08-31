// ============================================================
// Phase 2G — Paper Position Close / Settlement Contract
// ------------------------------------------------------------
// Pure deterministic contract shared by the auto-trade engine and the
// internal Next.js close adapter. No broker I/O or database access occurs
// here. The full close snapshot is integrity-hashed, while close Order and
// settlement IDs are derived from the Position ID so one paper position can
// affect money/accounting at most once across retries and engine restarts.
// ============================================================

import { createHash } from 'node:crypto';
import {
  EXECUTION_MAX_FUTURE_SKEW_MS,
  EXECUTION_MAX_MARKET_SNAPSHOT_AGE_MS,
  nearlyEqual,
  type ExecutionMarketSnapshot,
} from './execution-contract';

export const LEGACY_POSITION_RECONCILIATION_CONTRACT_VERSION = 'phase2e-paper-position-close-v1';
export const POSITION_RECONCILIATION_CONTRACT_VERSION = 'phase2g-paper-position-close-v2';
export const PAPER_SETTLEMENT_ACCOUNTING_VERSION = 'phase2g-paper-settlement-v1';

export type PaperPositionSide = 'long' | 'short';
export type PaperCloseReason = 'stop_loss' | 'take_profit';

export interface PaperCloseIntentInput {
  userId: string;
  botId: string;
  accountId: string;
  positionId: string;
  symbol: string;
  side: PaperPositionSide;
  quantity: number;
  referencePrice: number;
  reason: PaperCloseReason;
  marketData: ExecutionMarketSnapshot;
}

export interface PaperCloseIntent extends PaperCloseIntentInput {
  contractVersion: typeof POSITION_RECONCILIATION_CONTRACT_VERSION;
  closeIntentId: string;
}

export interface PersistedPaperPositionForClose {
  id: string;
  botId: string | null;
  accountId: string;
  symbol: string;
  side: string;
  qty: number;
  avgEntryPrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
  status: string;
}

export interface PaperSettlementValues {
  positionId: string;
  closeOrderId: string;
  userId: string;
  accountId: string;
  botId: string;
  symbol: string;
  side: PaperPositionSide;
  quantity: number;
  entryPrice: number;
  exitPrice: number;
  rawPnl: number;
  adminLevyPercent: number;
  adminLevy: number;
  realizedPnl: number;
  balanceBefore: number;
  balanceAfter: number;
  closeReason: PaperCloseReason;
  marketDataSource: string;
  marketObservedAt: Date | string;
}

export interface PersistedPaperSettlement extends PaperSettlementValues {
  id: string;
}

export type PaperSettlementValidation =
  | { valid: true }
  | { valid: false; code: 'PAPER_SETTLEMENT_MISMATCH'; reason: string };

export type PaperCloseValidationCode =
  | 'INVALID_CLOSE_CONTRACT_VERSION'
  | 'INVALID_CLOSE_INTENT_ID'
  | 'INVALID_CLOSE_IDENTITY'
  | 'INVALID_CLOSE_TRADE'
  | 'UNVERIFIED_CLOSE_MARKET_DATA'
  | 'INVALID_CLOSE_MARKET_TIMESTAMP'
  | 'STALE_CLOSE_MARKET_SNAPSHOT'
  | 'FUTURE_CLOSE_MARKET_SNAPSHOT';

export type PaperCloseValidation =
  | { valid: true }
  | { valid: false; code: PaperCloseValidationCode; reason: string };

export type PaperClosePositionValidationCode =
  | 'POSITION_CLOSE_MISMATCH'
  | 'POSITION_NOT_OPEN'
  | 'POSITION_CLOSE_TRIGGER_MISSING'
  | 'POSITION_CLOSE_TRIGGER_NOT_MET';

export type PaperClosePositionValidation =
  | { valid: true; triggerPrice: number }
  | { valid: false; code: PaperClosePositionValidationCode; reason: string };

function normalizeText(value: string): string {
  return value.trim();
}

function normalizeSymbol(value: string): string {
  return value.trim().toUpperCase();
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function normalizedClosePayload(input: PaperCloseIntentInput): PaperCloseIntentInput {
  return {
    userId: normalizeText(input.userId),
    botId: normalizeText(input.botId),
    accountId: normalizeText(input.accountId),
    positionId: normalizeText(input.positionId),
    symbol: normalizeSymbol(input.symbol),
    side: input.side,
    quantity: input.quantity,
    referencePrice: input.referencePrice,
    reason: input.reason,
    marketData: {
      environment: input.marketData.environment,
      isSynthetic: input.marketData.isSynthetic,
      source: normalizeText(input.marketData.source),
      observedAt: normalizeText(input.marketData.observedAt),
    },
  };
}

export function computePaperCloseIntentId(input: PaperCloseIntentInput): string {
  const normalized = normalizedClosePayload(input);
  const canonical = JSON.stringify({
    contractVersion: POSITION_RECONCILIATION_CONTRACT_VERSION,
    ...normalized,
  });
  return `pci_${digest(canonical).slice(0, 48)}`;
}

export function buildPaperCloseIntent(input: PaperCloseIntentInput): PaperCloseIntent {
  const normalized = normalizedClosePayload(input);
  return {
    contractVersion: POSITION_RECONCILIATION_CONTRACT_VERSION,
    closeIntentId: computePaperCloseIntentId(normalized),
    ...normalized,
  };
}

export function buildPaperCloseOrderId(positionId: string): string {
  return `pclose_${digest(normalizeText(positionId)).slice(0, 40)}`;
}

export function buildPaperSettlementId(positionId: string): string {
  return `psett_${digest(normalizeText(positionId)).slice(0, 40)}`;
}

export function validatePaperSettlement(
  expected: PaperSettlementValues,
  actual: PersistedPaperSettlement | null,
): PaperSettlementValidation {
  if (!actual) {
    return {
      valid: false,
      code: 'PAPER_SETTLEMENT_MISMATCH',
      reason: 'Deterministic paper settlement row is missing.',
    };
  }

  const expectedObservedAt = new Date(expected.marketObservedAt).getTime();
  const actualObservedAt = new Date(actual.marketObservedAt).getTime();
  const identityMatches =
    actual.id === buildPaperSettlementId(expected.positionId)
    && actual.positionId === expected.positionId
    && actual.closeOrderId === expected.closeOrderId
    && actual.userId === expected.userId
    && actual.accountId === expected.accountId
    && actual.botId === expected.botId
    && normalizeSymbol(actual.symbol) === normalizeSymbol(expected.symbol)
    && actual.side === expected.side
    && actual.closeReason === expected.closeReason
    && normalizeText(actual.marketDataSource) === normalizeText(expected.marketDataSource);

  const amountsMatch =
    nearlyEqual(actual.quantity, expected.quantity)
    && nearlyEqual(actual.entryPrice, expected.entryPrice)
    && nearlyEqual(actual.exitPrice, expected.exitPrice)
    && nearlyEqual(actual.rawPnl, expected.rawPnl)
    && nearlyEqual(actual.adminLevyPercent, expected.adminLevyPercent)
    && nearlyEqual(actual.adminLevy, expected.adminLevy)
    && nearlyEqual(actual.realizedPnl, expected.realizedPnl)
    && nearlyEqual(actual.balanceBefore, expected.balanceBefore)
    && nearlyEqual(actual.balanceAfter, expected.balanceAfter)
    && Number.isFinite(expectedObservedAt)
    && Number.isFinite(actualObservedAt)
    && expectedObservedAt === actualObservedAt;

  if (!identityMatches || !amountsMatch) {
    return {
      valid: false,
      code: 'PAPER_SETTLEMENT_MISMATCH',
      reason: 'Persisted paper settlement does not match deterministic close/accounting truth.',
    };
  }

  return { valid: true };
}

export function validatePaperCloseIntent(
  intent: PaperCloseIntent,
  nowMs: number = Date.now(),
): PaperCloseValidation {
  if (intent.contractVersion !== POSITION_RECONCILIATION_CONTRACT_VERSION) {
    return {
      valid: false,
      code: 'INVALID_CLOSE_CONTRACT_VERSION',
      reason: `Close contract must be ${POSITION_RECONCILIATION_CONTRACT_VERSION}.`,
    };
  }

  if (!intent.closeIntentId || intent.closeIntentId !== computePaperCloseIntentId(intent)) {
    return {
      valid: false,
      code: 'INVALID_CLOSE_INTENT_ID',
      reason: 'Close intent ID does not match the canonical close payload.',
    };
  }

  if (
    !intent.userId.trim() ||
    !intent.botId.trim() ||
    !intent.accountId.trim() ||
    !intent.positionId.trim() ||
    !intent.symbol.trim()
  ) {
    return {
      valid: false,
      code: 'INVALID_CLOSE_IDENTITY',
      reason: 'Close identity fields must be present.',
    };
  }

  if (
    (intent.side !== 'long' && intent.side !== 'short') ||
    !Number.isFinite(intent.quantity) || intent.quantity <= 0 ||
    !Number.isFinite(intent.referencePrice) || intent.referencePrice <= 0 ||
    (intent.reason !== 'stop_loss' && intent.reason !== 'take_profit')
  ) {
    return {
      valid: false,
      code: 'INVALID_CLOSE_TRADE',
      reason: 'Close trade fields contain invalid values.',
    };
  }

  if (
    intent.marketData.environment !== 'live' ||
    intent.marketData.isSynthetic ||
    !intent.marketData.source.trim()
  ) {
    return {
      valid: false,
      code: 'UNVERIFIED_CLOSE_MARKET_DATA',
      reason: 'Paper close requires a verified, non-synthetic live-market snapshot.',
    };
  }

  const observedAtMs = Date.parse(intent.marketData.observedAt);
  if (!Number.isFinite(observedAtMs)) {
    return {
      valid: false,
      code: 'INVALID_CLOSE_MARKET_TIMESTAMP',
      reason: 'Close market snapshot observedAt must be a valid timestamp.',
    };
  }

  const ageMs = nowMs - observedAtMs;
  if (ageMs > EXECUTION_MAX_MARKET_SNAPSHOT_AGE_MS) {
    return {
      valid: false,
      code: 'STALE_CLOSE_MARKET_SNAPSHOT',
      reason: `Close market snapshot is older than ${EXECUTION_MAX_MARKET_SNAPSHOT_AGE_MS}ms.`,
    };
  }
  if (ageMs < -EXECUTION_MAX_FUTURE_SKEW_MS) {
    return {
      valid: false,
      code: 'FUTURE_CLOSE_MARKET_SNAPSHOT',
      reason: 'Close market snapshot timestamp is too far in the future.',
    };
  }

  return { valid: true };
}

export function validatePaperCloseAgainstPosition(
  intent: PaperCloseIntent,
  position: PersistedPaperPositionForClose,
): PaperClosePositionValidation {
  if (
    position.id !== intent.positionId ||
    position.botId !== intent.botId ||
    position.accountId !== intent.accountId ||
    normalizeSymbol(position.symbol) !== normalizeSymbol(intent.symbol) ||
    position.side !== intent.side ||
    !nearlyEqual(position.qty, intent.quantity)
  ) {
    return {
      valid: false,
      code: 'POSITION_CLOSE_MISMATCH',
      reason: 'Close intent does not match the persisted paper position.',
    };
  }

  if (position.status !== 'open') {
    return {
      valid: false,
      code: 'POSITION_NOT_OPEN',
      reason: 'Paper position is not open.',
    };
  }

  const triggerPrice = intent.reason === 'stop_loss' ? position.stopLoss : position.takeProfit;
  if (!Number.isFinite(triggerPrice) || (triggerPrice ?? 0) <= 0) {
    return {
      valid: false,
      code: 'POSITION_CLOSE_TRIGGER_MISSING',
      reason: `Persisted ${intent.reason === 'stop_loss' ? 'stop-loss' : 'take-profit'} trigger is missing.`,
    };
  }

  const trigger = triggerPrice as number;
  const crossed = intent.reason === 'stop_loss'
    ? (intent.side === 'long' ? intent.referencePrice <= trigger : intent.referencePrice >= trigger)
    : (intent.side === 'long' ? intent.referencePrice >= trigger : intent.referencePrice <= trigger);

  if (!crossed) {
    return {
      valid: false,
      code: 'POSITION_CLOSE_TRIGGER_NOT_MET',
      reason: `Verified market price has not crossed the persisted ${intent.reason === 'stop_loss' ? 'stop-loss' : 'take-profit'} trigger.`,
    };
  }

  return { valid: true, triggerPrice: trigger };
}

export function calculatePaperRawPnl(
  side: PaperPositionSide,
  entryPrice: number,
  exitPrice: number,
  quantity: number,
): number {
  if (
    (side !== 'long' && side !== 'short') ||
    !Number.isFinite(entryPrice) || entryPrice <= 0 ||
    !Number.isFinite(exitPrice) || exitPrice <= 0 ||
    !Number.isFinite(quantity) || quantity <= 0
  ) {
    throw new Error('Cannot calculate paper P&L from invalid position values.');
  }

  return side === 'long'
    ? (exitPrice - entryPrice) * quantity
    : (entryPrice - exitPrice) * quantity;
}
