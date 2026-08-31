import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createEngineCycleCoordinator,
  INTERNAL_API_MAX_ATTEMPTS,
  retryDelayMsAfterAttempt,
  shouldRetryInternalApi,
} from '../../../mini-services/auto-trade-engine/engine-reliability';

describe('Phase 2H engine reliability primitives', () => {
  it('keeps the internal retry budget strictly bounded', () => {
    expect(INTERNAL_API_MAX_ATTEMPTS).toBe(3);
    expect(retryDelayMsAfterAttempt(1)).toBe(250);
    expect(retryDelayMsAfterAttempt(2)).toBe(750);
    expect(retryDelayMsAfterAttempt(3)).toBe(750);
  });

  it('retries transient failures for read-only internal GET requests', () => {
    expect(shouldRetryInternalApi({ method: 'GET', path: '/api/trading/engine/positions', attempt: 1, status: 503 })).toBe(true);
    expect(shouldRetryInternalApi({ method: 'GET', path: '/api/trading/engine/bots', attempt: 2, transportError: true })).toBe(true);
    expect(shouldRetryInternalApi({ method: 'GET', path: '/api/trading/engine/bots', attempt: 3, status: 503 })).toBe(false);
  });

  it('retries only deterministic idempotent paper mutation endpoints', () => {
    expect(shouldRetryInternalApi({ method: 'POST', path: '/api/trading/engine/execute', attempt: 1, status: 503 })).toBe(true);
    expect(shouldRetryInternalApi({ method: 'POST', path: '/api/trading/engine/close', attempt: 1, transportError: true })).toBe(true);
    expect(shouldRetryInternalApi({ method: 'POST', path: '/api/trading/engine/report', attempt: 1, status: 503 })).toBe(false);
    expect(shouldRetryInternalApi({ method: 'POST', path: '/api/trading/engine/positions', attempt: 1, status: 503 })).toBe(false);
  });

  it('does not retry permanent client errors', () => {
    for (const status of [400, 401, 403, 404, 409, 422]) {
      expect(shouldRetryInternalApi({ method: 'GET', path: '/api/trading/engine/positions', attempt: 1, status })).toBe(false);
    }
  });

  it('allows only one execution cycle at a time', () => {
    const coordinator = createEngineCycleCoordinator();
    expect(coordinator.tryStartCycle()).toBe(true);
    expect(coordinator.isCycleInProgress()).toBe(true);
    expect(coordinator.tryStartCycle()).toBe(false);

    coordinator.completeCycleSuccess(Date.UTC(2026, 7, 31, 12, 0, 0));
    expect(coordinator.isCycleInProgress()).toBe(false);
    expect(coordinator.tryStartCycle()).toBe(true);
  });

  it('reports degraded readiness after a failed reconciliation cycle and recovers only after success', () => {
    const coordinator = createEngineCycleCoordinator();
    expect(coordinator.snapshot(true).readiness).toBe('starting');

    expect(coordinator.tryStartCycle()).toBe(true);
    coordinator.completeCycleFailure('Position hydration failed', Date.UTC(2026, 7, 31, 12, 1, 0));
    const failed = coordinator.snapshot(true);
    expect(failed.readiness).toBe('degraded');
    expect(failed.consecutiveCycleFailures).toBe(1);
    expect(failed.lastFailureReason).toBe('Position hydration failed');
    expect(failed.lastFailedCycleTime).toBe('2026-08-31T12:01:00.000Z');

    expect(coordinator.tryStartCycle()).toBe(true);
    coordinator.completeCycleSuccess(Date.UTC(2026, 7, 31, 12, 2, 0));
    const recovered = coordinator.snapshot(true);
    expect(recovered.readiness).toBe('ready');
    expect(recovered.consecutiveCycleFailures).toBe(0);
    expect(recovered.lastFailureReason).toBeNull();
    expect(recovered.lastSuccessfulCycleTime).toBe('2026-08-31T12:02:00.000Z');
  });

  it('reports disabled readiness whenever automated execution is contained', () => {
    const coordinator = createEngineCycleCoordinator();
    expect(coordinator.snapshot(false).readiness).toBe('disabled');
    coordinator.tryStartCycle();
    coordinator.completeCycleFailure('ignored for disabled readiness');
    expect(coordinator.snapshot(false).readiness).toBe('disabled');
  });

  it('attests that the runtime integrates single-flight coordination and bounded retries', () => {
    const source = readFileSync(
      join(process.cwd(), 'mini-services/auto-trade-engine/index.ts'),
      'utf8',
    );

    expect(source).toContain('createEngineCycleCoordinator');
    expect(source).toContain('cycleCoordinator.tryStartCycle()');
    expect(source).toContain('ENGINE_CYCLE_ALREADY_RUNNING');
    expect(source).toContain('shouldRetryInternalApi');
    expect(source).toContain('INTERNAL_API_MAX_ATTEMPTS');
    expect(source).toContain("'/api/trading/engine/report'");
    expect(source).toContain('consecutiveCycleFailures');
    expect(source).toContain('lastSuccessfulCycleTime');
  });
});
