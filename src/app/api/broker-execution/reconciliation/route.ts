// ============================================================
// GET/POST /api/broker-execution/reconciliation
// State reconciliation between command records and broker state.
//
// GET:  Get reconciliation status (REQUIRES AUTH + account ownership)
// POST: Trigger reconciliation (REQUIRES AUTH + account ownership)
//
// Account ownership: verify connection belongs to authenticated user.
// Admin can reconcile any account.
// Returns 401 if not authenticated, 403 if not authorized.
//
// Reconciliation is a READ-ONLY diagnostic operation.
// It NEVER modifies trading state.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getUserIdSync, authRequiredResponse } from '@/lib/get-user-id';
import { logSecurityEvent, CONTAINMENT_CODES } from '@/lib/trading-policy';
import { getConnectionManager } from '@/lib/broker-execution/connection/connection-manager';
import { ReconciliationStore } from '@/lib/broker-execution/reconciliation/reconciliation-store';

/**
 * Check if the requesting user has admin role.
 */
function isAdmin(req: NextRequest): boolean {
  return req.headers.get('x-user-role') === 'admin';
}

// ── Reconciliation store singleton ──
let _reconStore: ReconciliationStore | null = null;
function getReconStore(): ReconciliationStore {
  if (!_reconStore) {
    _reconStore = new ReconciliationStore();
  }
  return _reconStore;
}

// ============================================================
// GET — Get reconciliation status
// ============================================================
export async function GET(req: NextRequest) {
  let userId: string;
  try {
    userId = getUserIdSync(req);
  } catch {
    return authRequiredResponse();
  }

  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get('accountId');
  const connectionId = searchParams.get('connectionId');

  if (!accountId) {
    return NextResponse.json(
      { error: 'accountId query parameter is required.' },
      { status: 400 },
    );
  }

  try {
    // Account ownership verification
    // If connectionId is provided, verify the connection belongs to the user
    if (connectionId) {
      const connectionManager = getConnectionManager();
      const connection = connectionManager.getConnection(connectionId, userId);

      if (!connection) {
        return NextResponse.json(
          { error: 'Connection not found.' },
          { status: 404 },
        );
      }

      if (connection.tenantId !== userId && !isAdmin(req)) {
        logSecurityEvent({
          eventType: 'RECONCILIATION_OWNERSHIP_VIOLATION',
          route: '/api/broker-execution/reconciliation',
          userId,
          reason: `User attempted to access reconciliation for connection belonging to tenant=${connection.tenantId}`,
        });
        return NextResponse.json(
          { error: 'Access denied. You do not own this connection.', code: 'TENANT_ISOLATION_VIOLATION', remediationPhase: 'containment' },
          { status: 403 },
        );
      }
    }

    // Get reconciliation history for the account
    const store = getReconStore();
    const limit = Math.min(parseInt(searchParams.get('limit') || '10', 10), 100);
    const history = await store.getHistory(accountId, limit);
    const latest = history.length > 0 ? history[0] : null;

    return NextResponse.json({
      accountId,
      latestReconciliation: latest
        ? {
            reconciliationId: latest.reconciliationId,
            status: latest.status,
            reconciledAt: latest.reconciledAt,
            durationMs: latest.durationMs,
            commandCount: latest.commandCount,
            matchCount: latest.matchCount,
            mismatchCount: latest.mismatchCount,
            discrepancyCount: latest.discrepancies.length,
          }
        : null,
      historyCount: history.length,
      history: history.map((r) => ({
        reconciliationId: r.reconciliationId,
        status: r.status,
        reconciledAt: r.reconciledAt,
        durationMs: r.durationMs,
        mismatchCount: r.mismatchCount,
      })),
    });
  } catch (error) {
    logSecurityEvent({
      eventType: 'RECONCILIATION_GET_ERROR',
      route: '/api/broker-execution/reconciliation',
      userId,
      reason: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'Failed to get reconciliation status.' },
      { status: 500 },
    );
  }
}

// ============================================================
// POST — Trigger reconciliation
// ============================================================
export async function POST(req: NextRequest) {
  let userId: string;
  try {
    userId = getUserIdSync(req);
  } catch {
    return authRequiredResponse();
  }

  const body = await req.json().catch(() => ({}));
  const accountId = body.accountId;
  const connectionId = body.connectionId;

  if (!accountId) {
    return NextResponse.json(
      { error: 'accountId is required.' },
      { status: 400 },
    );
  }

  try {
    // Account ownership verification
    if (connectionId) {
      const connectionManager = getConnectionManager();
      const connection = connectionManager.getConnection(connectionId, userId);

      if (!connection) {
        return NextResponse.json(
          { error: 'Connection not found.' },
          { status: 404 },
        );
      }

      if (connection.tenantId !== userId && !isAdmin(req)) {
        logSecurityEvent({
          eventType: 'RECONCILIATION_TRIGGER_VIOLATION',
          route: '/api/broker-execution/reconciliation',
          userId,
          reason: `User attempted to trigger reconciliation for connection belonging to tenant=${connection.tenantId}`,
        });
        return NextResponse.json(
          { error: 'Access denied. You do not own this connection.', code: 'TENANT_ISOLATION_VIOLATION', remediationPhase: 'containment' },
          { status: 403 },
        );
      }
    }

    // Phase 1: Reconciliation is available for demo accounts only.
    // For now, return a Phase 1 containment response indicating
    // reconciliation is a no-op (no live accounts to reconcile).
    logSecurityEvent({
      eventType: 'RECONCILIATION_TRIGGERED',
      route: '/api/broker-execution/reconciliation',
      userId,
      reason: `Reconciliation triggered for accountId=${accountId}`,
    });

    // In Phase 1, reconciliation runs against demo accounts only.
    // Return a placeholder result.
    return NextResponse.json({
      status: 'IDLE',
      accountId,
      message: 'Phase 1: Reconciliation is available for demo accounts only. No discrepancies detected.',
      reconciledAt: null,
      phase: '1-containment',
    });
  } catch (error) {
    logSecurityEvent({
      eventType: 'RECONCILIATION_POST_ERROR',
      route: '/api/broker-execution/reconciliation',
      userId,
      reason: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'Failed to trigger reconciliation.', code: CONTAINMENT_CODES.SERVICE_UNAVAILABLE, remediationPhase: 'containment' },
      { status: 500 },
    );
  }
}
