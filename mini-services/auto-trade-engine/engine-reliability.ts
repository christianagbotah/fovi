// ============================================================
// Phase 2H — Auto-Trade Engine Reliability Primitives
// ------------------------------------------------------------
// Deterministic, dependency-free helpers for bounded internal-API retries
// and single-flight execution-cycle coordination. These helpers do not grant
// trading permission and do not perform broker, network, or database I/O.
// ============================================================

export const INTERNAL_API_MAX_ATTEMPTS = 3;
export const INTERNAL_API_RETRY_DELAYS_MS = [250, 750] as const;

const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const IDEMPOTENT_POST_PATHS = new Set([
  '/api/trading/engine/execute',
  '/api/trading/engine/close',
]);

export interface InternalApiRetryInput {
  method: string;
  path: string;
  attempt: number;
  status?: number;
  transportError?: boolean;
}

export function isRetrySafeInternalRequest(method: string, path: string): boolean {
  const normalizedMethod = method.trim().toUpperCase();
  if (normalizedMethod === 'GET') return true;
  return normalizedMethod === 'POST' && IDEMPOTENT_POST_PATHS.has(path);
}

export function shouldRetryInternalApi(input: InternalApiRetryInput): boolean {
  if (input.attempt >= INTERNAL_API_MAX_ATTEMPTS) return false;
  if (!isRetrySafeInternalRequest(input.method, input.path)) return false;
  if (input.transportError) return true;
  return typeof input.status === 'number' && RETRYABLE_HTTP_STATUSES.has(input.status);
}

export function retryDelayMsAfterAttempt(attempt: number): number {
  if (attempt <= 0) return 0;
  return INTERNAL_API_RETRY_DELAYS_MS[Math.min(attempt - 1, INTERNAL_API_RETRY_DELAYS_MS.length - 1)] ?? 0;
}

export type EngineReadinessState = 'disabled' | 'starting' | 'ready' | 'degraded';

export interface EngineReliabilitySnapshot {
  cycleInProgress: boolean;
  consecutiveCycleFailures: number;
  lastSuccessfulCycleTime: string | null;
  lastFailedCycleTime: string | null;
  lastFailureReason: string | null;
  readiness: EngineReadinessState;
}

export interface EngineCycleCoordinator {
  tryStartCycle(): boolean;
  isCycleInProgress(): boolean;
  completeCycleSuccess(atMs?: number): void;
  completeCycleFailure(reason: string, atMs?: number): void;
  snapshot(automatedTradingEnabled: boolean): EngineReliabilitySnapshot;
}

export function createEngineCycleCoordinator(): EngineCycleCoordinator {
  let cycleInProgress = false;
  let consecutiveCycleFailures = 0;
  let lastSuccessfulCycleTime: string | null = null;
  let lastFailedCycleTime: string | null = null;
  let lastFailureReason: string | null = null;

  return {
    tryStartCycle() {
      if (cycleInProgress) return false;
      cycleInProgress = true;
      return true;
    },

    isCycleInProgress() {
      return cycleInProgress;
    },

    completeCycleSuccess(atMs = Date.now()) {
      cycleInProgress = false;
      consecutiveCycleFailures = 0;
      lastSuccessfulCycleTime = new Date(atMs).toISOString();
      lastFailureReason = null;
    },

    completeCycleFailure(reason: string, atMs = Date.now()) {
      cycleInProgress = false;
      consecutiveCycleFailures += 1;
      lastFailedCycleTime = new Date(atMs).toISOString();
      lastFailureReason = reason.trim() || 'Unknown cycle failure';
    },

    snapshot(automatedTradingEnabled: boolean) {
      let readiness: EngineReadinessState;
      if (!automatedTradingEnabled) readiness = 'disabled';
      else if (consecutiveCycleFailures > 0) readiness = 'degraded';
      else if (!lastSuccessfulCycleTime) readiness = 'starting';
      else readiness = 'ready';

      return {
        cycleInProgress,
        consecutiveCycleFailures,
        lastSuccessfulCycleTime,
        lastFailedCycleTime,
        lastFailureReason,
        readiness,
      };
    },
  };
}
