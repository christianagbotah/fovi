// ============================================================
// GET/PATCH/DELETE /api/broker-execution/connections/[id]
// Manage a specific broker connection.
//
// GET:    Get connection details (REQUIRES AUTH + ownership check)
// PATCH:  Update connection (REQUIRES AUTH + ownership check)
// DELETE: Delete connection (REQUIRES AUTH + ownership check)
//
// Ownership verification: connection.tenantId MUST match authenticated userId.
// 403 if accessing another user's connection.
// Never return credentials in any response.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getUserIdSync, authRequiredResponse } from '@/lib/get-user-id';
import { safeAccountDTO, logSecurityEvent, CONTAINMENT_CODES } from '@/lib/trading-policy';
import { getConnectionManager, TenantIsolationError } from '@/lib/broker-execution/connection/connection-manager';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// ============================================================
// GET — Get connection details
// ============================================================
export async function GET(req: NextRequest, context: RouteContext) {
  let userId: string;
  try {
    userId = getUserIdSync(req);
  } catch {
    return authRequiredResponse();
  }

  const { id: connectionId } = await context.params;

  try {
    const connectionManager = getConnectionManager();
    const connection = connectionManager.getConnection(connectionId, userId);

    if (!connection) {
      return NextResponse.json(
        { error: 'Connection not found.' },
        { status: 404 },
      );
    }

    // Ownership verification: connection.tenantId MUST match authenticated userId
    if (connection.tenantId !== userId) {
      logSecurityEvent({
        eventType: 'CONNECTION_OWNERSHIP_VIOLATION',
        route: '/api/broker-execution/connections/[id]',
        userId,
        reason: `User attempted to access connection belonging to tenant=${connection.tenantId}`,
      });
      return NextResponse.json(
        { error: 'Access denied.', code: 'TENANT_ISOLATION_VIOLATION', remediationPhase: 'containment' },
        { status: 403 },
      );
    }

    // NEVER return credentials in any response
    const safeConnection = safeAccountDTO(connection as unknown as Record<string, unknown>);
    return NextResponse.json(safeConnection);
  } catch (error) {
    if (error instanceof TenantIsolationError) {
      return NextResponse.json(
        { error: 'Access denied.', code: 'TENANT_ISOLATION_VIOLATION', remediationPhase: 'containment' },
        { status: 403 },
      );
    }
    logSecurityEvent({
      eventType: 'CONNECTION_GET_ERROR',
      route: '/api/broker-execution/connections/[id]',
      userId,
      reason: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'Failed to fetch connection.' },
      { status: 500 },
    );
  }
}

// ============================================================
// PATCH — Update connection
// ============================================================
export async function PATCH(req: NextRequest, context: RouteContext) {
  let userId: string;
  try {
    userId = getUserIdSync(req);
  } catch {
    return authRequiredResponse();
  }

  const { id: connectionId } = await context.params;
  const body = await req.json().catch(() => ({}));

  try {
    const connectionManager = getConnectionManager();

    // First verify ownership by getting the connection
    const existing = connectionManager.getConnection(connectionId, userId);
    if (!existing) {
      return NextResponse.json(
        { error: 'Connection not found.' },
        { status: 404 },
      );
    }

    // Ownership verification
    if (existing.tenantId !== userId) {
      logSecurityEvent({
        eventType: 'CONNECTION_OWNERSHIP_VIOLATION',
        route: '/api/broker-execution/connections/[id]',
        userId,
        reason: `User attempted to update connection belonging to tenant=${existing.tenantId}`,
      });
      return NextResponse.json(
        { error: 'Access denied.', code: 'TENANT_ISOLATION_VIOLATION', remediationPhase: 'containment' },
        { status: 403 },
      );
    }

    // Apply updates (name and metadata only — state changes go through the connection manager)
    const updated = connectionManager.updateConnection(connectionId, userId, {
      name: body.name,
      metadata: body.metadata,
    });

    if (!updated) {
      return NextResponse.json(
        { error: 'Failed to update connection.' },
        { status: 500 },
      );
    }

    // NEVER return credentials in any response
    const safeConnection = safeAccountDTO(updated as unknown as Record<string, unknown>);
    return NextResponse.json(safeConnection);
  } catch (error) {
    if (error instanceof TenantIsolationError) {
      return NextResponse.json(
        { error: 'Access denied.', code: 'TENANT_ISOLATION_VIOLATION', remediationPhase: 'containment' },
        { status: 403 },
      );
    }
    logSecurityEvent({
      eventType: 'CONNECTION_PATCH_ERROR',
      route: '/api/broker-execution/connections/[id]',
      userId,
      reason: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'Failed to update connection.' },
      { status: 500 },
    );
  }
}

// ============================================================
// DELETE — Delete connection
// ============================================================
export async function DELETE(req: NextRequest, context: RouteContext) {
  let userId: string;
  try {
    userId = getUserIdSync(req);
  } catch {
    return authRequiredResponse();
  }

  const { id: connectionId } = await context.params;

  try {
    const connectionManager = getConnectionManager();

    // First verify ownership by getting the connection
    const existing = connectionManager.getConnection(connectionId, userId);
    if (!existing) {
      return NextResponse.json(
        { error: 'Connection not found.' },
        { status: 404 },
      );
    }

    // Ownership verification
    if (existing.tenantId !== userId) {
      logSecurityEvent({
        eventType: 'CONNECTION_OWNERSHIP_VIOLATION',
        route: '/api/broker-execution/connections/[id]',
        userId,
        reason: `User attempted to delete connection belonging to tenant=${existing.tenantId}`,
      });
      return NextResponse.json(
        { error: 'Access denied.', code: 'TENANT_ISOLATION_VIOLATION', remediationPhase: 'containment' },
        { status: 403 },
      );
    }

    const deleted = connectionManager.deleteConnection(connectionId, userId);

    if (!deleted) {
      return NextResponse.json(
        { error: 'Connection not found.' },
        { status: 404 },
      );
    }

    return NextResponse.json({ deleted: true, connectionId });
  } catch (error) {
    if (error instanceof TenantIsolationError) {
      return NextResponse.json(
        { error: 'Access denied.', code: 'TENANT_ISOLATION_VIOLATION', remediationPhase: 'containment' },
        { status: 403 },
      );
    }
    logSecurityEvent({
      eventType: 'CONNECTION_DELETE_ERROR',
      route: '/api/broker-execution/connections/[id]',
      userId,
      reason: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'Failed to delete connection.' },
      { status: 500 },
    );
  }
}
