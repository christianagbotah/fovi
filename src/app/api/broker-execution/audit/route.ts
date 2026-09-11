// ============================================================
// GET /api/broker-execution/audit
// Query the durable, append-only broker-execution audit trail.
//
// STRICT ADMIN ONLY (verified JWT role via proxy-injected
// X-User-Role; caller-supplied identity headers are stripped in
// proxy Step 0).
//
// CORRECTION ROUND (defect 10): queries hit the authoritative
// BrokerExecutionAudit PostgreSQL table (append-only — no update
// or delete path exists anywhere). Fail-closed: 503 when the
// store is unavailable. Records are sanitized (no credentials,
// redacted network metadata).
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getUserIdSync, authRequiredResponse } from '@/lib/get-user-id';
import { logSecurityEvent } from '@/lib/trading-policy';
import { auditTrail, type AuditQueryFilters } from '@/lib/broker-execution/observability/audit-trail';
import { type AuditAuthContext } from '@/lib/broker-execution/persistence/audit-repository';
import { persistenceErrorStatus } from '@/lib/broker-execution/persistence/db-access';

/**
 * Verify that the requesting user has admin role.
 * Returns null if admin, or a 403 NextResponse if not.
 */
function requireAdminRole(req: NextRequest): NextResponse | null {
  const userRole = req.headers.get('x-user-role');
  if (userRole !== 'admin') {
    logSecurityEvent({
      eventType: 'AUDIT_NON_ADMIN_ACCESS',
      route: '/api/broker-execution/audit',
      reason: `User with role='${userRole}' attempted to access audit records (admin only)`,
    });
    return NextResponse.json(
      {
        error: 'Admin access required. Audit records are restricted to admin users only.',
        code: 'FORBIDDEN',
        remediationPhase: 'containment',
      },
      { status: 403 },
    );
  }
  return null;
}

export async function GET(req: NextRequest) {
  let userId: string;
  try {
    userId = getUserIdSync(req);
  } catch {
    return authRequiredResponse();
  }

  // STRICT: Only admin users can access audit records
  const adminCheck = requireAdminRole(req);
  if (adminCheck) return adminCheck;

  try {
    const { searchParams } = new URL(req.url);

    // Build audit query filters from search params
    const filters: AuditQueryFilters = {};

    const action = searchParams.get('action');
    if (action) filters.action = action;

    const tenantId = searchParams.get('tenantId');
    if (tenantId) filters.tenantId = tenantId;

    const actorId = searchParams.get('actorId');
    if (actorId) filters.actorId = actorId;

    const commandId = searchParams.get('commandId');
    if (commandId) filters.commandId = commandId;

    const correlationId = searchParams.get('correlationId');
    if (correlationId) filters.correlationId = correlationId;

    const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 500);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10), 0);
    filters.limit = limit;
    filters.offset = offset;

    // Authorization context: verified admin (role checked above)
    const auth: AuditAuthContext = {
      userId,
      role: 'admin',
      isAdmin: true,
    };

    const records = await auditTrail.query(filters, auth);

    // Audit records never contain credentials (structural type
    // constraint + repository-side redaction).
    return NextResponse.json({
      records,
      count: records.length,
      offset,
      limit,
    });
  } catch (error) {
    logSecurityEvent({
      eventType: 'AUDIT_GET_ERROR',
      route: '/api/broker-execution/audit',
      userId,
      reason: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'Failed to query audit records.', code: 'SERVICE_UNAVAILABLE' },
      { status: persistenceErrorStatus(error) },
    );
  }
}
