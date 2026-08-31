import { describe, expect, it } from 'vitest';
import {
  EXECUTION_CONTRACT_VERSION,
  EXECUTION_MAX_FUTURE_SKEW_MS,
  EXECUTION_MAX_MARKET_SNAPSHOT_AGE_MS,
  buildPaperExecutionIntent,
  buildPaperPositionId,
  validatePaperExecutionIntent,
  type PaperExecutionIntentInput,
} from '@/lib/trading-intelligence/execution-contract';

const NOW = Date.parse('2026-08-31T06:20:00.000Z');

function validInput(overrides: Partial<PaperExecutionIntentInput> = {}): PaperExecutionIntentInput {
  return {
    userId: 'user-1',
    botId: 'bot-1',
    accountId: 'acc-1',
    symbol: 'BTC',
    assetType: 'crypto',
    side: 'buy',
    quantity: 0.1,
    referencePrice: 50_000,
    stopLoss: 49_000,
    takeProfit: 52_000,
    confidence: 80,
    strategy: 'signal_based',
    timeframe: '4h',
    strategyVersion: 'phase2c-strategy-v1',
    riskEngineVersion: 'phase2c-risk-v1',
    positionNotional: 5_000,
    riskAmount: 100,
    riskPercentOfAllocation: 1,
    riskReward: 2,
    reason: 'canonical signal',
    marketData: {
      environment: 'live',
      isSynthetic: false,
      source: 'coingecko',
      observedAt: new Date(NOW - 30_000).toISOString(),
    },
    ...overrides,
  };
}

describe('Phase 2D execution contract', () => {
  it('builds the same deterministic intent ID for the same canonical input', () => {
    const first = buildPaperExecutionIntent(validInput());
    const second = buildPaperExecutionIntent(validInput());

    expect(first.contractVersion).toBe(EXECUTION_CONTRACT_VERSION);
    expect(first.executionIntentId).toBe(second.executionIntentId);
    expect(first.executionIntentId).toMatch(/^pxi_[a-f0-9]{48}$/);
  });

  it('normalizes harmless text casing/whitespace before hashing', () => {
    const first = buildPaperExecutionIntent(validInput());
    const second = buildPaperExecutionIntent(validInput({
      userId: ' user-1 ',
      symbol: ' btc ',
      strategy: ' SIGNAL_BASED ',
      timeframe: ' 4H ',
    }));

    expect(second.userId).toBe('user-1');
    expect(second.symbol).toBe('BTC');
    expect(second.strategy).toBe('signal_based');
    expect(second.timeframe).toBe('4h');
    expect(second.executionIntentId).toBe(first.executionIntentId);
  });

  it('changes the intent ID when a risk/execution-critical field changes', () => {
    const first = buildPaperExecutionIntent(validInput());
    const second = buildPaperExecutionIntent(validInput({ quantity: 0.11 }));

    expect(second.executionIntentId).not.toBe(first.executionIntentId);
  });

  it('rejects payload tampering when the old intent ID is reused', () => {
    const intent = buildPaperExecutionIntent(validInput());
    const tampered = { ...intent, quantity: intent.quantity * 2 };

    expect(validatePaperExecutionIntent(tampered, NOW)).toEqual(expect.objectContaining({
      valid: false,
      code: 'INVALID_INTENT_ID',
    }));
  });

  it('rejects synthetic/demo market provenance', () => {
    const synthetic = buildPaperExecutionIntent(validInput({
      marketData: {
        environment: 'demo',
        isSynthetic: true,
        source: 'fovi-demo-generator',
        observedAt: new Date(NOW - 10_000).toISOString(),
      },
    }));

    expect(validatePaperExecutionIntent(synthetic, NOW)).toEqual(expect.objectContaining({
      valid: false,
      code: 'UNVERIFIED_MARKET_DATA',
    }));
  });

  it('rejects stale verified snapshots', () => {
    const stale = buildPaperExecutionIntent(validInput({
      marketData: {
        environment: 'live',
        isSynthetic: false,
        source: 'coingecko',
        observedAt: new Date(NOW - EXECUTION_MAX_MARKET_SNAPSHOT_AGE_MS - 1).toISOString(),
      },
    }));

    expect(validatePaperExecutionIntent(stale, NOW)).toEqual(expect.objectContaining({
      valid: false,
      code: 'STALE_MARKET_SNAPSHOT',
    }));
  });

  it('rejects market timestamps too far in the future', () => {
    const future = buildPaperExecutionIntent(validInput({
      marketData: {
        environment: 'live',
        isSynthetic: false,
        source: 'coingecko',
        observedAt: new Date(NOW + EXECUTION_MAX_FUTURE_SKEW_MS + 1).toISOString(),
      },
    }));

    expect(validatePaperExecutionIntent(future, NOW)).toEqual(expect.objectContaining({
      valid: false,
      code: 'FUTURE_MARKET_SNAPSHOT',
    }));
  });

  it('accepts a current verified non-synthetic market snapshot', () => {
    const intent = buildPaperExecutionIntent(validInput());
    expect(validatePaperExecutionIntent(intent, NOW)).toEqual({ valid: true });
  });

  it('builds stable paper position IDs scoped by account, bot, and symbol', () => {
    const intent = buildPaperExecutionIntent(validInput());
    expect(buildPaperPositionId(intent)).toBe(buildPaperPositionId(intent));
    expect(buildPaperPositionId(intent)).toMatch(/^ppos_[a-f0-9]{40}$/);

    const otherBot = { ...intent, botId: 'bot-2' };
    expect(buildPaperPositionId(otherBot)).not.toBe(buildPaperPositionId(intent));
  });
});
