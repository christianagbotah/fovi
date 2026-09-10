// ============================================================
// GET /api/broker-execution/audit
// Query audit records — STRICT ADMIN AUTH ONLY.
//
// Must verify admin role (X-User-Role === 'admin').
// Returns 401 if not authenticated, 403 if not admin.
// Audit records never contain credentials (by design — see audit.ts).
//
// Supports filtering by:
//   action, dateRange, tenantId (admin only),
//   commandId, correlationId
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getUserIdSync, authRequiredResponse } from '@/lib/get-user-id';
import { logSecurityEvent } from '@/lib/trading-policy';
import { auditTrail } from '@/lib/broker-execution/observability/audit-trail';
import type { AuditQueryFilters, AuditAuthContext } from '@/lib/broker-execution/observability/audit-trail';
import type { AuditAction } from '@/lib/broker-execution/types/audit';

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
    if (action) {
      filters.action = action as AuditAction;
    }

    const dateStart = searchParams.get('dateStart');
    const dateEnd = searchParams.get('dateEnd');
    if (dateStart && dateEnd) {
      filters.dateRange = { start: dateStart, end: dateEnd };
    }

    const tenantId = searchParams.get('tenantId');
    if (tenantId) {
      filters.tenantId = tenantId;
    }

    const accountId = searchParams.get('accountId');
    if (accountId) {
      filters.accountId = accountId;
    }

    const providerId = searchParams.get('providerId');
    if (providerId) {
      filters.providerId = providerId;
    }

    const actorId = searchParams.get('actorId');
    if (actorId) {
      filters.actorId = actorId;
    }

    const commandId = searchParams.get('commandId');
    if (commandId) {
      filters.commandId = commandId;
    }

    const correlationId = searchParams.get('correlationId');
    if (correlationId) {
      filters.correlationId = correlationId;
    }

    // Authorization context: admin can query across tenants
    const auth: AuditAuthContext = {
      requestingTenantId: userId,
      isAdmin: true, // We already verified admin role above
    };

    const records = auditTrail.query(filters, auth);

    // Pagination
    const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 500);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    const paginatedRecords = records.slice(offset, offset + limit);

    // Audit records never contain credentials (by design in audit.ts)
    return NextResponse.json({
      records: paginatedRecords,
      total: records.length,
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
      { error: 'Failed to query audit records.' },
      { status: 500 },
    );
  }
}
