/**
 * Broker Execution Framework — Barrel Export
 *
 * This module provides the complete broker-connectivity and execution-subsystem
 * for the Fovi trading platform. All execution is disabled under Phase 1 containment.
 *
 * CRITICAL INVARIANTS:
 * - Real-money execution is DENIED by the central policy gate
 * - Live credential intake is DENIED under Phase 1 containment
 * - No broker adapter may bypass the policy gate
 * - Credentials are never exposed to API responses, logs, or telemetry
 * - PostgreSQL remains the authoritative Prisma datasource
 * - Only /health and /providers endpoints are publicly accessible
 */

// ─── Types ───────────────────────────────────────────────────────────────
export * from './types';

// ─── Adapter Registry ────────────────────────────────────────────────────
export {
  AdapterRegistry,
  AdapterBlockedError,
  AdapterNotRegisteredError,
  getAdapterRegistry,
  resetAdapterRegistry,
  type AdapterFactory,
  type ProviderInfo,
} from './adapter/adapter-registry';

// ─── Capability Registry ─────────────────────────────────────────────────
// REMOVED (correction round, defect 14): the capability-registry TTL cache
// was an unused duplicate store — canonical provider capabilities live in
// providers/canonical-providers.ts (the authoritative source).

// ─── Connection Security ─────────────────────────────────────────────────
export {
  encryptCredentialFields,
  decryptCredentialFields,
  redactCredentials,
  isCredentialRedacted,
  isEncryptedV3,
  CredentialEncryptionFailureError,
  CredentialDecryptionFailureError,
  REDACTED,
  CREDENTIAL_FIELDS,
  type BrokerCredentials,
  type EncryptedCredentialFields,
  type CredentialField,
} from './connection/credential-vault';

export {
  ConnectionManager,
  TenantIsolationError,
  getConnectionManager,
  resetConnectionManager,
  type ConnectionConfig,
  type ConnectionRecord,
  type ConnectionRecordWithCredentials,
  type ConnectionUpdates,
  type ConnectionTestResult,
} from './connection/connection-manager';

export {
  OAuthPKCE,
  getOAuthPKCE,
  resetOAuthPKCE,
  type PKCEChallengePair,
  type OAuthProviderConfig,
  type AuthorizationUrlResult,
  type TokenExchangeResult,
  type TokenRefreshResult,
} from './connection/oauth-pkce';

// ─── Execution ───────────────────────────────────────────────────────────
export {
  ExecutionProvider,
  executionProvider,
  type ExecutionResult,
  type ValidationResult,
} from './execution/execution-provider';

export {
  evaluateExecutionPolicy,
  validateCommandForDryRun,
  POLICY_GATE_CODES,
  type PolicyDecision,
  type PolicyEvaluationContext,
} from './execution/policy-gate';

export {
  generateRequestFingerprint,
} from './execution/idempotency-gate';

export {
  ExecutionStateMachine,
  executionStateMachine,
  InvalidTransitionError,
  TerminalStateError,
} from './execution/state-machine';

// ─── Kill Switches ───────────────────────────────────────────────────────
export {
  evaluateKillSwitches,
  evaluateKillSwitchesByScope,
  activateKillSwitch,
  deactivateKillSwitch,
  emergencyReadOnlyMode,
  getKillSwitchStatus,
  getAllKillSwitches,
} from './kill-switches/kill-switch-manager';

// ─── Reconciliation ──────────────────────────────────────────────────────
export {
  Reconciler,
  type ReconcilerConfig,
  type ReconciliationInput,
  type DiscrepancyResolution,
} from './reconciliation/reconciler';

export {
  ReconciliationStore,
  type StoredReconciliationResult,
  type DiscrepancyListOptions,
} from './reconciliation/reconciliation-store';

// ─── Simulator ───────────────────────────────────────────────────────────
export {
  DeterministicSimulator,
  IS_SIMULATOR,
  type SimConfig,
} from './simulator/deterministic-simulator';

// ─── Observability ───────────────────────────────────────────────────────
export {
  emitTelemetry,
  redactForTelemetry,
  measureLatency,
  measureLatencySync,
  recordQuoteFreshness,
  recordGateDecision,
  recordIdempotencyHit,
  recordReconciliationDiscrepancy,
  type TelemetryEvent,
} from './observability/telemetry';

export {
  AuditTrail,
  auditTrail,
  redactForAudit,
  type AuditEventInput,
  type AuditQueryFilters,
  type AuditAuthContext,
} from './observability/audit-trail';

export { metrics } from './observability/metrics';

// ─── Persistence (PostgreSQL-authoritative) ─────────────────────────
export {
  requireDb,
  ServiceUnavailableError,
  isUniqueViolation,
  isDbUnavailableError,
  persistenceErrorStatus,
} from './persistence/db-access';

export {
  CommandRepository,
  toCommandDTO,
  type ExecutionCommandRow,
  type ExecutionStateTransitionRow,
  type CreateCommandResult,
} from './persistence/command-repository';

export {
  ConnectionRepository,
  toSafeConnectionDTO,
} from './persistence/connection-repository';

export {
  KillSwitchRepository,
  KillSwitchEvaluationUnavailableError,
  GLOBAL_SCOPE_ID,
} from './persistence/kill-switch-repository';

export {
  AuditRepository,
  toAuditDTO,
} from './persistence/audit-repository';

export {
  ReconciliationRepository,
} from './persistence/reconciliation-repository';

export {
  resolveOwnedConnection,
  type BrokerConnectionRow,
  type OwnershipResolution,
} from './security/ownership';

export {
  CANONICAL_PROVIDERS,
  getCanonicalProvider,
  isCanonicalDemoProvider,
  resolveProviderForConnection,
  listPublicProviders,
} from './providers/canonical-providers';
