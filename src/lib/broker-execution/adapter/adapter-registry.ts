// ============================================================
// adapter-registry.ts — Registry of available broker adapters
//
// CONTAINMENT CONTRACT (Phase 1):
//   - All adapter types can be registered (for discovery/capability
//     queries), but only the demo adapter is actually functional.
//   - getAdapter() for non-demo types throws ADAPTER_BLOCKED_PHASE1
//   - No credential exposure through the registry — adapters are
//     constructed without credentials; credentials are injected
//     at connection time via CredentialVault
//   - listProviders() shows all registered types but marks
//     non-demo as "blocked" during Phase 1
//
// ARCHITECTURE:
//   - Adapter factories are registered per providerType
//   - Factories are functions that create adapter instances
//   - The registry does NOT store adapter instances — it creates
//     them on demand (stateless factory pattern)
//   - Provider capabilities are registered separately in
//     the canonical provider registry; this registry knows only the
//     default capabilities for each provider type
// ============================================================

import { v4 as uuidv4 } from 'uuid';
import type {
  BrokerAdapter,
  BrokerProviderType,
} from '@/lib/broker-execution/types/broker-adapter';
import { logSecurityEvent } from '@/lib/trading-policy';
import {
  CANONICAL_PROVIDERS,
  isCanonicalDemoProvider,
} from '@/lib/broker-execution/providers/canonical-providers';
import type {
  ProviderCapabilitySet,
} from '@/lib/broker-execution/types/capabilities';

// ── Adapter factory type ──

/**
 * Factory function that creates a BrokerAdapter instance.
 *
 * Adapters are created WITHOUT credentials. Credentials are
 * injected separately at connection time via CredentialVault
 * to prevent any credential exposure through the registry.
 *
 * @param providerId - Unique provider instance identifier
 */
export type AdapterFactory = (providerId: string) => BrokerAdapter;

// ── Provider info ──

/**
 * Information about a registered provider type.
 */
export interface ProviderInfo {
  /** Provider type classification */
  providerType: BrokerProviderType;
  /** Human-readable name */
  displayName: string;
  /** Description of this provider type */
  description: string;
  /** Whether this provider is currently functional (Phase 1: only demo) */
  isAvailable: boolean;
  /** Reason if not available (e.g., "Phase 1 containment") */
  blockedReason?: string;
  /** Default capabilities for this provider type */
  defaultCapabilities: BrokerProviderType;
}

/**
 * Registration entry for an adapter factory.
 */
interface AdapterRegistration {
  providerType: BrokerProviderType;
  displayName: string;
  description: string;
  factory: AdapterFactory;
  defaultCapabilities: ProviderCapabilitySet | null;
}

/**
 * Error thrown when adapter access is blocked by Phase 1 containment.
 */
export class AdapterBlockedError extends Error {
  public readonly code = 'ADAPTER_BLOCKED_PHASE1';
  public readonly providerType: BrokerProviderType;

  constructor(providerType: BrokerProviderType) {
    super(
      `Phase 1 containment: adapter for provider type "${providerType}" is registered but blocked. ` +
      'Only the demo adapter is functional during Phase 1.',
    );
    this.name = 'AdapterBlockedError';
    this.providerType = providerType;
  }
}

/**
 * Error thrown when an adapter type is not registered.
 */
export class AdapterNotRegisteredError extends Error {
  public readonly code = 'ADAPTER_NOT_REGISTERED';
  public readonly providerType: BrokerProviderType;

  constructor(providerType: BrokerProviderType) {
    super(
      `No adapter registered for provider type "${providerType}".`,
    );
    this.name = 'AdapterNotRegisteredError';
    this.providerType = providerType;
  }
}

// ── AdapterRegistry class ──

/**
 * AdapterRegistry manages the registry of available broker adapters.
 *
 * CONTAINMENT (Phase 1):
 *   - All adapter types can be registered for discovery
 *   - Only the demo adapter is functional
 *   - getAdapter() for non-demo types throws AdapterBlockedError
 *   - No credential exposure — adapters are created without credentials
 *
 * REGISTRATION:
 *   - registerAdapter() registers a factory for a provider type
 *   - Multiple registrations for the same type overwrite the previous
 *   - Default capabilities can be registered alongside the factory
 *
 * LOOKUP:
 *   - getAdapter() creates a new adapter instance via the factory
 *   - listProviders() returns info about all registered types
 *   - getProviderCapabilities() returns default capabilities
 */
export class AdapterRegistry {
  private readonly registrations = new Map<BrokerProviderType, AdapterRegistration>();

