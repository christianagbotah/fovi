// ============================================================
// canonical-providers.ts — Server-side canonical broker provider
// registry (CORRECTION ROUND, defect 8).
//
// SECURITY CONTRACT:
//   - The CALLER may identify the desired provider by its stable
//     provider ID only. The SERVER resolves provider type, demo
//     status, availability, authentication mechanism and
//     capabilities from this canonical registry.
//   - `isDemo` is an EXPLICIT trusted property. It is NEVER
//     derived from the provider display name, transport family,
//     or any caller-supplied classification.
//   - REST_WS does NOT imply demo. Live REST/WebSocket providers
//     carry isDemo: false and are unavailable in Phase 1.
//   - Unknown or contradictory provider references are rejected.
//   - Phase 1: only the explicitly-demo 'demo' simulator provider
//     is available for connections. All live providers are
//     registered (so they can be RECOGNIZED and refused) but
//     marked unavailable under Phase 1 containment.
// ============================================================

import type { BrokerCapability } from '@/lib/broker-execution/types/capabilities';

// ── Canonical provider definition ──

/** Authentication mechanism for a provider. */
export type ProviderAuthType = 'API_KEY' | 'OAUTH2' | 'TOKEN' | 'DEMO' | 'CERTIFICATE';

/**
 * A canonical provider entry. This is the single source of truth
 * for provider identity server-side.
 */
export interface CanonicalProvider {
  /** Stable provider identifier (what callers may reference). */
  providerId: string;
  /** Provider transport family (MT4/MT5/CTRADER/FIX_API/REST_WS/OAUTH_API/BRIDGE). */
  providerType: string;
  /** Human-readable display name (NEVER used for classification). */
  displayName: string;
  /** How credentials are exchanged with this provider. */
  authType: ProviderAuthType;
  /**
   * EXPLICIT trusted demo classification. Live REST_WS providers
   * are isDemo: false. Never derived from name or transport.
   */
  isDemo: boolean;
  /** Whether new connections may be created for this provider (Phase 1: demo only). */
  isConnectionAvailable: boolean;
  /** Structural capabilities (no credential data). */
  capabilities: BrokerCapability[];
}

// ── Registry ──

const BASE_CAPABILITIES: BrokerCapability[] = [
  'ACCOUNT_READ',
  'QUOTES',
  'POSITIONS_READ',
  'ORDERS_READ',
] as BrokerCapability[];

/**
 * The canonical provider registry. Order is irrelevant; lookup is
 * by stable providerId.
 *
 * Phase 1 containment:
 *   - 'demo' is the ONLY provider with isConnectionAvailable: true.
 *   - Live providers are listed so the server can RECOGNIZE them
 *     and refuse connections/commands with an explicit reason
 *     (rather than treating them as unknown).
 */
export const CANONICAL_PROVIDERS: readonly CanonicalProvider[] = [
  {
    providerId: 'demo',
    providerType: 'REST_WS',
    displayName: 'Fovi Deterministic Simulator',
    authType: 'DEMO',
    isDemo: true,
    isConnectionAvailable: true,
    capabilities: [
      ...BASE_CAPABILITIES,
      'MARKET_ORDERS',
      'LIMIT_ORDERS',
      'POSITIONS_READ',
      'ORDERS_READ',
    ],
  },
  {
    providerId: 'binance',
    providerType: 'REST_WS',
    displayName: 'Binance',
    authType: 'API_KEY',
    isDemo: false, // REST_WS live provider — explicitly NOT demo
    isConnectionAvailable: false, // Phase 1: live credential intake disabled
    capabilities: [
      ...BASE_CAPABILITIES,
      'MARKET_ORDERS',
      'LIMIT_ORDERS',
      'STOP_ORDERS',
      'STOP_LIMIT_ORDERS',
      'STREAMING_QUOTES',
      'STREAMING_ORDERS',
    ],
  },
  {
    providerId: 'okx',
    providerType: 'REST_WS',
    displayName: 'OKX',
    authType: 'API_KEY',
    isDemo: false, // REST_WS live provider — explicitly NOT demo
    isConnectionAvailable: false,
    capabilities: [
      ...BASE_CAPABILITIES,
      'MARKET_ORDERS',
      'LIMIT_ORDERS',
      'STOP_ORDERS',
      'STOP_LIMIT_ORDERS',
      'STREAMING_QUOTES',
      'STREAMING_ORDERS',
      'TRAILING_STOP',
      'HEDGING',
    ],
  },
  {
    providerId: 'bybit',
    providerType: 'REST_WS',
    displayName: 'Bybit',
    authType: 'API_KEY',
    isDemo: false,
    isConnectionAvailable: false,
    capabilities: [
      ...BASE_CAPABILITIES,
      'MARKET_ORDERS',
      'LIMIT_ORDERS',
      'STREAMING_QUOTES',
      'STREAMING_ORDERS',
    ],
  },
  {
    providerId: 'alpaca',
    providerType: 'REST_WS',
    displayName: 'Alpaca',
    authType: 'OAUTH2',
    isDemo: false,
    isConnectionAvailable: false,
    capabilities: [
      ...BASE_CAPABILITIES,
      'MARKET_ORDERS',
      'LIMIT_ORDERS',
      'STOP_ORDERS',
      'STOP_LIMIT_ORDERS',
    ],
  },
  {
    providerId: 'mt5-live',
    providerType: 'MT5',
    displayName: 'MetaTrader 5 (Live)',
    authType: 'CERTIFICATE',
    isDemo: false,
    isConnectionAvailable: false,
    capabilities: [
      ...BASE_CAPABILITIES,
      'MARKET_ORDERS',
      'LIMIT_ORDERS',
      'STOP_ORDERS',
      'TRAILING_STOP',
      'HEDGING',
    ],
  },
  {
    providerId: 'ctrader',
    providerType: 'CTRADER',
    displayName: 'cTrader',
    authType: 'OAUTH2',
    isDemo: false,
    isConnectionAvailable: false,
    capabilities: [
      ...BASE_CAPABILITIES,
      'MARKET_ORDERS',
      'LIMIT_ORDERS',
      'STOP_ORDERS',
      'STREAMING_QUOTES',
      'STREAMING_ORDERS',
    ],
  },
] as const;

