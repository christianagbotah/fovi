// ============================================================
// process-bot-core.test.ts — CR4.3A R7
// Tests processBotCore from auto-trade-engine/process-bot-core.
// Blocker C: eligibility is FIRST — zero side effects for ineligible.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processBotCore, type BotRow, type ProcessBotDeps } from '../../../mini-services/auto-trade-engine/process-bot-core';
import { evaluateEngineAccountEligibility } from '@/lib/engine-eligibility';

// ── Mocked deps factory ──

function createMockDeps(overrides?: Partial<ProcessBotDeps>): ProcessBotDeps {
  return {
    fetchMarketPrice: vi.fn().mockResolvedValue({
      price: 42000,
      isDemoData: true,
      environment: 'demo' as const,
      source: 'fovi-demo-generator',
      observedAt: new Date().toISOString(),
    }),
    fetchCandles: vi.fn().mockResolvedValue({
      candles: Array.from({ length: 50 }, (_, i) => ({
        timestamp: Date.now() - (50 - i) * 60000,
        open: 41000 + i * 10,
        high: 41100 + i * 10,
        low: 40900 + i * 10,
        close: 41050 + i * 10,
        volume: 100,
      })),
      provenance: { environment: 'demo' as const, isSynthetic: true, source: 'fovi-demo-generator', observedAt: new Date().toISOString() },
    }),
    validateEngineProvenance: vi.fn().mockReturnValue({ valid: true }),
    generateSignal: vi.fn().mockReturnValue(null),
    calculatePositionSize: vi.fn().mockReturnValue(0.01),
    updateDCALastBuy: vi.fn(),
    marketPriceDeps: { nextjsApi: 'http://localhost:3000' },
    candleDeps: { nextjsApi: 'http://localhost:3000' },
    positions: new Map(),
    addActivity: vi.fn(),
    callNextJSApi: vi.fn().mockResolvedValue({ ok: true }),
    executeTrade: vi.fn().mockResolvedValue(undefined),
    automatedTradingEnabled: true,
    allSymbols: ['BTC/USDT'],
    evaluateEngineAccountEligibility: vi.fn(),
    ...overrides,
  };
}

function makeBotRow(accountOverrides?: Partial<NonNullable<BotRow['account']>>): BotRow {
  return {
    id: 'bot-001',
    accountId: 'acc-001',
    name: 'Test Bot',
    strategy: 'signal_based',
    symbols: 'BTC/USDT',
    account: {
      id: 'acc-001',
      broker: 'demo',
      accountType: 'demo',
      isDemo: true,
      isActive: true,
      apiKey: null,
      apiSecret: null,
      passphrase: null,
      ...accountOverrides,
    },
  };
}

// ============================================================
// A. Blocker C: eligibility is FIRST
// ============================================================

describe('processBotCore — Blocker C: eligibility is FIRST', () => {
  it('ineligible live account → processed: false, ZERO side effects', async () => {
    const deps = createMockDeps({
      evaluateEngineAccountEligibility: vi.fn().mockReturnValue({
        eligible: false,
        reason: 'wrong-broker',
      }),
    });
    const bot = makeBotRow({ broker: 'binance', apiKey: 'real-key' });

    const result = await processBotCore(bot, deps);

    expect(result).toEqual({ processed: false, reason: 'ineligible-account' });
    expect(deps.evaluateEngineAccountEligibility).toHaveBeenCalledOnce();
    // ZERO side effects beyond eligibility check
    expect(deps.fetchMarketPrice).not.toHaveBeenCalled();
    expect(deps.fetchCandles).not.toHaveBeenCalled();
    expect(deps.generateSignal).not.toHaveBeenCalled();
    expect(deps.executeTrade).not.toHaveBeenCalled();
    expect(deps.callNextJSApi).not.toHaveBeenCalled();
    expect(deps.addActivity).not.toHaveBeenCalled();
    expect(deps.updateDCALastBuy).not.toHaveBeenCalled();
  });

  it('null account → processed: false, reason: ineligible-account', async () => {
    const deps = createMockDeps({
      evaluateEngineAccountEligibility: vi.fn().mockReturnValue({
        eligible: false,
        reason: 'no-account',
      }),
    });
    const bot: BotRow = {
      id: 'bot-002',
      accountId: 'acc-002',
      name: 'No Account Bot',
      strategy: 'signal_based',
      account: null,
    };

    const result = await processBotCore(bot, deps);

    expect(result).toEqual({ processed: false, reason: 'ineligible-account' });
    expect(deps.fetchMarketPrice).not.toHaveBeenCalled();
    expect(deps.fetchCandles).not.toHaveBeenCalled();
    expect(deps.executeTrade).not.toHaveBeenCalled();
    expect(deps.callNextJSApi).not.toHaveBeenCalled();
    expect(deps.addActivity).not.toHaveBeenCalled();
  });

  it('no account → processed: false', async () => {
    const deps = createMockDeps({
      evaluateEngineAccountEligibility: vi.fn().mockReturnValue({
        eligible: false,
        reason: 'no-account',
      }),
    });
    const bot: BotRow = {
      id: 'bot-003',
      accountId: 'acc-003',
      name: 'Empty Bot',
      strategy: 'signal_based',
      account: null,
    };

    const result = await processBotCore(bot, deps);
    expect(result.processed).toBe(false);
  });
});

