import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AUTONOMY_SUPERVISOR_VERSION,
  PAPER_MAX_CONSECUTIVE_CYCLE_FAILURES,
  PAPER_MAX_DRAWDOWN_PCT,
  PAPER_MIN_NEW_EXPOSURE_INTERVAL_MS,
  evaluateAutonomySupervisor,
} from '@/lib/trading-intelligence/autonomy-supervisor';

const baseInput = {
  enabled: true,
  status: 'running',
  allocationAmount: 10_000,
  totalPnl: 250,
  currentOpenPositions: 1,
  maxPositions: 4,
  consecutiveCycleFailures: 0,
  lastTradeAt: '2026-09-18T10:00:00.000Z',
  nowMs: Date.parse('2026-09-18T10:10:00.000Z'),
};

describe('Phase 2I autonomy supervisor', () => {
  it('allows scanning when lifecycle and safety gates are healthy', () => {
    const result = evaluateAutonomySupervisor(baseInput);
    expect(result).toMatchObject({
      action: 'scan',
      code: 'SCAN_ALLOWED',
      supervisorVersion: AUTONOMY_SUPERVISOR_VERSION,
      drawdownPct: 0,
      cooldownRemainingMs: 0,
    });
  });

  it('holds when automation is paused or disabled', () => {
    expect(evaluateAutonomySupervisor({ ...baseInput, status: 'paused' }))
      .toMatchObject({ action: 'hold', code: 'AUTOMATION_NOT_RUNNING' });
    expect(evaluateAutonomySupervisor({ ...baseInput, enabled: false }))
      .toMatchObject({ action: 'hold', code: 'AUTOMATION_NOT_RUNNING' });
  });

  it('suspends new exposure after repeated engine-cycle failures', () => {
    const result = evaluateAutonomySupervisor({
      ...baseInput,
      consecutiveCycleFailures: PAPER_MAX_CONSECUTIVE_CYCLE_FAILURES,
    });
    expect(result).toMatchObject({
      action: 'suspend',
      code: 'ENGINE_FAILURE_CIRCUIT_BREAKER',
    });
  });

  it('suspends new exposure when settled paper drawdown reaches the platform limit', () => {
    const result = evaluateAutonomySupervisor({
      ...baseInput,
      totalPnl: -(baseInput.allocationAmount * PAPER_MAX_DRAWDOWN_PCT / 100),
    });
    expect(result).toMatchObject({
      action: 'suspend',
      code: 'DRAWDOWN_CIRCUIT_BREAKER',
      drawdownPct: PAPER_MAX_DRAWDOWN_PCT,
    });
  });

  it('holds when the maximum paper-position count is already reached', () => {
    const result = evaluateAutonomySupervisor({
      ...baseInput,
      currentOpenPositions: baseInput.maxPositions,
    });
    expect(result).toMatchObject({
      action: 'hold',
      code: 'POSITION_LIMIT_REACHED',
    });
  });

  it('enforces the minimum interval between new autonomous exposures', () => {
    const lastTradeMs = Date.parse('2026-09-18T10:09:30.000Z');
    const result = evaluateAutonomySupervisor({
      ...baseInput,
      lastTradeAt: new Date(lastTradeMs),
      nowMs: Date.parse('2026-09-18T10:10:00.000Z'),
    });
    expect(result).toMatchObject({
      action: 'hold',
      code: 'NEW_EXPOSURE_COOLDOWN',
      cooldownRemainingMs: PAPER_MIN_NEW_EXPOSURE_INTERVAL_MS - 30_000,
    });
  });

  it('never permits a caller to configure a cooldown below the platform minimum', () => {
    const result = evaluateAutonomySupervisor({
      ...baseInput,
      lastTradeAt: '2026-09-18T10:09:30.000Z',
      minNewExposureIntervalMs: 1,
    });
    expect(result).toMatchObject({
      action: 'hold',
      code: 'NEW_EXPOSURE_COOLDOWN',
      cooldownRemainingMs: PAPER_MIN_NEW_EXPOSURE_INTERVAL_MS - 30_000,
    });
  });

  it('fails closed on invalid supervisor state or a future last-trade timestamp', () => {
    expect(evaluateAutonomySupervisor({ ...baseInput, allocationAmount: Number.NaN }))
      .toMatchObject({ action: 'suspend', code: 'INVALID_SUPERVISOR_STATE' });

    expect(evaluateAutonomySupervisor({
      ...baseInput,
      lastTradeAt: '2026-09-18T10:11:00.000Z',
    })).toMatchObject({ action: 'suspend', code: 'INVALID_SUPERVISOR_STATE' });
  });

  it('is deterministic for identical inputs', () => {
    expect(evaluateAutonomySupervisor(baseInput)).toEqual(evaluateAutonomySupervisor(baseInput));
  });

  it('is wired above new-exposure generation while preserving protective exits', () => {
    const source = readFileSync(
      join(process.cwd(), 'mini-services/auto-trade-engine/process-bot-core.ts'),
      'utf8',
    );
    const closeLoopIndex = source.indexOf('for (const pos of botPositions)');
    const supervisorIndex = source.indexOf('evaluateAutonomySupervisor');
    const strategyScanIndex = source.indexOf('let bestSignal');

    expect(source).toContain('autonomy_hold');
    expect(source).toContain('autonomy_suspend');
    expect(source).toContain('consecutiveCycleFailures');
    expect(closeLoopIndex).toBeGreaterThan(-1);
    expect(supervisorIndex).toBeGreaterThan(closeLoopIndex);
    expect(strategyScanIndex).toBeGreaterThan(supervisorIndex);
  });

  it('takes engine failure history from the single-flight cycle coordinator', () => {
    const source = readFileSync(
      join(process.cwd(), 'mini-services/auto-trade-engine/index.ts'),
      'utf8',
    );
    expect(source).toContain('consecutiveCycleFailures: cycleCoordinator.snapshot');
  });
});
