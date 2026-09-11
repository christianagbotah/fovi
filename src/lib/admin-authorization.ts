import { NextRequest, NextResponse } from 'next/server';
import { extractBearerToken, verifyToken } from '@/lib/auth';
import {
  AUTHZ_PERMISSIONS,
  getAuthorizationSnapshot,
  type AuthorizationSnapshot,
  type PermissionCode,
} from '@/lib/rbac';

export type AdminAuthorizationResult =
  | {
      ok: true;
      userId: string;
      email: string;
      authorization: AuthorizationSnapshot;
    }
  | {
      ok: false;
      response: NextResponse;
    };

/**
 * Route/data-boundary authorization for privileged admin handlers.
 *
 * Deliberately re-verifies the bearer token instead of trusting identity
 * headers injected by Proxy. This keeps each handler fail-closed even if it is
 * ever invoked through a different deployment path or request boundary.
 */
export async function requireAdminPermission(
  request: NextRequest,
  permission: PermissionCode,
): Promise<AdminAuthorizationResult> {
  const token = extractBearerToken(request);
  if (!token) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Authentication required.', code: 'AUTH_REQUIRED' },
        { status: 401 },
      ),
    };
  }

  const payload = await verifyToken(token);
  if (!payload || payload.type !== 'access') {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Authentication required.', code: 'AUTH_REQUIRED' },
        { status: 401 },
      ),
    };
  }

  const authorization = await getAuthorizationSnapshot(payload.sub);
  if (!authorization) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'Authorization service unavailable.',
          code: 'AUTHORIZATION_UNAVAILABLE',
          remediationPhase: 'phase-3bc',
        },
        { status: 503 },
      ),
    };
  }

  const granted = new Set(authorization.permissions);
  if (
    !granted.has(AUTHZ_PERMISSIONS.ADMIN_ACCESS) ||
    !granted.has(permission)
  ) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'Insufficient admin permission.',
          code: 'FORBIDDEN',
          requiredPermission: permission,
          remediationPhase: 'phase-3bc',
        },
        { status: 403 },
      ),
    };
  }

  return {
    ok: true,
    userId: payload.sub,
    email: payload.email || '',
    authorization,
  };
}