// ── Lookup helpers ──

/** Resolve a canonical provider by its stable provider ID. Null when unknown. */
export function getCanonicalProvider(providerId: string): CanonicalProvider | null {
  if (typeof providerId !== 'string' || providerId.trim() === '') return null;
  const normalized = providerId.trim().toLowerCase();
  return CANONICAL_PROVIDERS.find((p) => p.providerId === normalized) ?? null;
}

/**
 * Resolve the trusted demo classification for a provider ID.
 * Returns null for unknown providers (never a guess).
 * This is the ONLY sanctioned way to classify a provider as demo.
 */
export function isCanonicalDemoProvider(providerId: string): boolean | null {
  const provider = getCanonicalProvider(providerId);
  return provider ? provider.isDemo : null;
}

/** Result of resolving a provider for connection creation. */
export type ProviderResolution =
  | {
      ok: true;
      provider: CanonicalProvider;
    }
  | {
      ok: false;
      status: 400 | 403;
      code: 'PROVIDER_UNKNOWN' | 'PROVIDER_UNAVAILABLE';
      reason: string;
      /** Known-but-refused provider (for logging only, no secrets). */
      provider?: CanonicalProvider;
    };

/**
 * Resolve a provider reference for connection creation.
 *
 * Rejects:
 *   - unknown provider IDs (400)
 *   - providers that are not available under Phase 1 containment (403)
 *
 * Callers may pass optional caller-supplied classifications
 * (isDemo/accountType/providerType) ONLY so the server can detect
 * and REJECT contradictions. Caller values are never trusted.
 */
export function resolveProviderForConnection(
  providerId: string,
  callerClaims?: {
    isDemo?: unknown;
    accountType?: unknown;
    providerType?: unknown;
  },
): ProviderResolution {
  const provider = getCanonicalProvider(providerId);

  if (!provider) {
    return {
      ok: false,
      status: 400,
      code: 'PROVIDER_UNKNOWN',
      reason: `Provider '${providerId}' is not a registered provider.`,
    };
  }

  // Reject contradictory caller claims against canonical truth.
  if (callerClaims) {
    if (
      typeof callerClaims.isDemo === 'boolean' &&
      callerClaims.isDemo !== provider.isDemo
    ) {
      return {
        ok: false,
        status: 400,
        code: 'PROVIDER_UNKNOWN',
        reason: `Contradictory provider classification: provider '${provider.providerId}' is ${provider.isDemo ? 'demo' : 'not demo'} in the canonical registry.`,
        provider,
      };
    }
    if (
      typeof callerClaims.providerType === 'string' &&
      callerClaims.providerType.trim().toUpperCase() !== provider.providerType
    ) {
      return {
        ok: false,
        status: 400,
        code: 'PROVIDER_UNKNOWN',
        reason: `Contradictory provider type: provider '${provider.providerId}' is of type '${provider.providerType}' in the canonical registry.`,
        provider,
      };
    }
    if (
      typeof callerClaims.accountType === 'string' &&
      callerClaims.accountType.trim().toLowerCase() !== (provider.isDemo ? 'demo' : 'live')
    ) {
      return {
        ok: false,
        status: 400,
        code: 'PROVIDER_UNKNOWN',
        reason: `Contradictory account type: provider '${provider.providerId}' canonically maps to a '${provider.isDemo ? 'demo' : 'live'}' account type.`,
        provider,
      };
    }
  }

  if (!provider.isConnectionAvailable) {
    return {
      ok: false,
      status: 403,
      code: 'PROVIDER_UNAVAILABLE',
      reason:
        `Provider '${provider.providerId}' is registered but unavailable under Phase 1 containment. ` +
        'Live broker connections are not permitted.',
      provider,
    };
  }

  return { ok: true, provider };
}

/** Public catalog entry (safe for the public /providers route). */
export interface PublicProviderDTO {
  providerId: string;
  providerType: string;
  displayName: string;
  authType: ProviderAuthType;
  isDemo: boolean;
  isConnectionAvailable: boolean;
  capabilities: BrokerCapability[];
}

/**
 * List the public provider catalog. Contains no user, account,
 * connection, or credential data. Safe for unauthenticated
 * read-only exposure.
 */
export function listPublicProviders(): PublicProviderDTO[] {
  return CANONICAL_PROVIDERS.map((p) => ({
    providerId: p.providerId,
    providerType: p.providerType,
    displayName: p.displayName,
    authType: p.authType,
    isDemo: p.isDemo,
    isConnectionAvailable: p.isConnectionAvailable,
    capabilities: [...p.capabilities],
  }));
}
