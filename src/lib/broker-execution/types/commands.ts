// ============================================================
// commands.ts — Execution command types for the broker-execution boundary
//
// CONTAINMENT CONSTRAINT:
//   Every command entering the execution boundary is validated
//   against:
//     1. trading-policy.ts enforceLiveTradingPolicy() — blocks
//        all non-demo execution unconditionally in Phase 1
//     2. Kill switch evaluation (kill-switches.ts)
//     3. Capability check (capabilities.ts) — provider must
//        support the command type
//     4. Account eligibility (engine-eligibility.ts)
//   Commands that fail validation enter the BLOCKED state
//   (state-machine.ts) and are never forwarded to the adapter.
//   The idempotencyKey ensures duplicate submissions are
//   deduplicated before reaching the adapter.
// ============================================================

// ── Command type classification ──

/**
 * Discriminator for execution command types.
 * Each command type maps to a specific shape and adapter method.
 */
export const CommandType = {
  PLACE_MARKET: 'PLACE_MARKET',
  PLACE_PENDING: 'PLACE_PENDING',
  MODIFY: 'MODIFY',
  CANCEL: 'CANCEL',
  CLOSE_POSITION: 'CLOSE_POSITION',
  PARTIAL_CLOSE: 'PARTIAL_CLOSE',
  UPDATE_PROTECTION: 'UPDATE_PROTECTION',
} as const;

export type CommandType =
  (typeof CommandType)[keyof typeof CommandType];

// ── Order side ──

export const OrderSide = {
  BUY: 'BUY',
  SELL: 'SELL',
} as const;

export type OrderSide = (typeof OrderSide)[keyof typeof OrderSide];

// ── Order type ──

export const OrderType = {
  MARKET: 'MARKET',
  LIMIT: 'LIMIT',
  STOP: 'STOP',
  STOP_LIMIT: 'STOP_LIMIT',
} as const;

export type OrderType = (typeof OrderType)[keyof typeof OrderType];

// ── Time in force ──

export const TimeInForce = {
  GTC: 'GTC',
  IOC: 'IOC',
  FOK: 'FOK',
  DAY: 'DAY',
} as const;

export type TimeInForce = (typeof TimeInForce)[keyof typeof TimeInForce];

// ── Base command ──

/**
 * Fields common to all execution commands.
 *
 * - commandId: Stable UUID assigned at command creation. Never changes.
 * - idempotencyKey: Caller-supplied key for deduplication. The
 *   execution boundary uses this to detect and reject duplicate
 *   submissions (see idempotency.ts).
 * - tenantId: The user/tenant owning this command (from getUserIdSync).
 * - correlationId: Traces the command through the entire lifecycle
 *   (validation → state machine → adapter → reconciliation → audit).
 */
export interface BaseCommand {
  /** Stable UUID assigned at command creation */
  commandId: string;
  /** Caller-supplied idempotency key for deduplication */
  idempotencyKey: string;
  /** Tenant/user ID (from getUserIdSync in get-user-id.ts) */
  tenantId: string;
  /** Trading account ID */
  accountId: string;
  /** Broker provider ID */
  providerId: string;
  /** Correlation ID for end-to-end tracing */
  correlationId: string;
  /** ISO-8601 timestamp when the command was created */
  createdAt: string;
  /** Discriminator for command type */
  commandType: CommandType;
}

// ── Concrete command types ──

/**
 * Command to place a market order (immediate execution at current price).
 * Subject to enforceLiveTradingPolicy() before submission.
 */
export interface PlaceMarketOrderCommand extends BaseCommand {
  commandType: typeof CommandType.PLACE_MARKET;
  symbol: string;
  side: OrderSide;
  size: number;
  stopLoss?: number;
  takeProfit?: number;
  comment?: string;
}

/**
 * Command to place a pending order (limit, stop, or stop-limit).
 * Execution is deferred until market conditions are met.
 * Subject to enforceLiveTradingPolicy() before submission.
 */
export interface PlacePendingOrderCommand extends BaseCommand {
  commandType: typeof CommandType.PLACE_PENDING;
  symbol: string;
  side: OrderSide;
  orderType: OrderType;
  size: number;
  price?: number;
  stopPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  timeInForce?: TimeInForce;
  expireAt?: string;
  comment?: string;
}

/**
 * Command to modify an existing pending order.
 * Subject to enforceLiveTradingPolicy() before submission.
 */
export interface ModifyOrderCommand extends BaseCommand {
  commandType: typeof CommandType.MODIFY;
  brokerOrderId: string;
  newPrice?: number;
  newStopLoss?: number;
  newTakeProfit?: number;
  newSize?: number;
  newStopPrice?: number;
}

/**
 * Command to cancel a pending order.
 * Subject to enforceLiveTradingPolicy() before submission.
 */
export interface CancelOrderCommand extends BaseCommand {
  commandType: typeof CommandType.CANCEL;
  brokerOrderId: string;
  reason?: string;
}

/**
 * Command to close an open position entirely.
 * Subject to enforceLiveTradingPolicy() before submission.
 */
export interface ClosePositionCommand extends BaseCommand {
  commandType: typeof CommandType.CLOSE_POSITION;
  brokerPositionId: string;
}

/**
 * Command to partially close an open position.
 * Subject to enforceLiveTradingPolicy() before submission.
 * closeSize must be > 0 and < current position size.
 */
export interface PartialClosePositionCommand extends BaseCommand {
  commandType: typeof CommandType.PARTIAL_CLOSE;
  brokerPositionId: string;
  closeSize: number;
}

/**
 * Command to update risk protection on a position
 * (stop-loss, take-profit, trailing stop).
 * Subject to enforceLiveTradingPolicy() before submission.
 */
export interface UpdateProtectionCommand extends BaseCommand {
  commandType: typeof CommandType.UPDATE_PROTECTION;
  brokerPositionId: string;
  stopLoss?: number;
  takeProfit?: number;
  trailingStop?: boolean;
  trailingStopDistance?: number;
}

// ── Command union ──

/**
 * Discriminated union of all execution command types.
 * The commandType discriminator enables exhaustive pattern matching
 * in the execution boundary's command handler.
 */
export type ExecutionCommand =
  | PlaceMarketOrderCommand
  | PlacePendingOrderCommand
  | ModifyOrderCommand
  | CancelOrderCommand
  | ClosePositionCommand
  | PartialClosePositionCommand
  | UpdateProtectionCommand;

// ── Validation result ──

/**
 * Result of validating an ExecutionCommand against policy,
 * capabilities, kill switches, and account eligibility.
 *
 * - isValid: true if the command passes all checks.
 * - errors: Blocking validation failures (command will be BLOCKED).
 * - warnings: Non-blocking concerns (command may proceed but should
 *   be logged/alerted).
 * - estimatedImpact: Optional pre-trade impact estimate for
 *   risk-aware approval workflows.
 */
export interface CommandValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  estimatedImpact?: {
    marginRequired: number;
    marginImpactPercent: number;
    maxLoss: number;
    currency: string;
  };
}
