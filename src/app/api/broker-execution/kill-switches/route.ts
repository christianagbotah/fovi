// ============================================================
// GET/POST /api/broker-execution/kill-switches
// Kill switch management — ADMIN ONLY.
//
// GET:  List kill switches (ADMIN ONLY)
// POST: Create/activate kill switch (ADMIN ONLY)
//
// Must verify X-User-Role === 'admin' from request headers.
// Returns 401 if not authenticated, 403 if not admin.
// Non-admin users CANNOT operate kill switches at all.
//
// Kill switches are the highest-priority execution gate.
// They override ALL other gates including trading policy.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getUserIdSync, authRequiredResponse } from '@/lib/get-user-id';
import { logSecurityEvent, CONTAINMENT_CODES } from '@/lib/trading-policy';
import {
  getAllKillSwitches,
  activateKillSwitch,
} from '@/lib/broker-execution/kill-switches/kill-switch-manager';
import {
  KillSwitchScope,
} from '@/lib/broker-execution/types/kill-switches';

/**
 * Verify that the requesting user has admin role.
 * Checks X-User-Role header (set by auth proxy after JWT verification).
 * Returns null if admin, or a 403 NextResponse if not.
 */
function requireAdminRole(req: NextRequest): NextResponse | null {
  const userRole = req.headers.get('x-user-role');
  if (userRole !== 'admin') {
    logSecurityEvent({
      eventType: 'KILL_SWITCH_NON_ADMIN_ACCESS',
      route: '/api/broker-execution/kill-switches',
      reason: `User with role='${userRole}' attempted to access kill switches (admin only)`,
    });
    return NextResponse.json(
      {
        error: 'Admin access required. Kill switches are restricted to admin users only.',
        code: 'FORBIDDEN',
        remediationPhase: 'containment',
      },
      { status: 403 },
    );
  }
  return null;
}

// ============================================================
// GET — List kill switches (ADMIN ONLY)
// ============================================================
export async function GET(req: NextRequest) {
  let userId: string;
  try {
    userId = getUserIdSync(req);
  } catch {
    return authRequiredResponse();
  }

  // Verify admin role
  const adminCheck = requireAdminRole(req);
  if (adminCheck) return adminCheck;

  try {
    const { searchParams } = new URL(req.url);
    const scope = searchParams.get('scope') as typeof KillSwitchScope[keyof typeof KillSwitchScope] | null;
    const scopeId = searchParams.get('scopeId');

    const filter = scope ? { scope, scopeId: scopeId || undefined } : undefined;
    const killSwitches = await getAllKillSwitches(filter);

    return NextResponse.json({
      killSwitches,
      count: killSwitches.length,
    });
  } catch (error) {
    logSecurityEvent({
      eventType: 'KILL_SWITCHES_GET_ERROR',
      route: '/api/broker-execution/kill-switches',
      userId,
      reason: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'Failed to fetch kill switches.' },
      { status: 500 },
    );
  }
}

// ============================================================
// POST — Create/activate kill switch (ADMIN ONLY)
// ============================================================
export async function POST(req: NextRequest) {
  let userId: string;
  try {
    userId = getUserIdSync(req);
  } catch {
    return authRequiredResponse();
  }

  // Verify admin role
  const adminCheck = requireAdminRole(req);
  if (adminCheck) return adminCheck;

  const body = await req.json().catch(() => ({}));

  // Validate required fields
  if (!body.scope || !body.scopeId || !body.reason) {
    return NextResponse.json(
      { error: 'Missing required fields: scope, scopeId, reason.' },
      { status: 400 },
    );
  }

  // Validate scope value
  const validScopes = Object.values(KillSwitchScope) as string[];
  if (!validScopes.includes(body.scope)) {
    return NextResponse.json(
      { error: `Invalid scope. Must be one of: ${validScopes.join(', ')}` },
      { status: 400 },
    );
  }

  try {
    const killSwitch = await activateKillSwitch({
      scope: body.scope,
      scopeId: body.scopeId,
      activatedBy: userId,
      reason: body.reason,
      emergencyReadOnly: body.emergencyReadOnly === true,
    });

    logSecurityEvent({
      eventType: 'KILL_SWITCH_ACTIVATED_VIA_API',
      route: '/api/broker-execution/kill-switches',
      userId,
      reason: `Kill switch activated: scope=${body.scope} scopeId=${body.scopeId}`,
    });

    return NextResponse.json(killSwitch, { status: 201 });
  } catch (error) {
    logSecurityEvent({
      eventType: 'KILL_SWITCHES_POST_ERROR',
      route: '/api/broker-execution/kill-switches',
      userId,
      reason: error instanceof Error ? error.message : 'Unknown error',
    });

    if (error instanceof Error && error.message.includes('not an admin')) {
      return NextResponse.json(
        { error: 'Admin access required.', code: 'FORBIDDEN', remediationPhase: 'containment' },
        { status: 403 },
      );
    }

    return NextResponse.json(
      { error: 'Failed to activate kill switch.', code: CONTAINMENT_CODES.SERVICE_UNAVAILABLE, remediationPhase: 'containment' },
      { status: 500 },
    );
  }
}
