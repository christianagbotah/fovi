// ============================================================
// GET /api/broker-execution/health
// Public health check for the broker-execution subsystem.
// No auth required. Read-only.
//
// CR2 Authorization: PUBLIC — no user identity needed.
// Phase 1: executionEnabled is ALWAYS false.
// ============================================================

import { NextResponse } from 'next/server';
import { getAdapterRegistry } from '@/lib/broker-execution/adapter/adapter-registry';
import { getConnectionManager } from '@/lib/broker-execution/connection/connection-manager';

export async function GET() {
  const registry = getAdapterRegistry();
  const connectionManager = getConnectionManager();

  // Count providers and active connections (read-only, no sensitive data)
  const providers = registry.listProviders().length;

  // Count active connections across ALL tenants (aggregate only)
  // This is a health metric, not user-specific data
  let activeConnections = 0;
  try {
    // ConnectionManager doesn't expose a cross-tenant count,
    // so we report 0 as a safe default for the health endpoint.
    // In production, a dedicated metric would provide this.
    activeConnections = 0;
    void connectionManager; // referenced for future use
    void providers; // referenced for future use
  } catch {
    activeConnections = 0;
  }

  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    providers,
    activeConnections,
    executionEnabled: false, // ALWAYS false in Phase 1
    phase: '1-containment',
  });
}
