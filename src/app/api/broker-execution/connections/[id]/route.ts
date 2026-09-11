// ============================================================
// GET/PATCH/DELETE /api/broker-execution/connections/[id]
// Manage a specific broker connection.
//
// CORRECTION ROUND (defects 2, 4): ownership is proven from
// server-side PostgreSQL records (BrokerConnection.tenantId).
// GET/PATCH/DELETE never return credentials — the safe DTO
// excludes all encrypted credential columns.
//
// CORRECTION ROUND 2 (items 2, 5):
//   - Ownership failures are INDISTINGUISHABLE: a foreign
//     connection and a non-existent connection both resolve to
//     404 CONNECTION_NOT_FOUND (the existence oracle is removed).
//   - PATCH accepts harmless metadata ONLY (accountName).
//     `isActive`/`connectionState` are SERVER-DERIVED — no public
//     path can control a connection's operational state.
//
// GET:    Get connection details (REQUIRES AUTH + ownership)
// PATCH:  Update connection metadata (REQUIRES AUTH + ownership)
// DELETE: Delete connection (REQUIRES AUTH + ownership)
// 404 when not found (or owned by another tenant — identical);
// 503 fail-closed when the authoritative store is unavailable.
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

// ── Update schema (round 2, item 5) ──
// Harmless display metadata ONLY. `isActive` is deliberately absent:
// operational connection state is derived server-side and must
// never be caller-controlled. `.strict()` REJECTS (400) any request
// that carries `isActive` or any other unrecognized key — callers
// cannot believe they toggled operational state.
const UpdateConnectionSchema = z
  .object({
    accountName: z.string().nullable().optional(),
  })
  .strict();

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
      // Indistinguishable 404 (round 2, item 2): foreign and
      // non-existent connections produce the SAME body — status,
      // error text AND code.
      return NextResponse.json(
        { error: 'Connection not found.', code: 'CONNECTION_NOT_FOUND' },
        { status: 404 },
      );
    }

    // Ownership is enforced inside getConnection. The DTO excludes
    // all credential columns.
    return NextResponse.json(connection);
  } catch (error) {
    if (error instanceof TenantIsolationError) {
      // Defensive guard (round 2, item 2): if a tenant-isolation
      // path ever fires again, it MUST return the same
      // indistinguishable 404 CONNECTION_NOT_FOUND shape — never a
      // caller-visible 403 that would re-introduce the existence
      // oracle.
      logSecurityEvent({
        eventType: 'CONNECTION_OWNERSHIP_VIOLATION',
        route: '/api/broker-execution/connections/[id]',
        userId,
        reason: 'Cross-tenant connection access denied (DB-backed ownership check)',
      });
      return NextResponse.json(
        { error: 'Connection not found.', code: 'CONNECTION_NOT_FOUND' },
        { status: 404 },
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
      },
      { actorId: userId },
    );

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof TenantIsolationError) {
      // Defensive guard (round 2, item 2): indistinguishable 404.
      logSecurityEvent({
        eventType: 'CONNECTION_OWNERSHIP_VIOLATION',
        route: '/api/broker-execution/connections/[id]',
        userId,
        reason: 'Cross-tenant connection update denied (DB-backed ownership check)',
      });
      return NextResponse.json(
        { error: 'Connection not found.', code: 'CONNECTION_NOT_FOUND' },
        { status: 404 },
      );
    }
    const status = (error as { status?: number }).status ?? persistenceErrorStatus(error);
    const code = (error as { code?: string }).code ?? 'SERVICE_UNAVAILABLE';
    logSecurityEvent({
      eventType: 'CONNECTION_PATCH_ERROR',
      route: '/api/broker-execution/connections/[id]',
      userId,
      reason: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'Failed to update connection.', code },
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
      // Defensive guard (round 2, item 2): indistinguishable 404.
      logSecurityEvent({
        eventType: 'CONNECTION_OWNERSHIP_VIOLATION',
        route: '/api/broker-execution/connections/[id]',
        userId,
        reason: 'Cross-tenant connection delete denied (DB-backed ownership check)',
      });
      return NextResponse.json(
        { error: 'Connection not found.', code: 'CONNECTION_NOT_FOUND' },
        { status: 404 },
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
