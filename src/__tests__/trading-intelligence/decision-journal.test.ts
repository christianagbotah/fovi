import { describe, expect, it } from 'vitest';
import {
  AI_DECISION_JOURNAL_CONTRACT_VERSION,
  buildAiDecisionJournalEntry,
  computeAiDecisionJournalId,
  validateAiDecisionJournalEntry,
} from '@/lib/trading-intelligence/decision-journal';

function approvedDecision() {
  return {
    userId: 'user-1',
    botId: 'bot-1',
    accountId: 'acc-1',
    cycleId: 'cycle-1',
    stage: 'execution' as const,
    outcome: 'approve' as const,
    code: 'TRADE_APPROVED',
    reason: 'Canonical momentum candidate passed risk controls.',
    symbol: 'btc/usd',
    side: 'buy' as const,
    confidence: 82,
    strategy: 'Momentum',
    timeframe: '4H',
    strategyVersion: 'phase2c-strategy-v1',
    riskEngineVersion: 'phase2c-risk-v1',
    positionNotional: 2000,
    riskAmount: 180,
    riskPercentOfAllocation: 1.8,
    riskReward: 2.2,
    marketData: {
      environment: 'live' as const,
      isSynthetic: false,
      source: 'coingecko',
      observedAt: '2026-09-18T12:00:00.000Z',
    },
  };
}

describe('Phase 2K AI decision journal contract', () => {
  it('normalizes decisions and produces deterministic IDs', () => {
    const first = buildAiDecisionJournalEntry(approvedDecision());
    const second = buildAiDecisionJournalEntry(approvedDecision());

    expect(first).toEqual(second);
    expect(first.contractVersion).toBe(AI_DECISION_JOURNAL_CONTRACT_VERSION);
    expect(first.journalId).toBe(computeAiDecisionJournalId(first));
    expect(first.symbol).toBe('BTC/USD');
    expect(first.strategy).toBe('momentum');
    expect(first.timeframe).toBe('4h');
    expect(validateAiDecisionJournalEntry(first)).toEqual({ valid: true });
  });

  it('detects payload tampering through the deterministic journal ID', () => {
    const entry = buildAiDecisionJournalEntry(approvedDecision());
    const tampered = { ...entry, riskAmount: 999 };

    const result = validateAiDecisionJournalEntry(tampered);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe('INVALID_DECISION_JOURNAL_ID');
  });

  it('rejects execution approval without verified non-synthetic live provenance', () => {
    const entry = buildAiDecisionJournalEntry({
      ...approvedDecision(),
      marketData: {
        environment: 'demo',
        isSynthetic: true,
        source: 'demo-generator',
        observedAt: '2026-09-18T12:00:00.000Z',
      },
    });

    const result = validateAiDecisionJournalEntry(entry);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe('INVALID_EXECUTION_APPROVAL_DECISION');
  });

  it('permits explainable hold decisions without market data', () => {
    const entry = buildAiDecisionJournalEntry({
      userId: 'user-1',
      botId: 'bot-1',
      accountId: 'acc-1',
      cycleId: 'cycle-1',
      stage: 'autonomy',
      outcome: 'hold',
      code: 'NEW_EXPOSURE_COOLDOWN',
      reason: 'The minimum interval between new exposures has not elapsed.',
      supervisorVersion: 'phase2i-autonomy-supervisor-v1',
    });

    expect(validateAiDecisionJournalEntry(entry)).toEqual({ valid: true });
  });
});
