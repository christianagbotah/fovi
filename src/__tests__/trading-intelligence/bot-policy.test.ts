import { describe, expect, it } from 'vitest';
import { validateAutomatedBotConfiguration } from '@/lib/trading-intelligence/bot-policy';

const valid = {
  strategy: 'signal_based',
  timeframe: '4h',
  allocationAmount: 10_000,
  riskPerTrade: 2,
  maxPositions: 3,
  accountBalance: 100_000,
};

describe('Phase 2C automated bot policy', () => {
  it('accepts a canonical verified configuration', () => {
    expect(validateAutomatedBotConfiguration(valid)).toEqual({ valid: true });
  });

  it('rejects unverified timeframes', () => {
    expect(validateAutomatedBotConfiguration({ ...valid, timeframe: '1h' }))
      .toMatchObject({ valid: false, code: 'UNSUPPORTED_VERIFIED_TIMEFRAME' });
  });

  it('rejects unsupported strategies', () => {
    expect(validateAutomatedBotConfiguration({ ...valid, strategy: 'random-winner' }))
      .toMatchObject({ valid: false, code: 'UNSUPPORTED_STRATEGY' });
  });

  it('rejects allocation beyond account balance', () => {
    expect(validateAutomatedBotConfiguration({ ...valid, allocationAmount: 120_000 }))
      .toMatchObject({ valid: false, code: 'ALLOCATION_EXCEEDS_BALANCE' });
  });

  it('rejects risk above 2%', () => {
    expect(validateAutomatedBotConfiguration({ ...valid, riskPerTrade: 5 }))
      .toMatchObject({ valid: false, code: 'RISK_PER_TRADE_EXCEEDS_PLATFORM_CAP' });
  });

  it('rejects invalid max positions', () => {
    expect(validateAutomatedBotConfiguration({ ...valid, maxPositions: 0 }))
      .toMatchObject({ valid: false, code: 'INVALID_MAX_POSITIONS' });
  });
});
