import { NextResponse } from 'next/server';

const AUTH_NO_STORE = 'no-store, max-age=0';

/**
 * JSON response boundary for authentication/session routes.
 *
 * Auth responses can contain access credentials, challenges, or Set-Cookie
 * mutations and must never be reusable by browser, CDN, or intermediary caches.
 */
export function authJson(body: unknown, init?: ResponseInit): NextResponse {
  const response = NextResponse.json(body, init);
  response.headers.set('Cache-Control', AUTH_NO_STORE);
  response.headers.set('Pragma', 'no-cache');
  return response;
}
