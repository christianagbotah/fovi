// ============================================================
// GET /api/broker-execution/providers
// List available broker providers.
// Public read-only catalog — NO account/user/private information.
//
// CR2 Authorization: PUBLIC (read-only catalog, no private info).
// - No credentials, no connection details, no account-specific data.
// - Returns only: providerId, providerType, name, authType,
//   isActive, isDemo, capabilities
// ============================================================

import { NextResponse } from 'next/server';
import { getAdapterRegistry } from '@/lib/broker-execution/adapter/adapter-registry';

/**
 * Authentication type for a provider.
 * Determines how credentials are exchanged.
 */
type ProviderAuthType = 'API_KEY' | 'OAUTH2' | 'TOKEN' | 'DEMO' | 'CERTIFICATE';

/**
 * Map provider type to its authentication mechanism.
 */
function getAuthType(providerType: string, displayName: string): ProviderAuthType {
  if (displayName.toLowerCase().includes('demo')) return 'DEMO';
  if (providerType === 'OAUTH_API') return 'OAUTH2';
  if (providerType === 'FIX_API') return 'CERTIFICATE';
  return 'API_KEY';
}

/**
 * Map provider type to default capability names.
 * These are structural capabilities — no credential data.
 */
function getDefaultCapabilities(providerType: string): string[] {
  const base = ['ACCOUNT_READ', 'QUOTES', 'POSITIONS_READ', 'ORDERS_READ'];
  switch (providerType) {
    case 'REST_WS':
      return [...base, 'MARKET_ORDERS', 'LIMIT_ORDERS', 'STOP_ORDERS', 'STOP_LIMIT_ORDERS', 'STREAMING_QUOTES', 'STREAMING_ORDERS'];
    case 'MT4':
    case 'MT5':
      return [...base, 'MARKET_ORDERS', 'LIMIT_ORDERS', 'STOP_ORDERS', 'STOP_LOSS', 'TAKE_PROFIT'];
    case 'CTRADER':
      return [...base, 'MARKET_ORDERS', 'LIMIT_ORDERS', 'STOP_ORDERS', 'STOP_LIMIT_ORDERS', 'STOP_LOSS', 'TAKE_PROFIT', 'TRAILING_STOP', 'PARTIAL_CLOSE'];
    case 'FIX_API':
      return [...base, 'MARKET_ORDERS', 'LIMIT_ORDERS'];
    case 'OAUTH_API':
      return [...base, 'MARKET_ORDERS', 'LIMIT_ORDERS', 'STOP_LOSS', 'TAKE_PROFIT'];
    case 'BRIDGE':
      return base;
    default:
      return base;
  }
}

export async function GET() {
  const registry = getAdapterRegistry();
  const providers = registry.listProviders();

  // Public read-only catalog: strip all internal details,
  // no credentials, no connection info, no account-specific data.
  const catalog = providers.map((p) => ({
    providerId: p.providerType, // Provider type serves as the provider identifier in the catalog
    providerType: p.providerType,
    name: p.displayName,
    authType: getAuthType(p.providerType, p.displayName),
    isActive: p.isAvailable,
    isDemo: p.displayName.toLowerCase().includes('demo'),
    capabilities: getDefaultCapabilities(p.providerType),
  }));

  return NextResponse.json({
    providers: catalog,
    phase: '1-containment',
    timestamp: new Date().toISOString(),
  });
}
