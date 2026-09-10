// ============================================================
// GET/POST/PATCH /api/broker-execution/kill-switches
// Kill switch management — ADMIN ONLY (verified JWT role).
//
// CORRECTION ROUND (defect 6):
//   - Authorization comes from the VERIFIED JWT role security
//     context (proxy-injected X-User-Role, set only after JWT
//     verification). The 'admin_'/'system' user-ID prefix
//     convention is REMOVED — a user's ID NEVER determines
//     whether they are an admin.
//   - KillSwitchRecord (PostgreSQL) is the authoritative store.
//     Kill-switch state is durable and visible to concurrent
//     instances.
//   - Fail-closed: on DB failure during load the API returns 503
//     (it never pretends the store is safely hydrated); on
//     activation/deactivation persistence failure the API returns
//     503 — never false success.
//   - GLOBAL scope uses the canonical non-null scopeId 'global'
//     (singleton enforced by the unique constraint).
//
// GET:   list kill switches (admin only)
// POST:  create/activate kill switch (admin only)
// PATCH: deactivate kill switch (admin only)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getUserIdSync, authRequiredResponse } from '@/lib/get-user-id';
import { logSecurityEvent, CONTAINMENT_CODES } from '@/lib/trading-policy';
import {
  getAllKillSwitches,
  activateKillSwitch,
  deactivateKillSwitch,
} from '@/lib/broker-execution/kill-switches/kill-switch-manager';
import { KillSwitchScope } from '@/lib/broker-execution/types/kill-switches';
import { persistenceErrorStatus } from '@/lib/broker-execution/persistence/db-access';

/**
 * Verify that the requesting user has admin role.
 * Checks X-User-Role header — set by the auth proxy ONLY after JWT
 * verification (caller-supplied values are stripped in Step 0).
 * A user's ID never determines admin status.
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
// GET — List kill switches (ADMIN ONLY, authoritative store)
// ============================================================
export async function GET(req: NextRequest) {
  let userId: string;
  try {
    userId = getUserIdSync(req);
  } catch {
    return authRequiredResponse();
  }

  const adminCheck = requireAdminRole(req);
  if (adminCheck) return adminCheck;

  try {
    const { searchParams } = new URL(req.url);
    const scope = searchParams.get('scope') as keyof typeof KillSwitchScope | null;
    const scopeId = searchParams.get('scopeId');

    const filter = scope ? { scope: KillSwitchScope[scope], scopeId: scopeId || undefined } : undefined;
    const killSwitches = await getAllKillSwitches(filter);

    return NextResponse.json({
      killSwitches,
      count: killSwitches.length,
    });
  } catch (error) {
    // Fail-closed: DB failure during load → 503, never a
    // pretend-empty successful response.
    logSecurityEvent({
      eventType: 'KILL_SWITCHES_GET_ERROR',
      route: '/api/broker-execution/kill-switches',
      userId,
      reason: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'Failed to fetch kill switches (fail-closed).', code: 'SERVICE_UNAVAILABLE' },
      { status: persistenceErrorStatus(error) },
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

  const adminCheck = requireAdminRole(req);
  if (adminCheck) return adminCheck;

  const body = await req.json().catch(() => ({}));

  if (!body.scope || !body.reason) {
    return NextResponse.json(
      { error: 'Missing required fields: scope, reason.' },
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

  // GLOBAL scope uses the canonical scopeId — caller-supplied
  // scopeId values for GLOBAL are ignored (singleton semantics).
  // Other scopes require a concrete scopeId.
  const isGlobal = body.scope === KillSwitchScope.GLOBAL;
  if (!isGlobal && (!body.scopeId || typeof body.scopeId !== 'string' || body.scopeId.trim() === '')) {
    return NextResponse.json(
      { error: `scopeId is required for scope ${body.scope}.` },
      { status: 400 },
    );
  }

  try {
    const killSwitch = await activateKillSwitch({
      scope: body.scope,
      scopeId: isGlobal ? undefined : body.scopeId,
      activatedBy: userId, // recorded as the ACTOR (authorization was the verified role)
      reason: body.reason,
      emergencyReadOnly: body.emergencyReadOnly === true,
    });

    logSecurityEvent({
      eventType: 'KILL_SWITCH_ACTIVATED_VIA_API',
      route: '/api/broker-execution/kill-switches',
      userId,
      reason: `Kill switch activated: scope=${killSwitch.scope} scopeId=${killSwitch.scopeId}`,
    });

    return NextResponse.json(killSwitch, { status: 201 });
  } catch (error) {
    logSecurityEvent({
      eventType: 'KILL_SWITCHES_POST_ERROR',
      route: '/api/broker-execution/kill-switches',
      userId,
      reason: error instanceof Error ? error.message : 'Unknown error',
    });

    // Persistence failure → 503, NEVER false success.
    return NextResponse.json(
      {
        error: 'Failed to activate kill switch (fail-closed).',
        code: CONTAINMENT_CODES.SERVICE_UNAVAILABLE,
        remediationPhase: 'containment',
      },
      { status: persistenceErrorStatus(error) },
    );
  }
}

// ============================================================
// PATCH — Deactivate kill switch (ADMIN ONLY)
// ============================================================
export async function PATCH(req: NextRequest) {
  let userId: string;
  try {
    userId = getUserIdSync(req);
  } catch {
    return authRequiredResponse();
  }

  const adminCheck = requireAdminRole(req);
  if (adminCheck) return adminCheck;

  const body = await req.json().catch(() => ({}));

  if (!body.killSwitchId || typeof body.killSwitchId !== 'string') {
    return NextResponse.json(
      { error: 'Missing required field: killSwitchId.' },
      { status: 400 },
    );
  }

  try {
    const killSwitch = await deactivateKillSwitch({
      killSwitchId: body.killSwitchId,
      deactivatedBy: userId, // recorded as the ACTOR (authorization was the verified role)
    });

    logSecurityEvent({
      eventType: 'KILL_SWITCH_DEACTIVATED_VIA_API',
      route: '/api/broker-execution/kill-switches',
      userId,
      reason: `Kill switch deactivated: id=${body.killSwitchId}`,
    });

    return NextResponse.json(killSwitch, { status: 200 });
  } catch (error) {
    logSecurityEvent({
      eventType: 'KILL_SWITCHES_PATCH_ERROR',
      route: '/api/broker-execution/kill-switches',
      userId,
      reason: error instanceof Error ? error.message : 'Unknown error',
    });

    // Not-found is a 404; persistence failure is a 503 — never false success.
    const notFound = error instanceof Error && /not found/i.test(error.message);
    return NextResponse.json(
      {
        error: notFound
          ? 'Kill switch not found.'
          : 'Failed to deactivate kill switch (fail-closed).',
        code: notFound ? 'KILL_SWITCH_NOT_FOUND' : CONTAINMENT_CODES.SERVICE_UNAVAILABLE,
        remediationPhase: 'containment',
      },
      { status: notFound ? 404 : persistenceErrorStatus(error) },
    );
  }
}
