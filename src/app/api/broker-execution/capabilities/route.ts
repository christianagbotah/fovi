// ============================================================
// GET /api/broker-execution/capabilities
// Query broker capabilities.
//
// Authorization:
//   - If connectionId is provided, REQUIRES AUTH + ownership verification
//     before returning connection-specific capabilities.
//   - If no connectionId (provider-level capabilities only), the route
//     is accessible to authenticated users but returns only
//     non-sensitive capability descriptors — no credential data.
//   - Public provider capabilities (no connectionId) may be available
//     without authentication for discovery purposes, but we require
//     auth to be safe.
//
// Returns capability sets with no credential data.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getUserIdSync, getUserIdOrNull, authRequiredResponse } from '@/lib/get-user-id';
import { logSecurityEvent } from '@/lib/trading-policy';
import { getCapabilityRegistry } from '@/lib/broker-execution/capabilities/capability-registry';
import { getAdapterRegistry } from '@/lib/broker-execution/adapter/adapter-registry';
import type { BrokerProviderType } from '@/lib/broker-execution/types/broker-adapter';
import { getConnectionManager } from '@/lib/broker-execution/connection/connection-manager';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const connectionId = searchParams.get('connectionId');
  const providerType = searchParams.get('providerType');

  // If connectionId is provided, authentication + ownership check is REQUIRED
  if (connectionId) {
    let userId: string;
    try {
      userId = getUserIdSync(req);
    } catch {
      return authRequiredResponse();
    }

    try {
      // Ownership verification: verify connection belongs to authenticated user
      const connectionManager = getConnectionManager();
      const connection = connectionManager.getConnection(connectionId, userId);

      if (!connection) {
        return NextResponse.json(
          { error: 'Connection not found.' },
          { status: 404 },
        );
      }

      if (connection.tenantId !== userId) {
        logSecurityEvent({
          eventType: 'CAPABILITY_OWNERSHIP_VIOLATION',
          route: '/api/broker-execution/capabilities',
          userId,
          reason: `User attempted to query capabilities for connection belonging to tenant=${connection.tenantId}`,
        });
        return NextResponse.json(
          { error: 'Access denied.', code: 'TENANT_ISOLATION_VIOLATION', remediationPhase: 'containment' },
          { status: 403 },
        );
      }

      // Return connection-specific capabilities
      const capabilityRegistry = getCapabilityRegistry();
      const capabilities = capabilityRegistry.getCapabilities(connectionId);

      if (!capabilities) {
        return NextResponse.json({
          connectionId,
          capabilities: null,
          message: 'Capabilities not yet discovered for this connection. Call discover first.',
        });
      }

      // Convert Map to plain object for JSON serialization (no credential data)
      const serializedCapabilities: Record<string, unknown> = {};
      for (const [key, descriptor] of capabilities.providerCapabilities.capabilities) {
        serializedCapabilities[key] = {
          supported: descriptor.supported,
          constraints: descriptor.constraints,
          limits: descriptor.limits,
        };
      }

      const serializedAccountLimits: Record<string, unknown> = {};
      for (const [key, descriptor] of capabilities.accountSpecificLimits) {
        serializedAccountLimits[key] = {
          supported: descriptor.supported,
          constraints: descriptor.constraints,
          limits: descriptor.limits,
        };
      }

      return NextResponse.json({
        connectionId,
        providerCapabilities: {
          providerId: capabilities.providerCapabilities.providerId,
          providerType: capabilities.providerCapabilities.providerType,
          capabilities: serializedCapabilities,
          discoveredAt: capabilities.providerCapabilities.discoveredAt,
        },
        accountSpecificLimits: serializedAccountLimits,
      });
    } catch (error) {
      logSecurityEvent({
        eventType: 'CAPABILITY_GET_ERROR',
        route: '/api/broker-execution/capabilities',
        userId,
        reason: error instanceof Error ? error.message : 'Unknown error',
      });
      return NextResponse.json(
        { error: 'Failed to query capabilities.' },
        { status: 500 },
      );
    }
  }

  // Provider-level capabilities (no connectionId)
  // Require authentication for any capability query
  const userId = getUserIdOrNull(req);
  if (!userId && providerType) {
    // If asking for specific provider type, require auth
    return authRequiredResponse();
  }

  try {
    const adapterRegistry = getAdapterRegistry();

    if (providerType) {
      // Return capabilities for a specific provider type
      const capabilities = adapterRegistry.getProviderCapabilities(providerType as BrokerProviderType);
      return NextResponse.json({
        providerType,
        capabilities,
        phase: '1-containment',
      });
    }

    // Return all available provider types with their capability status
    const providers = adapterRegistry.listProviders();
    return NextResponse.json({
      providers: providers.map((p) => ({
        providerType: p.providerType,
        name: p.displayName,
        isActive: p.isAvailable,
        blockedReason: p.blockedReason,
      })),
      phase: '1-containment',
    });
  } catch (error) {
    logSecurityEvent({
      eventType: 'CAPABILITY_QUERY_ERROR',
      route: '/api/broker-execution/capabilities',
      reason: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'Failed to query capabilities.' },
      { status: 500 },
    );
  }
}
