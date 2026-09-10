// ============================================================
// GET/PATCH/DELETE /api/broker-execution/connections/[id]
// Manage a specific broker connection.
//
// CORRECTION ROUND (defects 2, 4): ownership is proven from
// server-side PostgreSQL records (BrokerConnection.tenantId).
// GET/PATCH/DELETE never return credentials — the safe DTO
// excludes all encrypted credential columns.
//
// GET:    Get connection details (REQUIRES AUTH + ownership)
// PATCH:  Update connection (REQUIRES AUTH + ownership)
// DELETE: Delete connection (REQUIRES AUTH + ownership)
// 403 on cross-tenant access; 404 when not found; 503 fail-closed
// when the authoritative store is unavailable.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserIdSync, authRequiredResponse } from '@/lib/get-user-id';
import { logSecurityEvent } from '@/lib/trading-policy';
import { getConnectionManager, TenantIsolationError } from '@/lib/broker-execution/connection/connection-manager';
import { persistenceErrorStatus } from '@/lib/broker-execution/persistence/db-access';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// ── Update schema (credentials are NOT updatable here) ──
const UpdateConnectionSchema = z.object({
  accountName: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

// ============================================================
// GET — Get connection details (never includes credentials)
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
    const connection = await connectionManager.getConnection(connectionId, userId);

    if (!connection) {
      return NextResponse.json(
        { error: 'Connection not found.' },
        { status: 404 },
      );
    }

    // Ownership is enforced inside getConnection (TenantIsolationError
    // on mismatch). The DTO excludes all credential columns.
    return NextResponse.json(connection);
  } catch (error) {
    if (error instanceof TenantIsolationError) {
      logSecurityEvent({
        eventType: 'CONNECTION_OWNERSHIP_VIOLATION',
        route: '/api/broker-execution/connections/[id]',
        userId,
        reason: 'Cross-tenant connection access denied (DB-backed ownership check)',
      });
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
      { error: 'Failed to fetch connection.', code: 'SERVICE_UNAVAILABLE' },
      { status: persistenceErrorStatus(error) },
    );
  }
}

// ============================================================
// PATCH — Update connection (ownership enforced)
// ============================================================
export async function PATCH(req: NextRequest, context: RouteContext) {
  let userId: string;
  try {
    userId = getUserIdSync(req);
  } catch {
    return authRequiredResponse();
  }

  const { id: connectionId } = await context.params;

  const raw = await req.json().catch(() => null);
  const parsed = UpdateConnectionSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { error: `Invalid input: ${first?.path.join('.') || 'field'} — ${first?.message}` },
      { status: 400 },
    );
  }

  try {
    const connectionManager = getConnectionManager();
    const updated = await connectionManager.updateConnection(
      connectionId,
      userId,
      {
        accountName: parsed.data.accountName,
        isActive: parsed.data.isActive,
      },
      { actorId: userId },
    );

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof TenantIsolationError) {
      logSecurityEvent({
        eventType: 'CONNECTION_OWNERSHIP_VIOLATION',
        route: '/api/broker-execution/connections/[id]',
        userId,
        reason: 'Cross-tenant connection update denied (DB-backed ownership check)',
      });
      return NextResponse.json(
        { error: 'Access denied.', code: 'TENANT_ISOLATION_VIOLATION', remediationPhase: 'containment' },
        { status: 403 },
      );
    }
    const status = (error as { status?: number }).status ?? persistenceErrorStatus(error);
    logSecurityEvent({
      eventType: 'CONNECTION_PATCH_ERROR',
      route: '/api/broker-execution/connections/[id]',
      userId,
      reason: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'Failed to update connection.', code: 'SERVICE_UNAVAILABLE' },
      { status },
    );
  }
}

// ============================================================
// DELETE — Delete connection (ownership enforced)
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
    const deleted = await connectionManager.deleteConnection(connectionId, userId, {
      actorId: userId,
    });

    if (!deleted) {
      return NextResponse.json(
        { error: 'Connection not found.' },
        { status: 404 },
      );
    }

    return NextResponse.json({ deleted: true, connectionId });
  } catch (error) {
    if (error instanceof TenantIsolationError) {
      logSecurityEvent({
        eventType: 'CONNECTION_OWNERSHIP_VIOLATION',
        route: '/api/broker-execution/connections/[id]',
        userId,
        reason: 'Cross-tenant connection delete denied (DB-backed ownership check)',
      });
      return NextResponse.json(
        { error: 'Access denied.', code: 'TENANT_ISOLATION_VIOLATION', remediationPhase: 'containment' },
        { status: 403 },
      );
    }
    const status = (error as { status?: number }).status ?? persistenceErrorStatus(error);
    const code = (error as { code?: string }).code ?? 'SERVICE_UNAVAILABLE';
    logSecurityEvent({
      eventType: 'CONNECTION_DELETE_ERROR',
      route: '/api/broker-execution/connections/[id]',
      userId,
      reason: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'Failed to delete connection.', code },
      { status },
    );
  }
}
