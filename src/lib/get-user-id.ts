// ============================================================
// get-user-id.ts — Extract authenticated user ID from request
// Phase 1 CR2: Strict authenticated-user helper.
//   Missing verified identity returns 401, never a shared demo identity.
//   Demo describes the account environment; it must not mean
//   every visitor shares one global tenant.
// ============================================================

import { NextResponse } from 'next/server';
import { CONTAINMENT_CODES } from './trading-policy';

/**
 * Get the current user's ID from the request headers.
 * Requires X-User-Id header (set by auth proxy). Missing → 401.
 * No DEMO_USER_ID fallback. No ensureDemoUser() call.
 */
export async function getUserId(req: Request): Promise<string> {
  const headerUserId = req.headers.get('x-user-id');
  if (headerUserId && headerUserId !== 'anonymous' && headerUserId !== '') {
    return headerUserId;
  }
  throw new AuthRequiredError();
}

/**
 * Get user ID synchronously for routes that don't need DB access.
 * Missing → 401. No fallback.
 */
export function getUserIdSync(req: Request): string {
  const headerUserId = req.headers.get('x-user-id');
  if (headerUserId && headerUserId !== 'anonymous' && headerUserId !== '') {
    return headerUserId;
  }
  throw new AuthRequiredError();
}

/**
 * Get user ID or null (for routes that handle missing auth themselves).
 */
export function getUserIdOrNull(req: Request): string | null {
  const headerUserId = req.headers.get('x-user-id');
  if (headerUserId && headerUserId !== 'anonymous' && headerUserId !== '') {
    return headerUserId;
  }
  return null;
}

/**
 * Error thrown when no authenticated user is found.
 * Route handlers can catch this to return a 401 response.
 */
export class AuthRequiredError extends Error {
  constructor() {
    super('Authentication required.');
    this.name = 'AuthRequiredError';
  }
}

/**
 * Helper to create a 401 NextResponse from an AuthRequiredError.
 */
export function authRequiredResponse(): NextResponse {
  return NextResponse.json(
    {
      error: 'Authentication required.',
      code: CONTAINMENT_CODES.AUTH_REQUIRED,
      remediationPhase: 'containment',
    },
    { status: 401 },
  );
}
