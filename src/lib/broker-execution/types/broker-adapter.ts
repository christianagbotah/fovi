// ============================================================
// broker-adapter.ts — Provider-neutral broker adapter interface
//
// CONTAINMENT CONSTRAINT:
//   All execution methods (placeOrder, modifyOrder, cancelOrder,
//   closePosition, partialClose, updateProtection) are present in
//   the interface but MUST throw EXECUTION_DISABLED by default.
//   This enforces the Phase 1 containment from trading-policy.ts:
//     - enforceLiveTradingPolicy() blocks all non-demo execution
//     - enforcePhase1CredentialIntake() blocks credential flow
//   The BrokerAdapter interface is the provider-neutral contract
//   that every concrete adapter (demo, MT4, MT5, cTrader, etc.)
//   must implement. During Phase 1, only the demo adapter is
//   instantiated (broker/factory.ts enforces this).
// ============================================================

import type { ProviderCapabilitySet } from './capabilities';

// ── Provider type classification ──

/**
 * Classification of broker connectivity technology.
 * Each provider type implies a different adapter implementation,
 * wire protocol, and capability profile.
 */
export const BrokerProviderType = {
  MT4: 'MT4',
  MT5: 'MT5',
  CTRADER: 'CTRADER',
  FIX_API: 'FIX_API',
  REST_WS: 'REST_WS',
  OAUTH_API: 'OAUTH_API',
  BRIDGE: 'BRIDGE',
} as const;

export type BrokerProviderType =
  (typeof BrokerProviderType)[keyof typeof BrokerProviderType];

// ── Connection lifecycle states ──

/**
 * Lifecycle states of a broker connection.
 *
 * BLOCKED is a terminal-ish state indicating the connection was
 * refused by containment policy (trading-policy.ts). No reconnect
 * attempts should be made while BLOCKED.
 */
export const BrokerConnectionState = {
  DISCONNECTED: 'DISCONNECTED',
  CONNECTING: 'CONNECTING',
  CONNECTED: 'CONNECTED',
  RECONNECTING: 'RECONNECTING',
  DEGRADED: 'DEGRADED',
  FAILED: 'FAILED',
  BLOCKED: 'BLOCKED',
} as const;

export type BrokerConnectionState =
  (typeof BrokerConnectionState)[keyof typeof BrokerConnectionState];

// ── Health monitoring ──

/**
 * Real-time health metrics for a broker connection.
 * Used by the execution boundary to decide whether to submit
 * commands or buffer them pending recovery.
 */
export interface BrokerHealthStatus {
  /** True if the connection is usable for command submission */
  isHealthy: boolean;
  /** Round-trip latency in milliseconds (latest measurement) */
  latencyMs: number;
  /** ISO-8601 timestamp of the most recent quote received */
  lastQuoteAt: string | null;
  /** ISO-8601 timestamp of the most recent ping/pong */
  lastPingAt: string | null;
  /** Rolling error rate (0–1) over the last N operations */
  errorRate: number;
  /** Number of reconnect attempts since last stable connection */
  reconnectCount: number;
}

// ── Account metadata ──

/**
 * Broker-side account metadata retrieved after successful connection.
 * All monetary values are in the account's native currency.
 */
export interface BrokerAccountMetadata {
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  marginLevel: number;
  currency: string;
  leverage: number;
}

// ── Market data types ──

/**
 * A two-sided price quote from the broker.
 * `provenance` traces the quote back to its source for
 * audit and containment verification (see provenance.ts).
 */
export interface Quote {
  bid: number;
  ask: number;
  spread: number;
  timestamp: string;
  /** Provenance marker — links to the data source tracing system */
  provenance: {
    environment: string;
    isSynthetic: boolean;
    source: string;
    observedAt: string;
  };
}

// ── Position representation ──

/**
 * A broker-side open position.
 * Normalized across all provider types for uniform
 * consumption by the execution boundary.
 */
export interface BrokerPosition {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  size: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
  swap: number;
}

// ── Order representation ──

/**
 * A broker-side order (pending, partially filled, or fully filled).
 * Normalized across all provider types.
 */
export interface BrokerOrder {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT' | 'STOP' | 'STOP_LIMIT';
  size: number;
  price: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  status: 'PENDING' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED' | 'REJECTED' | 'EXPIRED';
  fillSize: number;
}

// ── Normalized error ──

/**
 * A provider-neutral error representation.
 * Concrete adapters translate provider-specific error codes
 * into this normalized form for uniform handling by the
 * execution boundary.
 */
export interface BrokerAdapterError {
  code: string;
  message: string;
  providerCode?: string;
  providerMessage?: string;
  isTransient: boolean;
  isRateLimit: boolean;
  isAuthFailure: boolean;
}

// ── Execution method parameter types ──

export interface PlaceOrderParams {
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT' | 'STOP' | 'STOP_LIMIT';
  size: number;
  price?: number;
  stopPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  timeInForce?: 'GTC' | 'IOC' | 'FOK' | 'DAY';
  expireAt?: string;
  comment?: string;
}

export interface ModifyOrderParams {
  brokerOrderId: string;
  newPrice?: number;
  newStopLoss?: number;
  newTakeProfit?: number;
  newSize?: number;
  newStopPrice?: number;
}

export interface CancelOrderParams {
  brokerOrderId: string;
}