// ============================================================
// B. Zero side effects for ineligible (detailed verification)
// ============================================================

describe('processBotCore — Zero side effects for ineligible', () => {
  it('verify ALL deps are NOT called for ineligible account', async () => {
    const deps = createMockDeps({
      evaluateEngineAccountEligibility: vi.fn().mockReturnValue({
        eligible: false,
        reason: 'credential-apiKey-not-null',
      }),
    });
    const bot = makeBotRow({ apiKey: 'leaked-key' });

    await processBotCore(bot, deps);

    expect(deps.fetchMarketPrice).not.toHaveBeenCalled();
    expect(deps.fetchCandles).not.toHaveBeenCalled();
    expect(deps.generateSignal).not.toHaveBeenCalled();
    expect(deps.executeTrade).not.toHaveBeenCalled();
    expect(deps.callNextJSApi).not.toHaveBeenCalled();
    expect(deps.addActivity).not.toHaveBeenCalled();
    expect(deps.updateDCALastBuy).not.toHaveBeenCalled();
    expect(deps.validateEngineProvenance).not.toHaveBeenCalled();
    expect(deps.calculatePositionSize).not.toHaveBeenCalled();
  });
});

// ============================================================
// C. Real canonical integration test (§7 — DO NOT mock eligibility)
// ============================================================

describe('processBotCore — §7 canonical integration (real eligibility, no mock)', () => {
  it('live account (broker: binance, apiKey: real) → processed: false, zero side effects', async () => {
    const deps = createMockDeps({
      // CRITICAL: Use the REAL evaluateEngineAccountEligibility
      evaluateEngineAccountEligibility: evaluateEngineAccountEligibility,
    });
    const bot = makeBotRow({ broker: 'binance', apiKey: 'real-key', apiSecret: 'real-secret' });

    const result = await processBotCore(bot, deps);

    expect(result.processed).toBe(false);
    expect(result.reason).toBe('ineligible-account');

    // Verify ZERO side effects
    expect(deps.fetchMarketPrice).not.toHaveBeenCalled();
    expect(deps.fetchCandles).not.toHaveBeenCalled();
    expect(deps.executeTrade).not.toHaveBeenCalled();
    expect(deps.callNextJSApi).not.toHaveBeenCalled();
    expect(deps.addActivity).not.toHaveBeenCalled();
  });
});

// ============================================================
// D. Eligible demo account (mocked signal/trade)
// ============================================================

describe('processBotCore — eligible demo account', () => {
  it('eligible demo → processed: true', async () => {
    const deps = createMockDeps({
      evaluateEngineAccountEligibility: vi.fn().mockReturnValue({ eligible: true }),
      generateSignal: vi.fn().mockReturnValue(null), // no signal → processed but no trade
    });
    const bot = makeBotRow();

    const result = await processBotCore(bot, deps);

    expect(result.processed).toBe(true);
    // fetchCandles is called because the bot is eligible
    expect(deps.fetchCandles).toHaveBeenCalled();
  });

  it('eligible demo with signal → processes trade', async () => {
    const deps = createMockDeps({
      evaluateEngineAccountEligibility: vi.fn().mockReturnValue({ eligible: true }),
      generateSignal: vi.fn().mockReturnValue({
        symbol: 'BTC/USDT',
        side: 'buy',
        confidence: 80,
        stopLoss: 40000,
        takeProfit: 45000,
        reason: 'RSI oversold',
      }),
    });
    const bot = makeBotRow();

    const result = await processBotCore(bot, deps);

    expect(result.processed).toBe(true);
    expect(deps.executeTrade).toHaveBeenCalled();
    expect(deps.addActivity).toHaveBeenCalled();
  });
});
