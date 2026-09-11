// ============================================================
// capabilities.ts — Broker capability discovery and profiling
//
// CONTAINMENT CONSTRAINT:
//   Capabilities are discovered BEFORE any execution is possible.
//   A capability being listed as supported does NOT grant
//   permission to execute. The execution boundary (commands.ts
//   + state-machine.ts + kill-switches.ts) must independently
//   approve any command before it reaches the adapter.
//   During Phase 1, the broker factory (broker/factory.ts) only
//   creates demo adapters, so discovered capabilities reflect
//   demo-only functionality regardless of what the provider
//   advertises.
// ============================================================

import type { BrokerProviderType } from './broker-adapter';

// ── Capability enumeration ──

/**
 * Granular capability flags for a broker provider.
 * Each flag represents a discrete feature that the execution
 * boundary can query before constructing a command.
 *
 * Capabilities are discoverable (via BrokerAdapter.discover())
 * but do NOT authorize execution. The execution boundary
 * independently validates every command against policy,
 * kill switches, and account eligibility.
 */
export const BrokerCapability = {
  // ── Read capabilities ──
  ACCOUNT_READ: 'ACCOUNT_READ',
  QUOTES: 'QUOTES',
  POSITIONS_READ: 'POSITIONS_READ',
  ORDERS_READ: 'ORDERS_READ',

  // ── Order type capabilities ──
  MARKET_ORDERS: 'MARKET_ORDERS',
  LIMIT_ORDERS: 'LIMIT_ORDERS',
  STOP_ORDERS: 'STOP_ORDERS',
  STOP_LIMIT_ORDERS: 'STOP_LIMIT_ORDERS',

  // ── Risk management capabilities ──
  STOP_LOSS: 'STOP_LOSS',
  TAKE_PROFIT: 'TAKE_PROFIT',
  TRAILING_STOP: 'TRAILING_STOP',

  // ── Position model capabilities ──
  HEDGING: 'HEDGING',
  NETTING: 'NETTING',

  // ── Streaming capabilities ──
  STREAMING_QUOTES: 'STREAMING_QUOTES',
  STREAMING_ORDERS: 'STREAMING_ORDERS',
  STREAMING_POSITIONS: 'STREAMING_POSITIONS',

  // ── Execution capabilities ──
  PARTIAL_CLOSE: 'PARTIAL_CLOSE',
  MODIFY_ORDER: 'MODIFY_ORDER',
  CANCEL_ORDER: 'CANCEL_ORDER',
  UPDATE_PROTECTION: 'UPDATE_PROTECTION',

  // ── Advanced order capabilities ──
  OCO_ORDERS: 'OCO_ORDERS',
  TIME_IN_FORCE: 'TIME_IN_FORCE',
  MULTI_CLOSE: 'MULTI_CLOSE',
} as const;

export type BrokerCapability =
  (typeof BrokerCapability)[keyof typeof BrokerCapability];

// ── Capability descriptor ──

/**
 * Describes a single capability including whether it is supported,
 * any constraints on its use, and provider-specific limits.
 */
export interface CapabilityDescriptor {
  /** The capability being described */
  capability: BrokerCapability;
  /** Whether this capability is supported by the provider */
  supported: boolean;
  /**
   * Constraints on the capability's use (e.g., "max slippage 50 pips",
   * "not available during market close"). Free-form strings for
   * provider-specific constraints.
   */
  constraints: string[];
  /**
   * Numeric limits for the capability (e.g., max order size,
   * min stop distance, max leverage). Keys are arbitrary;
   * values are always numbers for comparison logic.
   */
  limits: Record<string, number>;
}

// ── Provider capability set ──

/**
 * The full capability profile for a broker provider instance.
 * Populated by BrokerAdapter.discover() and cached for the
 * lifetime of the connection.
 *
 * During Phase 1, only demo provider capabilities are
 * discoverable because the broker factory blocks all
 * non-demo adapter construction.
 */
export interface ProviderCapabilitySet {
  /** Provider instance identifier */
  providerId: string;
  /** Provider connectivity technology */
  providerType: BrokerProviderType;
  /** Map of capability name to its descriptor */
  capabilities: Map<BrokerCapability, CapabilityDescriptor>;
  /** ISO-8601 timestamp when capabilities were last discovered */
  discoveredAt: string;
}

// ── Connection capability set ──

/**
 * Capability set for a specific connection, combining
 * provider-level capabilities with account-specific limits.
 *
 * Account-specific limits may further restrict what the
 * provider supports (e.g., a provider supports OCO_ORDERS
 * but the account tier does not).
 */
export interface ConnectionCapabilitySet {
  /** The connection identifier */
  connectionId: string;
  /** Provider-level capabilities (from discover()) */
  providerCapabilities: ProviderCapabilitySet;
  /**
   * Account-specific limits that may further restrict
   * provider capabilities. Keys match BrokerCapability values;
   * values are CapabilityDescriptors that override or refine
   * the provider-level descriptor.
   */
  accountSpecificLimits: Map<BrokerCapability, CapabilityDescriptor>;
}
