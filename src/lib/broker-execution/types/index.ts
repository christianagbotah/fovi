// ============================================================
// index.ts — Barrel export for broker-execution type definitions
//
// This module re-exports all types from the broker-execution
// boundary framework. Import from this barrel for convenience:
//
//   import type { BrokerAdapter, ExecutionCommand, KillSwitch } from '@/lib/broker-execution/types';
//
// CONTAINMENT: All types in this module are pure type definitions.
// No runtime code executes on import. No credentials are
// accessible through these types.
// ============================================================

// ── Broker adapter types ──
export {
  BrokerProviderType,
  BrokerConnectionState,
  EXECUTION_DISABLED,
} from './broker-adapter';

export type {
  BrokerHealthStatus,
  BrokerAccountMetadata,
  Quote,
  BrokerPosition,
  BrokerOrder,
  BrokerAdapterError,
  PlaceOrderParams,
  ModifyOrderParams,
  CancelOrderParams,
  ClosePositionParams,
  PartialCloseParams,
  UpdateProtectionParams,
  BrokerAdapter,
} from './broker-adapter';

// ── Capability types ──
export { BrokerCapability } from './capabilities';

export type {
  CapabilityDescriptor,
  ProviderCapabilitySet,
  ConnectionCapabilitySet,
} from './capabilities';

// ── Command types ──
export {
  CommandType,
  OrderSide,
  OrderType,
  TimeInForce,
} from './commands';

export type {
  BaseCommand,
  PlaceMarketOrderCommand,
  PlacePendingOrderCommand,
  ModifyOrderCommand,
  CancelOrderCommand,
  ClosePositionCommand,
  PartialClosePositionCommand,
  UpdateProtectionCommand,
  ExecutionCommand,
  CommandValidationResult,
} from './commands';

// ── State machine types ──
export {
  ExecutionState,
  ALLOWED_TRANSITIONS,
  TERMINAL_STATES,
  isTerminalState,
  isValidTransition,
} from './state-machine';

export type {
  StateTransition,
  ExecutionStateRecord,
} from './state-machine';

// ── Kill switch types ──
export {
  KillSwitchScope,
  KillSwitchState,
} from './kill-switches';

export type {
  KillSwitch,
  KillSwitchManager,
} from './kill-switches';

// ── Idempotency types ──
export type {
  IdempotencyRecord,
  IdempotencyResult,
} from './idempotency';

// ── Reconciliation types ──
export {
  ReconciliationStatus,
  ReconciliationDiscrepancyType,
} from './reconciliation';

export type {
  DiscrepancySeverity,
  ReconciliationDiscrepancy,
  ReconciliationResult,
} from './reconciliation';

// ── Audit types ──
export { AuditAction } from './audit';

export type {
  IpMetadata,
  AuditRecord,
} from './audit';
