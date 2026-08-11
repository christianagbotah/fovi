// ============================================================
// get-user-id.ts — Extract authenticated user ID from request
// ============================================================

import { ensureDemoUser, DEMO_USER_ID } from './db';

/**
 * Get the current user's ID from the request headers or session.
 * Priority:
 *   1. X-User-Id header (set by auth proxy/middleware)
 *   2. ensureDemoUser() fallback for unauthenticated demo mode
 *
 * Returns the userId string, or DEMO_USER_ID as ultimate fallback.
 */
export async function getUserId(req: Request): Promise<string> {
  // 1. Try X-User-Id header (set by auth middleware/proxy)
  const headerUserId = req.headers.get('x-user-id');
  if (headerUserId && headerUserId !== 'anonymous' && headerUserId !== '') {
    return headerUserId;
  }

  // 2. Try ensureDemoUser() for DB-backed demo mode
  const demoUserId = await ensureDemoUser();
  if (demoUserId) {
    return demoUserId;
  }

  // 3. Ultimate fallback
  return DEMO_USER_ID;
}

/**
 * Get user ID synchronously for routes that don't need DB access.
 * Returns header value or DEMO_USER_ID.
 */
export function getUserIdSync(req: Request): string {
  const headerUserId = req.headers.get('x-user-id');
  if (headerUserId && headerUserId !== 'anonymous' && headerUserId !== '') {
    return headerUserId;
  }
  return DEMO_USER_ID;
}
