// ============================================================
// capability-registry.ts — Broker capability discovery and caching
//
// ARCHITECTURE:
//   - CapabilityRegistry manages capability sets for broker
//     connections, combining provider-level capabilities with
//     account-specific limits
//   - Capabilities are discovered from adapters at runtime
//     via discoverCapabilities()
//   - Capability caching with TTL avoids repeated discovery
//   - filterByCapability() enables finding connections that
//     support a specific operation
//
// SECURITY CONTRACT:
//   - Authentication required for connection-specific queries
//   - Capabilities do NOT expose credentials
//   - Capability discovery does NOT authorize execution —
//     the execution boundary independently validates commands
//   - Phase 1: only demo capabilities are discoverable
//
// CACHING:
//   - Discovered capabilities are cached per connection with a TTL
//   - Cache entries are invalidated on reconnection or
//     capability re-registration
//   - Auto-cleanup of expired cache entries
// ============================================================

import { v4 as uuidv4 } from 'uuid';
import type { BrokerAdapter } from '@/lib/broker-execution/types/broker-adapter';
import type {
  BrokerCapability,
  ProviderCapabilitySet,
  ConnectionCapabilitySet,
  CapabilityDescriptor,
} from '@/lib/broker-execution/types/capabilities';
import { logSecurityEvent } from '@/lib/trading-policy';

// ── Cache types ──

/**
 * Cached capability set with TTL tracking.
 */
interface CachedCapabilities {
  capabilities: ConnectionCapabilitySet;
  cachedAt: string;
  ttlMs: number;
}

/**
 * Registration entry for provider-level capabilities.
 */
interface CapabilityRegistration {
  providerId: string;
  capabilities: ProviderCapabilitySet;
  registeredAt: string;
}

// ── Constants ──

/** Default TTL for capability cache entries (5 minutes) */
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;

/** Cleanup interval for expired cache entries (1 minute) */
const CLEANUP_INTERVAL_MS = 60 * 1000;

// ── CapabilityRegistry class ──

/**
 * CapabilityRegistry manages broker capability discovery and caching.
 *
 * CAPABILITY LIFECYCLE:
 *   1. registerCapabilities() — register provider-level capabilities
 *   2. discoverCapabilities() — runtime discovery from an adapter
 *   3. getCapabilities() — retrieve cached capabilities for a connection
 *   4. hasCapability() — check if a connection supports a capability
 *   5. filterByCapability() — find connections with a capability
 *
 * SECURITY:
 *   - No credentials exposed through capability queries
 *   - Authentication context required for connection-specific queries
 *   - Capabilities do NOT authorize execution
 *
 * CACHING:
 *   - Capabilities are cached per connection with TTL
 *   - Expired entries are automatically cleaned up
 *   - Cache is invalidated on re-registration
 */
