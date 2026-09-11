// ============================================================
// GET/POST /api/broker-execution/reconciliation
// State reconciliation between command records and broker state.
//
// CORRECTION ROUND (defect 7):
//   - Ownership is MANDATORY. The previous implementation only
//     checked ownership when connectionId was supplied, which let
//     an authenticated caller omit connectionId and query an
//     arbitrary accountId. Now BOTH accountId AND connectionId are
//     required, resolved from trusted PostgreSQL records, and must
//     correspond to each other AND to the authenticated tenant.
//   - connectionId is NOT an optional authorization mechanism.
//
// CORRECTION ROUND 2 (item 3) — ADMIN CROSS-TENANT RECONCILIATION
// REMOVED:
//   - There is NO admin cross-tenant branch at this boundary. The
//     route previously authorized a verified admin to reconcile
//     another tenant's connection, but the ReconciliationStore and
//     ReconciliationRepository below resolve ownership with the
//     requesting user's identity — an admin-authorized request
//     would then be REFUSED by the store (self-contradiction).
//   - Phase 1 decision: reconciliation is strictly OWNER-SCOPED.
//     Every caller — admin or not — may only reconcile connections
//     they own. A foreign connection resolves to the
//     indistinguishable 404 CONNECTION_NOT_FOUND (item 2).
//   - Reconciliation results are persisted to ReconciliationResult
//     (PostgreSQL) via the ownership-proven store.
//   - READ-ONLY and demo/simulator-only: reconciliation never
//     calls a live broker execution method, and non-demo
//     connections are refused under Phase 1 containment.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getUserIdSync, authRequiredResponse } from '@/lib/get-user-id';
import { logSecurityEvent } from '@/lib/trading-policy';
import { resolveOwnedConnection, type BrokerConnectionRow } from '@/lib/broker-execution/security/ownership';
import { ReconciliationStore } from '@/lib/broker-execution/reconciliation/reconciliation-store';
import { Reconciler } from '@/lib/broker-execution/reconciliation/reconciler';
import { CommandRepository } from '@/lib/broker-execution/persistence/command-repository';
import { getCanonicalProvider } from '@/lib/broker-execution/providers/canonical-providers';
import { persistenceErrorStatus } from '@/lib/broker-execution/persistence/db-access';

// ── Reconciliation store singleton (stateless — PostgreSQL-backed) ──
let _reconStore: ReconciliationStore | null = null;
function getReconStore(): ReconciliationStore {
  if (!_reconStore) {
    _reconStore = new ReconciliationStore();
  }
  return _reconStore;
}

/**
 * Resolve and verify the account+connection pair for the caller.
 * Mandatory ownership: both identifiers are required and must
 * correspond to each other and to the authenticated tenant.
 * Strictly owner-scoped (round 2, item 3) — no admin cross-tenant
 * branch exists anywhere in this path.
 */
async function resolveOwnedAccountConnection(
  userId: string,
  accountId: string,
  connectionId: string,
): Promise<
  | { ok: true; connection: BrokerConnectionRow }
  | { ok: false; status: number; code: string; message: string }
> {
  const resolution = await resolveOwnedConnection(connectionId, userId);
  if (!resolution.ok) {
    return { ok: false, status: resolution.status, code: resolution.code, message: resolution.message };
  }
  const connection = resolution.connection;

  // The accountId must correspond to the connection record.
  const expectedAccountId = connection.accountId ?? connection.id;
  if (accountId !== expectedAccountId) {
    return {
      ok: false,
      status: 400,
      code: 'ACCOUNT_CONNECTION_MISMATCH',
      message: 'accountId does not correspond to the supplied connection.',
    };
  }

  return { ok: true, connection };
}

/** Phase 1 containment: reconciliation is demo/simulator-only. */
function assertDemoOnly(connection: { providerId: string; isDemo: boolean }): { blocked: boolean; message?: string } {
  if (!connection.isDemo) {
    return {
      blocked: true,
      message: 'Phase 1 containment: reconciliation is restricted to demo/simulator connections.',
    };
  }
  const canonical = getCanonicalProvider(connection.providerId);
  if (!canonical || !canonical.isDemo) {
    return {
      blocked: true,
      message: 'Phase 1 containment: the connection provider is not a canonical demo/simulator provider.',
    };
  }
  return { blocked: false };
}

