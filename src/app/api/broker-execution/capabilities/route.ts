// ============================================================
// GET /api/broker-execution/capabilities
// Query broker capabilities.
//
// CORRECTION ROUND (defects 2, 8): connection-specific capability
// queries resolve the connection from PostgreSQL with PROOF of
// ownership (fail-closed 503 on DB unavailability). Capability
// descriptors come from the canonical provider registry — the
// canonical provider registry is the authoritative source
// optimization only.
//
// Authorization:
//   - connectionId provided → REQUIRES AUTH + ownership
//   - no connectionId (provider-level) → REQUIRES AUTH
// Returns capability sets with no credential data.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getUserIdSync, authRequiredResponse } from '@/lib/get-user-id';
import { logSecurityEvent } from '@/lib/trading-policy';
import { resolveOwnedConnection } from '@/lib/broker-execution/security/ownership';
import {
  getCanonicalProvider,
  listPublicProviders,
} from '@/lib/broker-execution/providers/canonical-providers';
import { persistenceErrorStatus } from '@/lib/broker-execution/persistence/db-access';

export async function GET(req: NextRequest) {
  // This route always requires authentication (connection-specific
  // data is user-scoped; provider-level queries are auth-gated).
  let userId: string;
  try {
    userId = getUserIdSync(req);
  } catch {
    return authRequiredResponse();
  }

  const { searchParams } = new URL(req.url);
  const connectionId = searchParams.get('connectionId');

  // ── Connection-specific capabilities (ownership proven from DB) ──
  if (connectionId) {
    const resolution = await resolveOwnedConnection(connectionId, userId);
    if (!resolution.ok) {
      if (resolution.status === 403) {
        logSecurityEvent({
          eventType: 'CAPABILITY_OWNERSHIP_VIOLATION',
          route: '/api/broker-execution/capabilities',
          userId,
          reason: `Cross-tenant capability query denied for connection=${connectionId}`,
        });
      }
      return NextResponse.json(
        { error: resolution.message, code: resolution.code, remediationPhase: 'containment' },
        { status: resolution.status },
      );
    }
    const connection = resolution.connection;

    // Capabilities from the canonical registry for the
    // connection's provider (trusted server-side resolution).
    const provider = getCanonicalProvider(connection.providerId);
    if (!provider) {
      return NextResponse.json(
        { error: 'Provider for this connection is not registered in the canonical registry.' },
        { status: 404 },
      );
    }

    return NextResponse.json({
      connectionId,
      providerId: provider.providerId,
      providerType: provider.providerType,
      isDemo: provider.isDemo,
      isDemoSource: 'canonical-registry', // explicit trusted property, never name-derived
      capabilities: provider.capabilities,
      note:
        'Phase 1: capabilities are resolved from the canonical provider registry ' +
        '(the authoritative source for provider identity and capabilities).',
    });
  }

  // ── Provider-level capabilities (authenticated, no private data) ──
  const providers = listPublicProviders();
  return NextResponse.json({
    providers: providers.map((p) => ({
      providerId: p.providerId,
      providerType: p.providerType,
      isDemo: p.isDemo,
      isConnectionAvailable: p.isConnectionAvailable,
      capabilities: p.capabilities,
    })),
    count: providers.length,
    phase: '1-containment',
  });
}