export class CapabilityRegistry {
  private readonly registrations = new Map<string, CapabilityRegistration>();
  private readonly cache = new Map<string, CachedCapabilities>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly defaultCacheTtlMs: number = DEFAULT_CACHE_TTL_MS,
  ) {
    this.startCleanup();
  }

  /**
   * Register provider-level capabilities for a provider.
   *
   * This is typically called when an adapter is registered
   * (e.g., during application startup). The capabilities
   * describe what the provider type supports in general —
   * account-specific limits are applied later when
   * capabilities are associated with a connection.
   *
   * @param providerId - Provider identifier
   * @param capabilities - Provider capability set
   */
  registerCapabilities(providerId: string, capabilities: ProviderCapabilitySet): void {
    const correlationId = uuidv4();

    this.registrations.set(providerId, {
      providerId,
      capabilities,
      registeredAt: new Date().toISOString(),
    });

    // Invalidate any cached entries for connections using this provider
    for (const [key, cached] of this.cache.entries()) {
      if (cached.capabilities.providerCapabilities.providerId === providerId) {
        this.cache.delete(key);
      }
    }

    logSecurityEvent({
      eventType: 'CAPABILITIES_REGISTERED',
      correlationId,
      reason: `Capabilities registered for providerId=${providerId}`,
    });
  }

  /**
   * Get capabilities for a specific connection.
   *
   * Returns cached capabilities if available and not expired.
   * If no cached entry exists, returns null — the caller
   * should call discoverCapabilities() first.
   *
   * AUTHENTICATION REQUIRED: connectionId queries require
   * tenant verification (enforced by ConnectionManager).
   *
   * @param connectionId - Connection identifier
   */
  getCapabilities(connectionId: string): ConnectionCapabilitySet | null {
    const cached = this.cache.get(connectionId);

    if (!cached) return null;

    // Check TTL
    const cachedAt = new Date(cached.cachedAt).getTime();
    const now = Date.now();
    if (now - cachedAt > cached.ttlMs) {
      this.cache.delete(connectionId);
      return null;
    }

    return cached.capabilities;
  }

  /**
   * Discover capabilities from an adapter at runtime.
   *
   * Calls BrokerAdapter.discover() to retrieve the provider's
   * capability set, then combines it with any account-specific
   * limits to produce a ConnectionCapabilitySet.
   *
   * The result is cached with a TTL for subsequent lookups.
   *
   * Phase 1: Only demo adapters are functional, so only
   * demo capabilities are discoverable.
   *
   * @param adapter - Broker adapter instance
   * @param connectionId - Connection identifier for caching
   * @param accountSpecificLimits - Optional account-specific limits
   */
  async discoverCapabilities(
    adapter: BrokerAdapter,
    connectionId: string,
    accountSpecificLimits?: Map<BrokerCapability, CapabilityDescriptor>,
  ): Promise<ConnectionCapabilitySet> {
    const correlationId = uuidv4();

    // Discover capabilities from the adapter
    const providerCapabilities = await adapter.discover();

    const connectionCapabilities: ConnectionCapabilitySet = {
      connectionId,
      providerCapabilities,
      accountSpecificLimits: accountSpecificLimits ?? new Map(),
    };

    // Cache the result
    this.cache.set(connectionId, {
      capabilities: connectionCapabilities,
      cachedAt: new Date().toISOString(),
      ttlMs: this.defaultCacheTtlMs,
    });

    logSecurityEvent({
      eventType: 'CAPABILITIES_DISCOVERED',
      correlationId,
      reason: `Capabilities discovered and cached for connection=${connectionId} provider=${adapter.providerId}`,
    });

    return connectionCapabilities;
  }

  /**
   * Check if a connection has a specific capability.
   *
   * Returns false if:
   *   - No cached capabilities exist for the connection
   *   - The cache entry is expired
   *   - The capability is not supported
   *   - The capability is supported but has account-specific
   *     constraints that override it
   *
   * @param connectionId - Connection identifier
   * @param capability - The capability to check
   */
  hasCapability(connectionId: string, capability: BrokerCapability): boolean {
    const capabilities = this.getCapabilities(connectionId);
    if (!capabilities) return false;

    // Check provider-level capability
    const providerDescriptor = capabilities.providerCapabilities.capabilities.get(capability);
    if (!providerDescriptor || !providerDescriptor.supported) {
      return false;
    }

    // Check account-specific override
    const accountOverride = capabilities.accountSpecificLimits.get(capability);
    if (accountOverride && !accountOverride.supported) {
      return false;
    }

    return true;
  }

  /**
   * Find all connections that have a specific capability.
   *
   * Iterates through cached capabilities and returns the
   * connection IDs of those that support the capability.
   *
   * Only returns non-expired cache entries.
   *
   * @param capability - The capability to filter by
   */
  filterByCapability(capability: BrokerCapability): string[] {
    const result: string[] = [];
    const now = Date.now();

    for (const [connectionId, cached] of this.cache.entries()) {
      // Skip expired entries
      const cachedAt = new Date(cached.cachedAt).getTime();
      if (now - cachedAt > cached.ttlMs) continue;

      // Check capability support
      const providerDescriptor = cached.capabilities.providerCapabilities.capabilities.get(capability);
      if (!providerDescriptor || !providerDescriptor.supported) continue;

      // Check account-specific override
      const accountOverride = cached.capabilities.accountSpecificLimits.get(capability);
      if (accountOverride && !accountOverride.supported) continue;

      result.push(connectionId);
    }

    return result;
  }

  /**
   * Get the capability descriptor for a specific capability
   * on a connection, including any account-specific constraints.
   */
  getCapabilityDescriptor(
    connectionId: string,
    capability: BrokerCapability,
  ): CapabilityDescriptor | null {
    const capabilities = this.getCapabilities(connectionId);
    if (!capabilities) return null;

    const providerDescriptor = capabilities.providerCapabilities.capabilities.get(capability);
    if (!providerDescriptor) return null;

    // Merge account-specific limits into the descriptor
    const accountOverride = capabilities.accountSpecificLimits.get(capability);
    if (accountOverride) {
      return {
        ...providerDescriptor,
        constraints: [...providerDescriptor.constraints, ...accountOverride.constraints],
        limits: { ...providerDescriptor.limits, ...accountOverride.limits },
      };
    }

    return providerDescriptor;
  }

  /**
   * Invalidate the capability cache for a connection.
   * Should be called when a connection is reconnected or
   * when provider capabilities may have changed.
   */
  invalidateCache(connectionId: string): void {
    this.cache.delete(connectionId);
  }

  /**
   * Get the number of cached capability entries (including expired).
   */
  get cacheSize(): number {
    return this.cache.size;
  }

  /**
   * Get the number of registered provider capability sets.
   */
  get registrationCount(): number {
    return this.registrations.size;
  }

  // ── Lifecycle ──

  /**
   * Start the auto-cleanup timer for expired cache entries.
   */
  private startCleanup(): void {
    if (this.cleanupTimer) return;

    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, cached] of this.cache.entries()) {
        const cachedAt = new Date(cached.cachedAt).getTime();
        if (now - cachedAt > cached.ttlMs) {
          this.cache.delete(key);
        }
      }
    }, CLEANUP_INTERVAL_MS);
  }

  /**
   * Stop the auto-cleanup timer and clear all cached entries.
   * Call this when shutting down to prevent timer leaks.
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.cache.clear();
    this.registrations.clear();
  }
}

// ── Singleton instance ──

let _instance: CapabilityRegistry | null = null;

export function getCapabilityRegistry(): CapabilityRegistry {
  if (!_instance) {
    _instance = new CapabilityRegistry();
  }
  return _instance;
}

/**
 * Reset the singleton (for testing only).
 */
export function resetCapabilityRegistry(): void {
  if (_instance) {
    _instance.destroy();
  }
  _instance = null;
}
