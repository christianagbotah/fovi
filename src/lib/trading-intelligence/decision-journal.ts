import { createHash } from 'node:crypto';

export const AI_DECISION_JOURNAL_CONTRACT_VERSION = 'phase2k-ai-decision-journal-v1';

export type AiDecisionStage =
  | 'autonomy'
  | 'strategy'
  | 'market_data'
  | 'risk'
  | 'execution';

export type AiDecisionOutcome = 'hold' | 'suspend' | 'reject' | 'approve';

export interface AiDecisionMarketData {
  environment: 'live' | 'demo' | 'unknown';
  isSynthetic: boolean;
  source: string;
  observedAt: string;
}

export interface AiDecisionJournalInput {
  userId: string;
  botId: string;
  accountId: string;
  cycleId: string;
  stage: AiDecisionStage;
  outcome: AiDecisionOutcome;
  code: string;
  reason: string;
  symbol?: string | null;
  side?: 'buy' | 'sell' | null;
  confidence?: number | null;
  strategy?: string | null;
  timeframe?: string | null;
  strategyVersion?: string | null;
  riskEngineVersion?: string | null;
  supervisorVersion?: string | null;
  positionNotional?: number | null;
  riskAmount?: number | null;
  riskPercentOfAllocation?: number | null;
  riskReward?: number | null;
  marketData?: AiDecisionMarketData | null;
}

export interface AiDecisionJournalEntry extends AiDecisionJournalInput {
  contractVersion: typeof AI_DECISION_JOURNAL_CONTRACT_VERSION;
  journalId: string;
}

function trim(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function finiteOrNull(value: number | null | undefined): number | null {
  return value === null || value === undefined ? null : value;
}

function normalize(input: AiDecisionJournalInput): AiDecisionJournalInput {
  const marketData = input.marketData
    ? {
        environment: input.marketData.environment,
        isSynthetic: input.marketData.isSynthetic,
        source: input.marketData.source.trim(),
        observedAt: input.marketData.observedAt.trim(),
      }
    : null;

  return {
    userId: input.userId.trim(),
    botId: input.botId.trim(),
    accountId: input.accountId.trim(),
    cycleId: input.cycleId.trim(),
    stage: input.stage,
    outcome: input.outcome,
    code: input.code.trim(),
    reason: input.reason.trim(),
    symbol: trim(input.symbol)?.toUpperCase() ?? null,
    side: input.side ?? null,
    confidence: finiteOrNull(input.confidence),
    strategy: trim(input.strategy)?.toLowerCase() ?? null,
    timeframe: trim(input.timeframe)?.toLowerCase() ?? null,
    strategyVersion: trim(input.strategyVersion),
    riskEngineVersion: trim(input.riskEngineVersion),
    supervisorVersion: trim(input.supervisorVersion),
    positionNotional: finiteOrNull(input.positionNotional),
    riskAmount: finiteOrNull(input.riskAmount),
    riskPercentOfAllocation: finiteOrNull(input.riskPercentOfAllocation),
    riskReward: finiteOrNull(input.riskReward),
    marketData,
  };
}

export function computeAiDecisionJournalId(input: AiDecisionJournalInput): string {
  const canonical = JSON.stringify({
    contractVersion: AI_DECISION_JOURNAL_CONTRACT_VERSION,
    ...normalize(input),
  });
  return `aidj_${createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 48)}`;
}

export function buildAiDecisionJournalEntry(
  input: AiDecisionJournalInput,
): AiDecisionJournalEntry {
  const normalized = normalize(input);
  return {
    contractVersion: AI_DECISION_JOURNAL_CONTRACT_VERSION,
    journalId: computeAiDecisionJournalId(normalized),
    ...normalized,
  };
}

export type AiDecisionJournalValidation =
  | { valid: true }
  | { valid: false; code: string; reason: string };

export function validateAiDecisionJournalEntry(
  entry: AiDecisionJournalEntry,
): AiDecisionJournalValidation {
  if (entry.contractVersion !== AI_DECISION_JOURNAL_CONTRACT_VERSION) {
    return { valid: false, code: 'INVALID_DECISION_CONTRACT_VERSION', reason: 'Unknown AI decision journal contract version.' };
  }

  if (!entry.journalId || entry.journalId !== computeAiDecisionJournalId(entry)) {
    return { valid: false, code: 'INVALID_DECISION_JOURNAL_ID', reason: 'Decision journal ID does not match the canonical payload.' };
  }

  if (
    !entry.userId || !entry.botId || !entry.accountId || !entry.cycleId ||
    !entry.code || !entry.reason
  ) {
    return { valid: false, code: 'INVALID_DECISION_IDENTITY', reason: 'Decision identity, code, and reason are required.' };
  }

  if (!['autonomy', 'strategy', 'market_data', 'risk', 'execution'].includes(entry.stage)) {
    return { valid: false, code: 'INVALID_DECISION_STAGE', reason: 'Decision stage is not recognized.' };
  }

  if (!['hold', 'suspend', 'reject', 'approve'].includes(entry.outcome)) {
    return { valid: false, code: 'INVALID_DECISION_OUTCOME', reason: 'Decision outcome is not recognized.' };
  }

  if (entry.side !== null && entry.side !== undefined && entry.side !== 'buy' && entry.side !== 'sell') {
    return { valid: false, code: 'INVALID_DECISION_SIDE', reason: 'Decision side is invalid.' };
  }

  for (const [field, value] of [
    ['confidence', entry.confidence],
    ['positionNotional', entry.positionNotional],
    ['riskAmount', entry.riskAmount],
    ['riskPercentOfAllocation', entry.riskPercentOfAllocation],
    ['riskReward', entry.riskReward],
  ] as const) {
    if (value !== null && value !== undefined && !Number.isFinite(value)) {
      return { valid: false, code: 'INVALID_DECISION_NUMBER', reason: `${field} must be finite when present.` };
    }
  }

  if (
    entry.confidence !== null && entry.confidence !== undefined &&
    (entry.confidence < 0 || entry.confidence > 100)
  ) {
    return { valid: false, code: 'INVALID_DECISION_CONFIDENCE', reason: 'Decision confidence must be within 0–100.' };
  }

  if (entry.marketData) {
    if (!entry.marketData.source || !entry.marketData.observedAt || !Number.isFinite(Date.parse(entry.marketData.observedAt))) {
      return { valid: false, code: 'INVALID_DECISION_MARKET_DATA', reason: 'Decision market-data provenance is incomplete.' };
    }
  }

  if (entry.stage === 'execution' && entry.outcome === 'approve') {
    if (
      !entry.symbol || !entry.side ||
      entry.confidence === null || entry.confidence === undefined ||
      !entry.strategyVersion || !entry.riskEngineVersion ||
      !entry.marketData ||
      entry.marketData.environment !== 'live' ||
      entry.marketData.isSynthetic
    ) {
      return {
        valid: false,
        code: 'INVALID_EXECUTION_APPROVAL_DECISION',
        reason: 'Execution approval requires verified strategy/risk and non-synthetic live-market provenance.',
      };
    }
  }

  return { valid: true };
}
