// ============================================================
// Phase 2I — Autonomous Paper-Trading Supervisor
// ------------------------------------------------------------
// Pure, deterministic supervisory policy above strategy/risk evaluation.
// It never performs broker I/O, never places orders, and never grants live
// execution permission. Its only job is to decide whether the contained
// paper engine may scan for NEW exposure during the current cycle.
//
// Existing paper positions are still reconciled and allowed to hit their
// persisted stop-loss/take-profit before this supervisor is consulted.
// This guarantees circuit breakers stop NEW exposure without disabling
// protective exits.
// ============================================================

export const AUTONOMY_SUPERVISOR_VERSION = 'phase2i-autonomy-supervisor-v1';

// Paper-only platform safety defaults. Callers may choose a stricter cooldown,
// but may not loosen the hard drawdown/failure thresholds in this version.
export const PAPER_MAX_DRAWDOWN_PCT = 12;
export const PAPER_MAX_CONSECUTIVE_CYCLE_FAILURES = 3;
export const PAPER_MIN_NEW_EXPOSURE_INTERVAL_MS = 60_000;

export type AutonomyAction = 'scan' | 'hold' | 'suspend';

export type AutonomyDecisionCode =
  | 'AUTOMATION_NOT_RUNNING'
  | 'INVALID_SUPERVISOR_STATE'
  | 'ENGINE_FAILURE_CIRCUIT_BREAKER'
  | 'DRAWDOWN_CIRCUIT_BREAKER'
  | 'POSITION_LIMIT_REACHED'
  | 'NEW_EXPOSURE_COOLDOWN'
  | 'SCAN_ALLOWED';

export interface AutonomySupervisorInput {
  enabled: boolean;
  status: string;
  allocationAmount: number;
  /** Net settled P&L already attributed to this bot. */
  totalPnl: number;
  currentOpenPositions: number;
  maxPositions: number;
  consecutiveCycleFailures: number;
  lastTradeAt?: string | Date | null;
  nowMs?: number;
  /**
   * Optional stricter cooldown between new paper exposures.
   * Values below the platform minimum are clamped upward.
   */
  minNewExposureIntervalMs?: number;
}

export interface AutonomySupervisorDecision {
  action: AutonomyAction;
  code: AutonomyDecisionCode;
  reason: string;
  supervisorVersion: typeof AUTONOMY_SUPERVISOR_VERSION;
  drawdownPct: number;
  cooldownRemainingMs: number;
}

function decision(
  action: AutonomyAction,
  code: AutonomyDecisionCode,
  reason: string,
  drawdownPct: number,
  cooldownRemainingMs = 0,
): AutonomySupervisorDecision {
  return {
    action,
    code,
    reason,
    supervisorVersion: AUTONOMY_SUPERVISOR_VERSION,
    drawdownPct,
    cooldownRemainingMs,
  };
}

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}

function parseLastTradeMs(value: string | Date | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function evaluateAutonomySupervisor(
  input: AutonomySupervisorInput,
): AutonomySupervisorDecision {
  const nowMs = input.nowMs ?? Date.now();

  // Lifecycle authority comes first. A stale caller cannot make a stopped or
  // paused bot scan merely by invoking this pure function.
  if (!input.enabled || input.status.trim().toLowerCase() !== 'running') {
    return decision(
      'hold',
      'AUTOMATION_NOT_RUNNING',
      'Automation is not in the enabled/running lifecycle state.',
      0,
    );
  }

  if (
    !isFiniteNumber(nowMs) ||
    !isFiniteNumber(input.allocationAmount) ||
    input.allocationAmount <= 0 ||
    !isFiniteNumber(input.totalPnl) ||
    !Number.isInteger(input.currentOpenPositions) ||
    input.currentOpenPositions < 0 ||
    !Number.isInteger(input.maxPositions) ||
    input.maxPositions <= 0 ||
    !Number.isInteger(input.consecutiveCycleFailures) ||
    input.consecutiveCycleFailures < 0
  ) {
    return decision(
      'suspend',
      'INVALID_SUPERVISOR_STATE',
      'Autonomy supervisor received invalid or non-finite lifecycle/risk state.',
      0,
    );
  }

  const drawdownPct = Math.max(
    0,
    Math.min(100, (-Math.min(0, input.totalPnl) / input.allocationAmount) * 100),
  );

  // Infrastructure instability is a hard circuit breaker. The engine may keep
  // reconciling already-open paper positions in later cycles, but this bot may
  // not create new exposure until the coordinator has recovered.
  if (input.consecutiveCycleFailures >= PAPER_MAX_CONSECUTIVE_CYCLE_FAILURES) {
    return decision(
      'suspend',
      'ENGINE_FAILURE_CIRCUIT_BREAKER',
      `Engine failure circuit breaker engaged after ${input.consecutiveCycleFailures} consecutive failed cycle(s).`,
      drawdownPct,
    );
  }

  // Settled paper losses are evaluated against the configured allocation, not
  // the whole account balance, so one bot cannot consume unrelated capital in
  // the paper model.
  if (drawdownPct >= PAPER_MAX_DRAWDOWN_PCT) {
    return decision(
      'suspend',
      'DRAWDOWN_CIRCUIT_BREAKER',
      `Paper drawdown ${drawdownPct.toFixed(2)}% reached the ${PAPER_MAX_DRAWDOWN_PCT}% supervisor limit.`,
      drawdownPct,
    );
  }

  if (input.currentOpenPositions >= input.maxPositions) {
    return decision(
      'hold',
      'POSITION_LIMIT_REACHED',
      'The bot already has the maximum permitted number of open paper positions.',
      drawdownPct,
    );
  }

  const lastTradeMs = parseLastTradeMs(input.lastTradeAt);
  const configuredCooldown = input.minNewExposureIntervalMs ?? PAPER_MIN_NEW_EXPOSURE_INTERVAL_MS;
  const cooldownMs = Math.max(PAPER_MIN_NEW_EXPOSURE_INTERVAL_MS, configuredCooldown);

  if (!Number.isFinite(cooldownMs) || cooldownMs < 0) {
    return decision(
      'suspend',
      'INVALID_SUPERVISOR_STATE',
      'Autonomy supervisor received an invalid new-exposure cooldown.',
      drawdownPct,
    );
  }

  if (lastTradeMs !== null) {
    const elapsedMs = nowMs - lastTradeMs;
    if (elapsedMs < 0) {
      return decision(
        'suspend',
        'INVALID_SUPERVISOR_STATE',
        'Last trade timestamp is in the future relative to the supervisor clock.',
        drawdownPct,
      );
    }
    if (elapsedMs < cooldownMs) {
      return decision(
        'hold',
        'NEW_EXPOSURE_COOLDOWN',
        'The minimum interval between new autonomous paper exposures has not elapsed.',
        drawdownPct,
        cooldownMs - elapsedMs,
      );
    }
  }

  return decision(
    'scan',
    'SCAN_ALLOWED',
    'Autonomy supervisor permits strategy scanning for a new paper exposure.',
    drawdownPct,
  );
}