export interface ClosePositionParams {
  brokerPositionId: string;
}

export interface PartialCloseParams {
  brokerPositionId: string;
  closeSize: number;
}

export interface UpdateProtectionParams {
  brokerPositionId: string;
  stopLoss?: number;
  takeProfit?: number;
  trailingStop?: boolean;
  trailingStopDistance?: number;
}

// ── Containment error code ──

/**
 * Error code thrown by all execution methods on the base BrokerAdapter.
 * Signals that execution was blocked by the broker-execution boundary.
 * This is distinct from the PHASE1_LIVE_TRADING_DISABLED code in
 * trading-policy.ts — this code originates from the adapter layer
 * itself when a caller bypasses the boundary and invokes an
 * execution method directly on the adapter.
 */
export const EXECUTION_DISABLED = 'EXECUTION_DISABLED' as const;

// ── BrokerAdapter interface ──

/**
 * Provider-neutral broker adapter interface.
 *
 * CONTAINMENT CONTRACT:
 *   - All execution methods (placeOrder, modifyOrder, cancelOrder,
 *     closePosition, partialClose, updateProtection) MUST be present
 *     but MUST throw an error with code EXECUTION_DISABLED by default.
 *   - Concrete adapters that are permitted to execute (only DemoBroker
 *     during Phase 1) override these methods with real implementations.
 *   - The broker factory (broker/factory.ts) enforces that only the
 *     demo adapter is instantiated during Phase 1.
 *   - The trading policy (trading-policy.ts enforceLiveTradingPolicy)
 *     is the outer gate; this interface is the inner gate.
 *
 * Read-only methods (discover, connect, disconnect, reconnect,
 * getAccountMetadata, getQuote, getPositions, getOrders, health,
 * latency) are safe and do not modify trading state.
 */
export interface BrokerAdapter {
  /** Classification of this adapter's connectivity technology */
  readonly providerType: BrokerProviderType;

  /** Unique identifier for this adapter instance (e.g., provider code) */
  readonly providerId: string;

  /**
   * Discovered capabilities for this adapter's provider.
   * Lazy-evaluated: calls discover() on first access if not yet resolved.
   */
  readonly capabilities: ProviderCapabilitySet;

  // ── Connection lifecycle ──

  /**
   * Discover provider capabilities (supported order types, features, limits).
   * Must be called before connect(). Does not require credentials.
   */
  discover(): Promise<ProviderCapabilitySet>;

  /** Establish connection to the broker. Respects containment policy. */
  connect(): Promise<BrokerConnectionState>;

  /** Gracefully disconnect from the broker. */
  disconnect(): Promise<void>;

  /** Attempt to reconnect after a failure or degradation. */
  reconnect(): Promise<BrokerConnectionState>;

  // ── Read-only market & account data ──

  /** Retrieve account-level metadata (balance, equity, margin, etc.) */
  getAccountMetadata(): Promise<BrokerAccountMetadata>;

  /** Get a two-sided quote for a symbol. Includes provenance. */
  getQuote(symbol: string): Promise<Quote>;

  /** List all open positions on the broker. */
  getPositions(): Promise<BrokerPosition[]>;

  /** List all pending/recent orders on the broker. */
  getOrders(): Promise<BrokerOrder[]>;

  // ── Health monitoring ──

  /** Current health status of the connection. */
  health(): BrokerHealthStatus;

  /** Latest round-trip latency in milliseconds. */
  latency(): number;

  // ── Error normalization ──

  /**
   * Translate a provider-specific error into a normalized BrokerAdapterError.
   * Used by the execution boundary for uniform error handling and retry logic.
   */
  normalizeError(error: unknown): BrokerAdapterError;

  // ── Execution methods (CONTAINMENT: throw EXECUTION_DISABLED by default) ──

  /**
   * Place a new order on the broker.
   * @throws {BrokerAdapterError} with code EXECUTION_DISABLED unless
   *         the adapter is explicitly authorized to execute.
   */
  placeOrder(params: PlaceOrderParams): Promise<BrokerOrder>;

  /**
   * Modify an existing pending order.
   * @throws {BrokerAdapterError} with code EXECUTION_DISABLED unless
   *         the adapter is explicitly authorized to execute.
   */
  modifyOrder(params: ModifyOrderParams): Promise<BrokerOrder>;

  /**
   * Cancel a pending order.
   * @throws {BrokerAdapterError} with code EXECUTION_DISABLED unless
   *         the adapter is explicitly authorized to execute.
   */
  cancelOrder(params: CancelOrderParams): Promise<void>;

  /**
   * Close an open position entirely.
   * @throws {BrokerAdapterError} with code EXECUTION_DISABLED unless
   *         the adapter is explicitly authorized to execute.
   */
  closePosition(params: ClosePositionParams): Promise<BrokerOrder>;

  /**
   * Partially close an open position.
   * @throws {BrokerAdapterError} with code EXECUTION_DISABLED unless
   *         the adapter is explicitly authorized to execute.
   */
  partialClose(params: PartialCloseParams): Promise<BrokerOrder>;

  /**
   * Update stop-loss, take-profit, or trailing stop on a position.
   * @throws {BrokerAdapterError} with code EXECUTION_DISABLED unless
   *         the adapter is explicitly authorized to execute.
   */
  updateProtection(params: UpdateProtectionParams): Promise<BrokerPosition>;
}