  /**
   * Register an adapter factory for a provider type.
   *
   * This does NOT create an adapter instance — it registers the
   * factory for later use. The factory is called by getAdapter().
   *
   * @param providerType - The broker provider type
   * @param factory - Factory function to create adapter instances
   * @param meta - Registration metadata
   */
  registerAdapter(
    providerType: BrokerProviderType,
    factory: AdapterFactory,
    meta: {
      displayName: string;
      description: string;
      defaultCapabilities?: ProviderCapabilitySet;
    },
  ): void {
    const correlationId = uuidv4();

    this.registrations.set(providerType, {
      providerType,
      displayName: meta.displayName,
      description: meta.description,
      factory,
      defaultCapabilities: meta.defaultCapabilities ?? null,
    });

    logSecurityEvent({
      eventType: 'ADAPTER_REGISTERED',
      correlationId,
      reason: `Adapter registered for providerType=${providerType} displayName=${meta.displayName}`,
    });
  }

  /**
   * Get an adapter instance for a provider.
   *
   * PHASE 1 CONTAINMENT:
   *   - Only 'REST_WS' with providerId='demo' (or any adapter where
   *     the provider type is considered demo) is functional
   *   - All other provider types throw AdapterBlockedError
   *   - No credentials are passed to the factory — credentials are
   *     injected separately at connection time
   *
   * @param providerId - Provider instance identifier
   * @param providerType - Provider type classification
   * @throws AdapterBlockedError if non-demo in Phase 1
   * @throws AdapterNotRegisteredError if type not registered
   */
  getAdapter(providerId: string, providerType: BrokerProviderType): BrokerAdapter {
    const correlationId = uuidv4();
    const registration = this.registrations.get(providerType);

    if (!registration) {
      throw new AdapterNotRegisteredError(providerType);
    }

    // Phase 1 containment: only explicitly-demo providers are functional.
    // Demo classification comes from the canonical registry's
    // EXPLICIT isDemo property — never from the provider id, display
    // name, or transport family (REST_WS does NOT imply demo).
    const canonicalDemo = isCanonicalDemoProvider(providerId);
    const isDemo = canonicalDemo === true;

    if (!isDemo) {
      logSecurityEvent({
        eventType: 'ADAPTER_ACCESS_BLOCKED',
        correlationId,
        reason: `Phase 1: adapter access blocked for providerId=${providerId} providerType=${providerType}`,
      });
      throw new AdapterBlockedError(providerType);
    }

    // Create adapter instance via factory (no credentials)
    const adapter = registration.factory(providerId);

    logSecurityEvent({
      eventType: 'ADAPTER_CREATED',
      correlationId,
      reason: `Demo adapter created for providerId=${providerId} providerType=${providerType}`,
    });

    return adapter;
  }

  /**
   * List all registered provider types.
   *
   * Returns info about each type including whether it's
   * currently available (Phase 1: only demo).
   * NO credential information is included.
   */
  listProviders(): ProviderInfo[] {
    const result: ProviderInfo[] = [];

    // Provider availability comes from the canonical registry's
    // EXPLICIT properties — never from display names or transport
    // families (REST_WS does NOT imply demo).
    for (const provider of CANONICAL_PROVIDERS) {
      const isAvailable = provider.isDemo && provider.isConnectionAvailable;

      result.push({
        providerType: provider.providerType as BrokerProviderType,
        displayName: provider.displayName,
        description: `Canonical provider ${provider.providerId}`,
        isAvailable,
        blockedReason: isAvailable
          ? undefined
          : 'Phase 1 containment: only explicitly-demo providers are functional',
        defaultCapabilities: provider.providerType as BrokerProviderType,
      });
    }

    return result;
  }

  /**
   * Get default capabilities for a provider type.
   *
   * Returns the capability set that was registered alongside
   * the adapter factory. For runtime capabilities of a specific
   * connection, use the canonical provider registry.
   *
   * @param providerType - Provider type to query
   * @throws AdapterNotRegisteredError if type not registered
   */
  getProviderCapabilities(providerType: BrokerProviderType): ProviderCapabilitySet | null {
    const registration = this.registrations.get(providerType);
    if (!registration) {
      throw new AdapterNotRegisteredError(providerType);
    }
    return registration.defaultCapabilities;
  }

  /**
   * Check if a provider type is registered.
   */
  isRegistered(providerType: BrokerProviderType): boolean {
    return this.registrations.has(providerType);
  }

  /**
   * Unregister a provider type.
   * Useful for testing or dynamic provider management.
   */
  unregisterAdapter(providerType: BrokerProviderType): boolean {
    return this.registrations.delete(providerType);
  }
}

// ── Singleton instance ──

let _instance: AdapterRegistry | null = null;

export function getAdapterRegistry(): AdapterRegistry {
  if (!_instance) {
    _instance = new AdapterRegistry();
  }
  return _instance;
}

/**
 * Reset the singleton (for testing only).
 */
export function resetAdapterRegistry(): void {
  _instance = null;
}
