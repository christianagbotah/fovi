import { describe, it, expect, vi } from 'vitest';
import { processBotCore, type BotRow, type EnginePosition, type ProcessBotDeps } from '../../../mini-services/auto-trade-engine/process-bot-core';
import { evaluateEngineAccountEligibility } from '@/lib/engine-eligibility';

function verifiedCandles() {
  return Array.from({ length: 50 }, (_, i) => ({
    timestamp: Date.now() - (50 - i) * 4 * 60 * 60 * 1000,
    open: 41_000 + i * 10,
    high: 41_100 + i * 10,
    low: 40_900 + i * 10,
    close: 41_050 + i * 10,
    volume: 0,
  }));
}

function flatCandles() {
  return Array.from({ length: 50 }, (_, i) => ({
    timestamp: Date.now() - (50 - i) * 4 * 60 * 60 * 1000,
    open: 100, high: 100, low: 100, close: 100, volume: 0,
  }));
}

function createMockDeps(overrides?: Partial<ProcessBotDeps>): ProcessBotDeps {
  return {
    fetchMarketPrice: vi.fn().mockResolvedValue({
      price: 42_000, isDemoData: false, environment: 'live' as const,
      source: 'coingecko', observedAt: new Date().toISOString(),
    }),
    fetchCandles: vi.fn().mockResolvedValue({
      candles: verifiedCandles(),
      provenance: {
        environment: 'live' as const, isSynthetic: false,
        source: 'coingecko', observedAt: new Date().toISOString(),
      },
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
    decisionCycleId: 'cycle-test-001',
    recordDecision: vi.fn().mockResolvedValue(undefined),
    callNextJSApi: vi.fn().mockResolvedValue({ ok: true }),
    executeTrade: vi.fn().mockResolvedValue(undefined),
    closePosition: vi.fn().mockResolvedValue(undefined),
    finalizeAutomationStop: vi.fn().mockResolvedValue(undefined),
    automatedTradingEnabled: false,
    allSymbols: ['BTC'],
    evaluateEngineAccountEligibility: vi.fn(),
    ...overrides,
  };
}

function makeBotRow(accountOverrides?: Partial<NonNullable<BotRow['account']>>): BotRow {
  return {
    id: 'bot-001',
    userId: 'user-001',
    accountId: 'acc-001',
    name: 'Test Bot',
    strategy: 'signal_based',
    symbols: 'BTC',
    timeframe: '4h',
    allocationAmount: 10_000,
    enabled: true,
    status: 'running',
    riskPerTrade: 2,
    maxPositions: 3,
    account: {
      id: 'acc-001', broker: 'demo', accountType: 'demo', isDemo: true,
      balance: 100_000, isActive: true, apiKey: null, apiSecret: null, passphrase: null,
      ...accountOverrides,
    },
  };
}

function openLongPosition(): EnginePosition {
  return {
    id: 'ppos-1', botId: 'bot-001', accountId: 'acc-001', symbol: 'BTC', side: 'long',
    qty: 1, avgEntryPrice: 40_000, currentPrice: 40_000, stopLoss: 39_000,
    takeProfit: 45_000, openedAt: Date.now(), unrealizedPnl: 0,
  };
}

describe('processBotCore — eligibility is first', () => {
  it('ineligible live account has zero side effects', async () => {
    const deps = createMockDeps({
      evaluateEngineAccountEligibility: vi.fn().mockReturnValue({ eligible: false, reason: 'wrong-broker' }),
    });
    const result = await processBotCore(makeBotRow({ broker: 'binance', apiKey: 'real-key' }), deps);
    expect(result).toEqual({ processed: false, reason: 'ineligible-account' });
    expect(deps.fetchMarketPrice).not.toHaveBeenCalled();
    expect(deps.fetchCandles).not.toHaveBeenCalled();
    expect(deps.executeTrade).not.toHaveBeenCalled();
    expect(deps.closePosition).not.toHaveBeenCalled();
    expect(deps.addActivity).not.toHaveBeenCalled();
  });

  it('real eligibility rejects a live credentialed account', async () => {
    const deps = createMockDeps({ evaluateEngineAccountEligibility });
    const result = await processBotCore(
      makeBotRow({ broker: 'binance', apiKey: 'real-key', apiSecret: 'real-secret' }),
      deps,
    );
    expect(result.processed).toBe(false);
    expect(deps.fetchCandles).not.toHaveBeenCalled();
    expect(deps.executeTrade).not.toHaveBeenCalled();
    expect(deps.closePosition).not.toHaveBeenCalled();
  });
});

describe('processBotCore — verified decision boundary', () => {
  it('rejects an unverified timeframe before market-data I/O', async () => {
    const deps = createMockDeps({
      evaluateEngineAccountEligibility: vi.fn().mockReturnValue({ eligible: true }),
    });
    const result = await processBotCore({ ...makeBotRow(), timeframe: '1h' }, deps);
    expect(result).toEqual({ processed: true, reason: 'unsupported-verified-timeframe' });
    expect(deps.fetchCandles).not.toHaveBeenCalled();
    expect(deps.fetchMarketPrice).not.toHaveBeenCalled();
    expect(deps.executeTrade).not.toHaveBeenCalled();
  });

  it('eligible demo account may analyze verified real-market candles', async () => {
    const deps = createMockDeps({
      evaluateEngineAccountEligibility: vi.fn().mockReturnValue({ eligible: true }),
      fetchCandles: vi.fn().mockResolvedValue({
        candles: flatCandles(),
        provenance: {
          environment: 'live' as const, isSynthetic: false,
          source: 'coingecko', observedAt: new Date().toISOString(),
        },
        volumeAvailable: false,
      }),
    });
    const result = await processBotCore(makeBotRow(), deps);
    expect(result.processed).toBe(true);
    expect(deps.fetchCandles).toHaveBeenCalled();
    expect(deps.executeTrade).not.toHaveBeenCalled();
  });

  it('demo/synthetic candles are rejected before any new-trade price lookup', async () => {
    const deps = createMockDeps({
      evaluateEngineAccountEligibility: vi.fn().mockReturnValue({ eligible: true }),
      fetchCandles: vi.fn().mockResolvedValue({
        candles: verifiedCandles(),
        provenance: {
          environment: 'demo' as const, isSynthetic: true,
          source: 'fovi-demo-generator', observedAt: new Date().toISOString(),
        },
      }),
    });
    const result = await processBotCore(makeBotRow(), deps);
    expect(result.processed).toBe(true);
    expect(deps.fetchMarketPrice).not.toHaveBeenCalled();
    expect(deps.executeTrade).not.toHaveBeenCalled();
  });

  it('unavailable verified price skips existing-position SL/TP', async () => {
    const positions = new Map<string, EnginePosition>();
    positions.set('p1', {
      id: 'p1', botId: 'bot-001', accountId: 'acc-001', symbol: 'BTC', side: 'long',
      qty: 1, avgEntryPrice: 40_000, currentPrice: 40_000, stopLoss: 39_000,
      takeProfit: 45_000, openedAt: Date.now(), unrealizedPnl: 0,
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
        candles: [],
        provenance: {
          environment: 'unknown' as const, isSynthetic: true,
          source: 'no-verified-provider', observedAt: new Date().toISOString(),
        },
        dataUnavailable: true,
      }),
    });
    const result = await processBotCore(makeBotRow(), deps);
    expect(result.processed).toBe(true);
    expect(positions.has('p1')).toBe(true);
    expect(deps.closePosition).not.toHaveBeenCalled();
    expect(deps.executeTrade).not.toHaveBeenCalled();
  });

  it('releases a triggered position only after durable close succeeds', async () => {
    const positions = new Map<string, EnginePosition>();
    const position = openLongPosition();
    positions.set(position.id, position);
    const closePosition = vi.fn().mockResolvedValue(undefined);
    const deps = createMockDeps({
      positions,
      closePosition,
      evaluateEngineAccountEligibility: vi.fn().mockReturnValue({ eligible: true }),
      fetchMarketPrice: vi.fn().mockResolvedValue({
        price: 38_500, isDemoData: false, environment: 'live' as const,
        source: 'coingecko', observedAt: new Date().toISOString(),
      }),
      fetchCandles: vi.fn().mockResolvedValue({
        candles: flatCandles(),
        provenance: {
          environment: 'live' as const, isSynthetic: false,
          source: 'coingecko', observedAt: new Date().toISOString(),
        },
        volumeAvailable: false,
      }),
    });

    const result = await processBotCore(makeBotRow(), deps);

    expect(result.processed).toBe(true);
    expect(closePosition).toHaveBeenCalledTimes(1);
    expect(closePosition).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'bot-001' }),
      expect.objectContaining({ id: position.id }),
      expect.objectContaining({ reason: 'stop_loss', price: 38_500 }),
    );
    expect(positions.has(position.id)).toBe(false);
  });

  it('keeps exposure and blocks replacement when durable close fails', async () => {
    const positions = new Map<string, EnginePosition>();
    const position = openLongPosition();
    positions.set(position.id, position);
    const closePosition = vi.fn().mockRejectedValue(new Error('settlement unavailable'));
    const executeTrade = vi.fn().mockResolvedValue(undefined);
    const fetchCandles = vi.fn().mockResolvedValue({
      candles: verifiedCandles(),
      provenance: {
        environment: 'live' as const, isSynthetic: false,
        source: 'coingecko', observedAt: new Date().toISOString(),
      },
      volumeAvailable: false,
    });
    const deps = createMockDeps({
      positions,
      closePosition,
      executeTrade,
      fetchCandles,
      automatedTradingEnabled: true,
      evaluateEngineAccountEligibility: vi.fn().mockReturnValue({ eligible: true }),
      fetchMarketPrice: vi.fn().mockResolvedValue({
        price: 38_500, isDemoData: false, environment: 'live' as const,
        source: 'coingecko', observedAt: new Date().toISOString(),
      }),
    });

    const result = await processBotCore(makeBotRow(), deps);

    expect(result.processed).toBe(true);
    expect(closePosition).toHaveBeenCalledTimes(1);
    expect(positions.has(position.id)).toBe(true);
    expect(fetchCandles).not.toHaveBeenCalled();
    expect(executeTrade).not.toHaveBeenCalled();
    expect(deps.addActivity).toHaveBeenCalledWith(expect.objectContaining({
      type: 'position_close_failed',
      symbol: 'BTC',
    }));
  });

  it('protective paper close still runs before an unsupported decision-timeframe hold', async () => {
    const positions = new Map<string, EnginePosition>();
    const position = openLongPosition();
    positions.set(position.id, position);
    const closePosition = vi.fn().mockResolvedValue(undefined);
    const fetchCandles = vi.fn();

    const deps = createMockDeps({
      positions,
      closePosition,
      fetchCandles,
      evaluateEngineAccountEligibility: vi.fn().mockReturnValue({ eligible: true }),
      fetchMarketPrice: vi.fn().mockResolvedValue({
        price: 38_500, isDemoData: false, environment: 'live' as const,
        source: 'coingecko', observedAt: new Date().toISOString(),
      }),
    });

    const result = await processBotCore(
      { ...makeBotRow(), timeframe: '1h' },
      deps,
    );

    expect(result).toEqual({ processed: true, reason: 'unsupported-verified-timeframe' });
    expect(closePosition).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: position.id }),
      expect.objectContaining({ reason: 'stop_loss', price: 38_500 }),
    );
    expect(positions.has(position.id)).toBe(false);
    expect(fetchCandles).not.toHaveBeenCalled();
    expect(deps.executeTrade).not.toHaveBeenCalled();
  });

  it('a stopping bot closes paper exposure at verified price even when SL/TP is not crossed, then finalizes', async () => {
    const positions = new Map<string, EnginePosition>();
    const position = openLongPosition();
    positions.set(position.id, position);
    const closePosition = vi.fn().mockResolvedValue(undefined);
    const finalizeAutomationStop = vi.fn().mockResolvedValue(undefined);
    const fetchCandles = vi.fn();

    const deps = createMockDeps({
      positions,
      closePosition,
      finalizeAutomationStop,
      fetchCandles,
      evaluateEngineAccountEligibility: vi.fn().mockReturnValue({ eligible: true }),
      fetchMarketPrice: vi.fn().mockResolvedValue({
        price: 40_250, isDemoData: false, environment: 'live' as const,
        source: 'coingecko', observedAt: new Date().toISOString(),
      }),
    });

    const result = await processBotCore(
      { ...makeBotRow(), enabled: false, status: 'stopping' },
      deps,
    );

    expect(result).toEqual({ processed: true, reason: 'automation-stop-complete' });
    expect(closePosition).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'bot-001', status: 'stopping' }),
      expect.objectContaining({ id: position.id }),
      expect.objectContaining({ reason: 'automation_stopped', price: 40_250 }),
    );
    expect(positions.has(position.id)).toBe(false);
    expect(finalizeAutomationStop).toHaveBeenCalledTimes(1);
    expect(fetchCandles).not.toHaveBeenCalled();
    expect(deps.executeTrade).not.toHaveBeenCalled();
  });

  it('a stopping bot never finalizes while a paper close is still failing', async () => {
    const positions = new Map<string, EnginePosition>();
    const position = openLongPosition();
    positions.set(position.id, position);
    const closePosition = vi.fn().mockRejectedValue(new Error('durable settlement unavailable'));
    const finalizeAutomationStop = vi.fn().mockResolvedValue(undefined);

    const deps = createMockDeps({
      positions,
      closePosition,
      finalizeAutomationStop,
      evaluateEngineAccountEligibility: vi.fn().mockReturnValue({ eligible: true }),
      fetchMarketPrice: vi.fn().mockResolvedValue({
        price: 40_250, isDemoData: false, environment: 'live' as const,
        source: 'coingecko', observedAt: new Date().toISOString(),
      }),
    });

    const result = await processBotCore(
      { ...makeBotRow(), enabled: false, status: 'stopping' },
      deps,
    );

    expect(result).toEqual({ processed: true, reason: 'automation-stop-pending' });
    expect(positions.has(position.id)).toBe(true);
    expect(finalizeAutomationStop).not.toHaveBeenCalled();
    expect(deps.fetchCandles).not.toHaveBeenCalled();
    expect(deps.executeTrade).not.toHaveBeenCalled();
  });

  it('durably journals a strategy hold before returning from the decision boundary', async () => {
    const recordDecision = vi.fn().mockResolvedValue(undefined);
    const deps = createMockDeps({
      recordDecision,
      evaluateEngineAccountEligibility: vi.fn().mockReturnValue({ eligible: true }),
    });

    const result = await processBotCore({ ...makeBotRow(), timeframe: '1h' }, deps);

    expect(result).toEqual({ processed: true, reason: 'unsupported-verified-timeframe' });
    expect(recordDecision).toHaveBeenCalledWith(expect.objectContaining({
      contractVersion: 'phase2m-ai-decision-journal-v2',
      cycleId: 'cycle-test-001',
      botId: 'bot-001',
      stage: 'strategy',
      outcome: 'hold',
      code: 'UNSUPPORTED_VERIFIED_TIMEFRAME',
    }));
  });

  it('fails closed on new-exposure decisions when durable journaling is unavailable', async () => {
    const recordDecision = vi.fn().mockRejectedValue(new Error('journal unavailable'));
    const deps = createMockDeps({
      recordDecision,
      evaluateEngineAccountEligibility: vi.fn().mockReturnValue({ eligible: true }),
    });

    await expect(
      processBotCore({ ...makeBotRow(), timeframe: '1h' }, deps),
    ).rejects.toThrow('journal unavailable');
    expect(deps.executeTrade).not.toHaveBeenCalled();
  });

  it('keeps protective closes independent from decision-journal availability', async () => {
    const positions = new Map<string, EnginePosition>();
    const position = openLongPosition();
    positions.set(position.id, position);
    const closePosition = vi.fn().mockResolvedValue(undefined);
    const recordDecision = vi.fn().mockRejectedValue(new Error('journal unavailable'));

    const deps = createMockDeps({
      positions,
      closePosition,
      recordDecision,
      evaluateEngineAccountEligibility: vi.fn().mockReturnValue({ eligible: true }),
      fetchMarketPrice: vi.fn().mockResolvedValue({
        price: 38_500, isDemoData: false, environment: 'live' as const,
        source: 'coingecko', observedAt: new Date().toISOString(),
      }),
    });

    await expect(
      processBotCore({ ...makeBotRow(), timeframe: '1h' }, deps),
    ).rejects.toThrow('journal unavailable');

    expect(closePosition).toHaveBeenCalledTimes(1);
    expect(positions.has(position.id)).toBe(false);
    expect(deps.executeTrade).not.toHaveBeenCalled();
  });

  it('journals a regime hold and blocks new paper exposure for an incompatible grid market', async () => {
    const strongTrend = Array.from({ length: 80 }, (_, i) => {
      const base = 100 + i * 0.2;
      return {
        timestamp: Date.now() - (80 - i) * 4 * 60 * 60 * 1000,
        open: base - 0.05,
        high: base + 0.25,
        low: base - 0.25,
        close: base,
        volume: 1_000 + i,
      };
    });
    const recordDecision = vi.fn().mockResolvedValue(undefined);
    const executeTrade = vi.fn().mockResolvedValue(undefined);
    const deps = createMockDeps({
      recordDecision,
      executeTrade,
      automatedTradingEnabled: true,
      evaluateEngineAccountEligibility: vi.fn().mockReturnValue({ eligible: true }),
      fetchCandles: vi.fn().mockResolvedValue({
        candles: strongTrend,
        provenance: {
          environment: 'live' as const,
          isSynthetic: false,
          source: 'coingecko',
          observedAt: new Date().toISOString(),
        },
        volumeAvailable: true,
      }),
    });

    const result = await processBotCore({ ...makeBotRow(), strategy: 'grid' }, deps);

    expect(result.processed).toBe(true);
    expect(executeTrade).not.toHaveBeenCalled();
    expect(recordDecision).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'strategy',
      outcome: 'hold',
      code: 'REGIME_INCOMPATIBLE',
      marketRegime: expect.stringMatching(/strong_|high_volatility/),
      regimeEngineVersion: 'phase2m-market-regime-v1',
    }));
    expect(deps.addActivity).toHaveBeenCalledWith(expect.objectContaining({
      type: 'regime_hold',
      code: 'REGIME_INCOMPATIBLE',
    }));
  });

  it('legacy signal/sizing hooks cannot force an automated trade', async () => {
    const legacyGenerate = vi.fn().mockReturnValue({
      symbol: 'BTC', side: 'buy' as const, confidence: 99,
      entryPrice: 100, stopLoss: 95, takeProfit: 110, reason: 'legacy forced signal',
    });
    const legacySize = vi.fn().mockReturnValue(999);
    const deps = createMockDeps({
      evaluateEngineAccountEligibility: vi.fn().mockReturnValue({ eligible: true }),
      fetchCandles: vi.fn().mockResolvedValue({
        candles: flatCandles(),
        provenance: {
          environment: 'live' as const, isSynthetic: false,
          source: 'coingecko', observedAt: new Date().toISOString(),
        },
        volumeAvailable: false,
      }),
      generateSignal: legacyGenerate,
      calculatePositionSize: legacySize,
      automatedTradingEnabled: true,
    });

    const result = await processBotCore(makeBotRow(), deps);
    expect(result.processed).toBe(true);
    expect(legacyGenerate).not.toHaveBeenCalled();
    expect(legacySize).not.toHaveBeenCalled();
    expect(deps.executeTrade).not.toHaveBeenCalled();
  });
});
