// ============================================================
// GET/POST /api/broker-execution/connections
// Manage broker connections for authenticated users.
//
// GET:  List connections for authenticated user (REQUIRES AUTH)
//       Tenant isolation: only return connections belonging to the user.
//       All responses use safeAccountDTO pattern — strip credentials.
//
// POST: Create new connection (REQUIRES AUTH + enforcePhase1CredentialIntake)
//       Tenant isolation: connection is created for the authenticated user.
//       Credentials are NEVER returned in the response.
//
// Returns 401 if not authenticated.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getUserIdSync, authRequiredResponse } from '@/lib/get-user-id';
import { enforcePhase1CredentialIntake, safeAccountDTO, logSecurityEvent, CONTAINMENT_CODES } from '@/lib/trading-policy';
import { getConnectionManager } from '@/lib/broker-execution/connection/connection-manager';

// ============================================================
// GET — List connections for authenticated user
// ============================================================
export async function GET(req: NextRequest) {
  let userId: string;
  try {
    userId = getUserIdSync(req);
  } catch {
    return authRequiredResponse();
  }

  try {
    const connectionManager = getConnectionManager();

    // Tenant isolation: only return connections belonging to the authenticated user
    const connections = connectionManager.listConnections(userId);

    // Strip any credential-like fields from each connection (defense in depth)
    const safeConnections = connections.map((conn) =>
      safeAccountDTO(conn as unknown as Record<string, unknown>),
    );

    return NextResponse.json({
      connections: safeConnections,
      count: safeConnections.length,
    });
  } catch (error) {
    logSecurityEvent({
      eventType: 'CONNECTIONS_GET_ERROR',
      route: '/api/broker-execution/connections',
      userId,
      reason: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'Failed to fetch connections.' },
      { status: 500 },
    );
  }
}

// ============================================================
// POST — Create a new broker connection
// ============================================================
export async function POST(req: NextRequest) {
  let userId: string;
  try {
    userId = getUserIdSync(req);
  } catch {
    return authRequiredResponse();
  }

  const body = await req.json().catch(() => ({}));
  const providerType = body.providerType || 'REST_WS';
  const providerId = body.providerId || 'demo';
  const name = body.name || `Connection ${new Date().toISOString()}`;
  const broker = body.broker || 'demo';
  const accountType = body.accountType || 'demo';
  const isDemo = broker === 'demo' && accountType === 'demo' ? true : false;

  // ── Phase 1 CONTAINMENT: Unconditionally block non-demo credential intake ──
  const intakeCheck = enforcePhase1CredentialIntake(broker, accountType, isDemo);
  if (intakeCheck.blocked) return intakeCheck.response;

  try {
    const connectionManager = getConnectionManager();

    const connection = await connectionManager.createConnection({
      tenantId: userId,
      providerType,
      providerId,
      name,
      credentials: {
        // Demo connections don't need real credentials
        apiKey: '',
        apiSecret: '',
        passphrase: '',
      },
      accountContext: {
        broker,
        accountType,
        isDemo,
      },
      metadata: body.metadata || {},
    });

    // NEVER return credentials in any response
    const safeConnection = safeAccountDTO(connection as unknown as Record<string, unknown>);

    return NextResponse.json(safeConnection, { status: 201 });
  } catch (error) {
    logSecurityEvent({
      eventType: 'CONNECTIONS_POST_ERROR',
      route: '/api/broker-execution/connections',
      userId,
      reason: error instanceof Error ? error.message : 'Unknown error',
    });

    // Check for tenant isolation errors
    if (error instanceof Error && error.message.includes('Tenant isolation')) {
      return NextResponse.json(
        { error: 'Access denied.', code: 'TENANT_ISOLATION_VIOLATION', remediationPhase: 'containment' },
        { status: 403 },
      );
    }

    return NextResponse.json(
      { error: 'Failed to create connection.', code: CONTAINMENT_CODES.SERVICE_UNAVAILABLE, remediationPhase: 'containment' },
      { status: 500 },
    );
  }
}
