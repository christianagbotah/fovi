// ============================================================
// GET /api/broker-execution/providers
// List available broker providers.
// Public read-only catalog — NO account/user/private information.
//
// CORRECTION ROUND (defect 8): the provider catalog comes from the
// canonical server-side registry. The previous display-name
// heuristic ("name contains 'demo'" → DEMO auth type) is REMOVED —
// demo classification is an explicit trusted registry property.
//
// CR2 Authorization: PUBLIC (read-only catalog, no private info).
// - No credentials, no connection details, no account-specific data.
// - Returns only: providerId, providerType, displayName, authType,
//   isActive/isConnectionAvailable, isDemo, capabilities.
// ============================================================

import { NextResponse } from 'next/server';
import { listPublicProviders } from '@/lib/broker-execution/providers/canonical-providers';

export async function GET() {
  const providers = listPublicProviders();

  return NextResponse.json({
    providers,
    count: providers.length,
    phase: '1-containment',
    note:
      'Only explicitly-demo simulator providers are available for connections in Phase 1. ' +
      'Live providers are registered but unavailable under containment.',
  });
}
