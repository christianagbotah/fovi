import { describe, it, expect, vi } from 'vitest';
import { processBotCore, type BotRow, type ProcessBotDeps } from '../../../mini-services/auto-trade-engine/process-bot-core';
import { evaluateEngineAccountEligibility } from '@/lib/engine-eligibility';

function createMockDeps(overrides?: Partial<ProcessBotDeps>): ProcessBotDeps {
  return {
    fetchMarketPrice: vi.fn().mockResolvedValue({
      price: 42000, isDemoData: false, environment: 'live' as const,
      source: 'coingecko', observedAt: new Date().toISOString(),
    }),
    fetchCandles: vi.fn().mockResolvedValue({
      candles: Array.from({ length: 50 }, (_, i) => ({
        timestamp: Date.now() - (50 - i) * 4 * 60 * 60 * 1000,
        open: 41000 + i * 10, high: 41100 + i * 10, low: 40900 + i * 10,
        close: 41050 + i * 10, volume: 0,
      })),
      provenance: { environment: 'live' as const, isSynthetic: false, source: 'coingecko', observedAt: new Date().toISOString() },
      volumeAvailable: false,
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
    allSymbols: ['BTC'],
    evaluateEngineAccountEligibility: vi.fn(),
    ...overrides,
  };
}

function makeBotRow(accountOverrides?: Partial<NonNullable<BotRow['account']>>): BotRow {
  return {
    id: 'bot-001', accountId: 'acc-001', name: 'Test Bot', strategy: 'signal_based',
    symbols: 'BTC', timeframe: '4h',
    account: {
      id: 'acc-001', broker: 'demo', accountType: 'demo', isDemo: true,
      isActive: true, apiKey: null, apiSecret: null, passphrase: null,
      ...accountOverrides,
    },
  };
}

describe('processBotCore — eligibility is first', () => {
  it('ineligible live account has zero side effects', async () => {
    const deps = createMockDeps({ evaluateEngineAccountEligibility: vi.fn().mockReturnValue({ eligible: false, reason: 'wrong-broker' }) });
    const result = await processBotCore(makeBotRow({ broker: 'binance', apiKey: 'real-key' }), deps);
    expect(result).toEqual({ processed: false, reason: 'ineligible-account' });
    expect(deps.fetchMarketPrice).not.toHaveBeenCalled();
    expect(deps.fetchCandles).not.toHaveBeenCalled();
    expect(deps.executeTrade).not.toHaveBeenCalled();
    expect(deps.addActivity).not.toHaveBeenCalled();
  });

  it('real eligibility rejects live credentialed account', async () => {
    const deps = createMockDeps({ evaluateEngineAccountEligibility });
    const result = await processBotCore(makeBotRow({ broker: 'binance', apiKey: 'real-key', apiSecret: 'real-secret' }), deps);
    expect(result.processed).toBe(false);
    expect(deps.fetchCandles).not.toHaveBeenCalled();
    expect(deps.executeTrade).not.toHaveBeenCalled();
  });
});

describe('processBotCore — verified data only', () => {
  it('eligible demo account can analyze verified real-market candles', async () => {
    const deps = createMockDeps({
      evaluateEngineAccountEligibility: vi.fn().mockReturnValue({ eligible: true }),
      generateSignal: vi.fn().mockReturnValue(null),
    });
    const result = await processBotCore(makeBotRow(), deps);
    expect(result.processed).toBe(true);
    expect(deps.fetchCandles).toHaveBeenCalled();
  });

  it('demo/synthetic candles are rejected before signal generation', async () => {
    const deps = createMockDeps({
      evaluateEngineAccountEligibility: vi.fn().mockReturnValue({ eligible: true }),
      fetchCandles: vi.fn().mockResolvedValue({
        candles: Array.from({ length: 50 }, (_, i) => ({ timestamp: Date.now() + i, open: 1, high: 2, low: 0.5, close: 1.5, volume: 1 })),
        provenance: { environment: 'demo' as const, isSynthetic: true, source: 'fovi-demo-generator', observedAt: new Date().toISOString() },
      }),
    });
    const result = await processBotCore(makeBotRow(), deps);
    expect(result.processed).toBe(true);
    expect(deps.generateSignal).not.toHaveBeenCalled();
    expect(deps.executeTrade).not.toHaveBeenCalled();
  });

  it('unavailable verified price skips existing-position SL/TP', async () => {
    const positions = new Map<string, {
      id: string; botId: string; accountId: string; symbol: string; side: 'long' | 'short';
      qty: number; avgEntryPrice: number; currentPrice: number; stopLoss: number | null;
      takeProfit: number | null; openedAt: number; unrealizedPnl: number;
    }>();
    positions.set('p1', {
      id: 'p1', botId: 'bot-001', accountId: 'acc-001', symbol: 'BTC', side: 'long',
      qty: 1, avgEntryPrice: 40000, currentPrice: 40000, stopLoss: 39000,
      takeProfit: 45000, openedAt: Date.now(), unrealizedPnl: 0,
    });
    const deps = createMockDeps({
      evaluateEngineAccountEligibility: vi.fn().mockReturnValue({ eligible: true }),
      positions,
      fetchMarketPrice: vi.fn().mockResolvedValue({
        price: 0, isDemoData: false, environment: 'unknown' as const,
        source: 'no-verified-provider', observedAt: new Date().toISOString(),
        dataUnavailable: true, reason: 'MARKET_DATA_UNAVAILABLE',
      }),
      fetchCandles: vi.fn().mockResolvedValue({
        candles: [], provenance: { environment: 'unknown' as const, isSynthetic: true, source: 'no-verified-provider', observedAt: new Date().toISOString() }, dataUnavailable: true,
      }),
    });
    const result = await processBotCore(makeBotRow(), deps);
    expect(result.processed).toBe(true);
    expect(positions.has('p1')).toBe(true);
    expect(deps.callNextJSApi).not.toHaveBeenCalled();
    expect(deps.executeTrade).not.toHaveBeenCalled();
  });

  it('unavailable verified price blocks new-trade execution', async () => {
    const deps = createMockDeps({
      evaluateEngineAccountEligibility: vi.fn().mockReturnValue({ eligible: true }),
      generateSignal: vi.fn().mockReturnValue({ symbol: 'BTC', side: 'buy' as const, confidence: 80, stopLoss: 40000, takeProfit: 45000, reason: 'test signal' }),
      fetchMarketPrice: vi.fn().mockResolvedValue({
        price: 0, isDemoData: false, environment: 'unknown' as const,
        source: 'no-verified-provider', observedAt: new Date().toISOString(),
        dataUnavailable: true, reason: 'MARKET_DATA_UNAVAILABLE',
      }),
    });
    const result = await processBotCore(makeBotRow(), deps);
    expect(result).toEqual({ processed: true, reason: 'market-data-unavailable' });
    expect(deps.calculatePositionSize).not.toHaveBeenCalled();
    expect(deps.executeTrade).not.toHaveBeenCalled();
  });

  it('verified data reaches demo execution dependency only when explicitly enabled in the test', async () => {
    const deps = createMockDeps({
      evaluateEngineAccountEligibility: vi.fn().mockReturnValue({ eligible: true }),
      generateSignal: vi.fn().mockReturnValue({ symbol: 'BTC', side: 'buy' as const, confidence: 80, stopLoss: 40000, takeProfit: 45000, reason: 'RSI oversold' }),
    });
    const result = await processBotCore(makeBotRow(), deps);
    expect(result.processed).toBe(true);
    expect(deps.executeTrade).toHaveBeenCalledTimes(1);
  });
});