// ============================================================
// GET — Get reconciliation status (ownership mandatory)
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

  // connectionId is REQUIRED (defect 7 — not an optional auth mechanism)
  if (!accountId || !connectionId) {
    return NextResponse.json(
      { error: 'Both accountId and connectionId query parameters are required.' },
      { status: 400 },
    );
  }

  try {
    const resolved = await resolveOwnedAccountConnection(userId, accountId, connectionId);
    if (!resolved.ok) {
      return NextResponse.json(
        { error: resolved.message, code: resolved.code, remediationPhase: 'containment' },
        { status: resolved.status },
      );
    }

    const store = getReconStore();
    const limit = Math.min(parseInt(searchParams.get('limit') || '10', 10), 100);
    const history = await store.getHistory(userId, connectionId, accountId, limit);
    const latest = history.length > 0 ? history[0] : null;

    return NextResponse.json({
      accountId,
      connectionId,
      latestReconciliation: latest,
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
      { error: 'Failed to get reconciliation status.', code: 'SERVICE_UNAVAILABLE' },
      { status: persistenceErrorStatus(error) },
    );
  }
}

// ============================================================
// POST — Trigger reconciliation (ownership mandatory, read-only)
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

  // connectionId is REQUIRED (defect 7)
  if (!accountId || !connectionId) {
    return NextResponse.json(
      { error: 'Both accountId and connectionId are required.' },
      { status: 400 },
    );
  }

  try {
    const resolved = await resolveOwnedAccountConnection(userId, accountId, connectionId);
    if (!resolved.ok) {
      return NextResponse.json(
        { error: resolved.message, code: resolved.code, remediationPhase: 'containment' },
        { status: resolved.status },
      );
    }
    const connection = resolved.connection;

    // Phase 1 containment: demo/simulator connections only.
    const demoCheck = assertDemoOnly(connection);
    if (demoCheck.blocked) {
      logSecurityEvent({
        eventType: 'RECONCILIATION_NON_DEMO_BLOCKED',
        route: '/api/broker-execution/reconciliation',
        userId,
        reason: `Reconciliation refused for non-demo connection=${connectionId}`,
      });
      return NextResponse.json(
        { error: demoCheck.message, code: 'PHASE1_DEMO_ONLY', remediationPhase: 'containment' },
        { status: 403 },
      );
    }

    // Read-only reconciliation over the authoritative command
    // records for this connection (NO broker execution method is
    // called — the input is built exclusively from PostgreSQL
    // command records and an empty broker-side state).
    const commandRows = await CommandRepository.listByConnection(connectionId, connection.tenantId);

    const reconciler = new Reconciler(getReconStore());
    const result = await reconciler.reconcile(
      accountId,
      connection.providerId,
      {
        foviCommands: commandRows.map((row) => ({
          commandId: row.commandId,
          status: row.currentState,
          brokerOrderId: row.brokerOrderId,
          brokerPositionId: row.brokerPositionId,
          fillPrice: row.fillPrice,
          fillSize: row.fillSize,
        })) as never,
        brokerOrders: [],
        brokerPositions: [],
        brokerFills: [],
      },
      { authenticatedUserId: userId, connectionId },
    );

    logSecurityEvent({
      eventType: 'RECONCILIATION_TRIGGERED',
      route: '/api/broker-execution/reconciliation',
      userId,
      reason: `Reconciliation completed for accountId=${accountId} connectionId=${connectionId} status=${result.status}`,
    });

    return NextResponse.json({
      accountId,
      connectionId,
      status: result.status,
      commandCount: result.commandCount,
      matchCount: result.matchCount,
      mismatchCount: result.mismatchCount,
      discrepancyCount: result.discrepancies.length,
      discrepancies: result.discrepancies,
      durationMs: result.durationMs,
      reconciledAt: result.reconciledAt,
      readOnly: true,
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
      { error: 'Failed to trigger reconciliation.', code: 'SERVICE_UNAVAILABLE' },
      { status: persistenceErrorStatus(error) },
    );
  }
}
