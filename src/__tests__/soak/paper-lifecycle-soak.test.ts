import { describe, expect, it } from 'vitest';
import {
  buildPaperExecutionIntent,
  buildPaperPositionId,
  validatePaperExecutionIntent,
  validatePersistedPaperExecutionResult,
} from '@/lib/trading-intelligence/execution-contract';
import {
  PAPER_SETTLEMENT_ACCOUNTING_VERSION,
  buildPaperCloseIntent,
  buildPaperCloseOrderId,
  buildPaperSettlementId,
  calculatePaperRawPnl,
  validatePaperCloseAgainstPosition,
  validatePaperCloseIntent,
  validatePaperSettlement,
  type PaperSettlementValues,
  type PersistedPaperSettlement,
} from '@/lib/trading-intelligence/position-reconciliation';
import {
  createEngineCycleCoordinator,
  shouldRetryInternalApi,
} from '../../../mini-services/auto-trade-engine/engine-reliability';

const SOAK_LIFECYCLES = 1_000;
const BASE_TIME_MS = Date.UTC(2026, 7, 31, 10, 0, 0);

describe('Phase 2I deterministic paper lifecycle soak', () => {
  it(`reconciles ${SOAK_LIFECYCLES} deterministic open/close/accounting lifecycles without identity or balance drift`, () => {
    const executionIds = new Set<string>();
    const positionIds = new Set<string>();
    const closeOrderIds = new Set<string>();
    const settlementIds = new Set<string>();
    let balance = 100_000;
    let expectedBalance = balance;
    let cumulativeRealizedPnl = 0;
    let cumulativeLevy = 0;

    for (let i = 0; i < SOAK_LIFECYCLES; i++) {
      const observedAtMs = BASE_TIME_MS + i * 1_000;
      const observedAt = new Date(observedAtMs).toISOString();
      const isLong = i % 2 === 0;
      const entryPrice = 1_000 + i * 0.25;
      const quantity = 0.5 + (i % 5) * 0.1;
      const stopLoss = isLong ? entryPrice - 10 : entryPrice + 10;
      const takeProfit = isLong ? entryPrice + 20 : entryPrice - 20;
      const positionNotional = entryPrice * quantity;
      const riskAmount = Math.abs(entryPrice - stopLoss) * quantity;

      const execution = buildPaperExecutionIntent({
        userId: `soak-user-${i % 7}`,
        botId: `soak-bot-${i % 11}`,
        accountId: `soak-account-${i % 7}`,
        symbol: `SOAK${i}`,
        assetType: 'crypto',
        side: isLong ? 'buy' : 'sell',
        quantity,
        referencePrice: entryPrice,
        stopLoss,
        takeProfit,
        confidence: 80,
        strategy: 'balanced',
        timeframe: '4h',
        strategyVersion: 'phase2i-soak-strategy-v1',
        riskEngineVersion: 'phase2i-soak-risk-v1',
        positionNotional,
        riskAmount,
        riskPercentOfAllocation: 0.5,
        riskReward: 2,
        reason: `deterministic-soak-${i}`,
        marketData: {
          environment: 'live',
          isSynthetic: false,
          source: 'verified-soak-fixture',
          observedAt,
        },
      });

      expect(validatePaperExecutionIntent(execution, observedAtMs + 1_000)).toEqual({ valid: true });
      expect(buildPaperExecutionIntent({ ...execution }).executionIntentId).toBe(execution.executionIntentId);
      expect(executionIds.has(execution.executionIntentId)).toBe(false);
      executionIds.add(execution.executionIntentId);

      const positionId = buildPaperPositionId(execution);
      expect(positionIds.has(positionId)).toBe(false);
      positionIds.add(positionId);

      const openingOrder = {
        id: execution.executionIntentId,
        accountId: execution.accountId,
        botId: execution.botId,
        symbol: execution.symbol,
        side: execution.side,
        qty: quantity,
        filledQty: quantity,
        filledPrice: entryPrice,
        status: 'filled',
        aiGenerated: true,
      };
      const openingPosition = {
        id: positionId,
        accountId: execution.accountId,
        botId: execution.botId,
        symbol: execution.symbol,
        side: isLong ? 'long' : 'short',
        qty: quantity,
        avgEntryPrice: entryPrice,
        stopLoss,
        takeProfit,
        status: 'open',
      };
      expect(validatePersistedPaperExecutionResult(execution, openingOrder, openingPosition)).toEqual({
        valid: true,
        positionState: 'open',
      });

      const profitable = i % 3 !== 0;
      const closeReason = profitable ? 'take_profit' : 'stop_loss';
      const exitPrice = isLong
        ? (profitable ? takeProfit + 1 : stopLoss - 1)
        : (profitable ? takeProfit - 1 : stopLoss + 1);

      const close = buildPaperCloseIntent({
        userId: execution.userId,
        botId: execution.botId,
        accountId: execution.accountId,
        positionId,
        symbol: execution.symbol,
        side: isLong ? 'long' : 'short',
        quantity,
        referencePrice: exitPrice,
        reason: closeReason,
        marketData: execution.marketData,
      });

      expect(validatePaperCloseIntent(close, observedAtMs + 1_000)).toEqual({ valid: true });
      expect(validatePaperCloseAgainstPosition(close, {
        id: positionId,
        botId: execution.botId,
        accountId: execution.accountId,
        symbol: execution.symbol,
        side: isLong ? 'long' : 'short',
        qty: quantity,
        avgEntryPrice: entryPrice,
        stopLoss,
        takeProfit,
        status: 'open',
      })).toEqual(expect.objectContaining({ valid: true }));

      const closeOrderId = buildPaperCloseOrderId(positionId);
      const settlementId = buildPaperSettlementId(positionId);
      expect(closeOrderIds.has(closeOrderId)).toBe(false);
      expect(settlementIds.has(settlementId)).toBe(false);
      closeOrderIds.add(closeOrderId);
      settlementIds.add(settlementId);

      const rawPnl = calculatePaperRawPnl(isLong ? 'long' : 'short', entryPrice, exitPrice, quantity);
      const levyPercent = 10;
      const levy = rawPnl > 0 ? rawPnl * (levyPercent / 100) : 0;
      const realizedPnl = rawPnl - levy;
      const balanceBefore = balance;
      const balanceAfter = balanceBefore + realizedPnl;

      const expectedSettlement: PaperSettlementValues = {
        positionId,
        closeOrderId,
        userId: execution.userId,
        accountId: execution.accountId,
        botId: execution.botId,
        symbol: execution.symbol,
        side: isLong ? 'long' : 'short',
        quantity,
        entryPrice,
        exitPrice,
        rawPnl,
        adminLevyPercent: levyPercent,
        adminLevy: levy,
        realizedPnl,
        balanceBefore,
        balanceAfter,
        closeReason,
        marketDataSource: execution.marketData.source,
        marketObservedAt: observedAt,
      };
      const persistedSettlement: PersistedPaperSettlement = {
        id: settlementId,
        ...expectedSettlement,
        side: expectedSettlement.side,
        closeReason: expectedSettlement.closeReason,
      };
      expect(validatePaperSettlement(expectedSettlement, persistedSettlement)).toEqual({ valid: true });

      balance = balanceAfter;
      expectedBalance += realizedPnl;
      cumulativeRealizedPnl += realizedPnl;
      cumulativeLevy += levy;
    }

    expect(executionIds.size).toBe(SOAK_LIFECYCLES);
    expect(positionIds.size).toBe(SOAK_LIFECYCLES);
    expect(closeOrderIds.size).toBe(SOAK_LIFECYCLES);
    expect(settlementIds.size).toBe(SOAK_LIFECYCLES);
    expect(balance).toBeCloseTo(expectedBalance, 8);
    expect(balance).toBeCloseTo(100_000 + cumulativeRealizedPnl, 8);
    expect(cumulativeLevy).toBeGreaterThan(0);
    expect(PAPER_SETTLEMENT_ACCOUNTING_VERSION).toBe('phase2g-paper-settlement-v1');
  });

  it('survives repeated deterministic failure/recovery cycles without overlapping work or unbounded retries', () => {
    const coordinator = createEngineCycleCoordinator();

    for (let i = 1; i <= 500; i++) {
      expect(coordinator.tryStartCycle()).toBe(true);
      expect(coordinator.tryStartCycle()).toBe(false);

      if (i % 25 === 0) {
        coordinator.completeCycleFailure(`fault-${i}`, BASE_TIME_MS + i * 1_000);
        const degraded = coordinator.snapshot(true);
        expect(degraded.readiness).toBe('degraded');
        expect(degraded.consecutiveCycleFailures).toBe(1);
      } else {
        coordinator.completeCycleSuccess(BASE_TIME_MS + i * 1_000);
        expect(coordinator.snapshot(true).readiness).toBe('ready');
      }
    }

    expect(shouldRetryInternalApi({
      method: 'GET', path: '/api/trading/engine/positions', attempt: 1, status: 503,
    })).toBe(true);
    expect(shouldRetryInternalApi({
      method: 'GET', path: '/api/trading/engine/positions', attempt: 3, status: 503,
    })).toBe(false);
    expect(shouldRetryInternalApi({
      method: 'POST', path: '/api/trading/engine/report', attempt: 1, status: 503,
    })).toBe(false);
  });

  it('fails closed on stale market data during soak validation', () => {
    const observedAt = new Date(BASE_TIME_MS).toISOString();
    const execution = buildPaperExecutionIntent({
      userId: 'soak-user', botId: 'soak-bot', accountId: 'soak-account', symbol: 'BTC', assetType: 'crypto',
      side: 'buy', quantity: 1, referencePrice: 100, stopLoss: 95, takeProfit: 110, confidence: 80,
      strategy: 'balanced', timeframe: '4h', strategyVersion: 'soak-v1', riskEngineVersion: 'soak-risk-v1',
      positionNotional: 100, riskAmount: 5, riskPercentOfAllocation: 0.5, riskReward: 2,
      reason: 'stale-data-negative-control',
      marketData: { environment: 'live', isSynthetic: false, source: 'verified-soak-fixture', observedAt },
    });

    const result = validatePaperExecutionIntent(execution, BASE_TIME_MS + 121_000);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe('STALE_MARKET_SNAPSHOT');
  });
});
