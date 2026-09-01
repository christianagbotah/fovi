// ============================================================
// API Fetch Wrapper
// Central browser access-token boundary:
// 1. Keep the short-lived access token in memory only
// 2. Auto-attach the in-memory access token
// 3. Rotate a server-side refresh session after an authenticated 401
// 4. Serialize refresh rotation so concurrent 401s cannot reuse a token
// 5. Retry the original request once with the rotated access token
// 6. Bootstrap browser auth from the HttpOnly refresh session after reload
// 7. Detect x-demo response headers for typed API callers
// ============================================================

import { useTradingStore } from './store/trading-store';

let refreshInFlight: Promise<string | null> | null = null;

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return useTradingStore.getState().authToken;
}

function isRefreshBoundaryEndpoint(url: string): boolean {
  return url.includes('/api/auth/refresh') || url.includes('/api/auth/logout');
}

function purgeLegacyPersistedAuth(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('fovi_token');
  localStorage.removeItem('fovi_user');
}

function clearBrowserAccessState(): void {
  purgeLegacyPersistedAuth();
  useTradingStore.setState({ authUser: null, authToken: null, isAuthenticated: false });
}

async function performRefreshAccessToken(): Promise<string | null> {
  try {
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'same-origin',
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        clearBrowserAccessState();
      }
      return null;
    }

    const data = await response.json();
    if (
      !data ||
      typeof data.token !== 'string' ||
      data.token.length === 0 ||
      !data.user ||
      typeof data.user.id !== 'string' ||
      typeof data.user.email !== 'string'
    ) {
      clearBrowserAccessState();
      return null;
    }

    // Access JWTs are intentionally memory-only. The revocable refresh secret
    // remains in the HttpOnly cookie and is the only persistent browser session.
    useTradingStore.getState().setAuth(data.user, data.token);
    return data.token;
  } catch {
    return null;
  }
}

async function refreshAccessToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  if (refreshInFlight) return refreshInFlight;

  const pending = performRefreshAccessToken();
  refreshInFlight = pending;
  try {
    return await pending;
  } finally {
    if (refreshInFlight === pending) refreshInFlight = null;
  }
}

/**
 * Bootstrap browser authentication after a page reload. No access credential
 * is restored from Web Storage; instead, the HttpOnly refresh session rotates
 * once and supplies a fresh short-lived access JWT into memory.
 */
export async function bootstrapBrowserAuth(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  purgeLegacyPersistedAuth();

  if (getToken()) return true;
  return (await refreshAccessToken()) !== null;
}

function requestHeaders(options: RequestInit, token: string | null): Headers {
  const headers = new Headers(options.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (!headers.has('Content-Type') && options.method && options.method !== 'GET') {
    headers.set('Content-Type', 'application/json');
  }
  return headers;
}

/**
 * Response-preserving authenticated fetch boundary for browser callers that
 * need status codes or response headers. It performs at most one shared
 * refresh rotation and one retry. Refresh/logout are explicitly excluded to
 * prevent recursion.
 */
export async function authFetch(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  const token = getToken();
  let res = await fetch(url, {
    ...options,
    headers: requestHeaders(options, token),
    credentials: options.credentials || 'same-origin',
  });

  if (res.status === 401 && !isRefreshBoundaryEndpoint(url)) {
    const nextToken = await refreshAccessToken();
    if (nextToken) {
      res = await fetch(url, {
        ...options,
        headers: requestHeaders(options, nextToken),
        credentials: options.credentials || 'same-origin',
      });
    }
  }

  return res;
}

/**
 * Typed fetch wrapper built on the same response-preserving auth boundary.
 */
export async function apiFetch<T = any>(
  url: string,
  options: RequestInit = {},
): Promise<{ data: T; demo: boolean }> {
  const res = await authFetch(url, options);

  // Detect x-demo header — two-way: can turn demo ON or OFF
  let isDemo = false;
  const demoHeader = res.headers.get('x-demo');
  if (demoHeader === 'true' || demoHeader === 'false') {
    isDemo = demoHeader === 'true';
    if (typeof window !== 'undefined') {
      requestAnimationFrame(() => {
        const store = useTradingStore.getState();
        if (store.demoMode !== isDemo) store.setDemoMode(isDemo);
      });
    }
  }

  let data: T;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    data = await res.json();
  } else {
    data = (await res.text()) as unknown as T;
  }

  return { data, demo: isDemo };
}

/**
 * Quick GET helper.
 */
export async function apiGet<T = any>(url: string) {
  return apiFetch<T>(url, { method: 'GET' });
}

/**
 * Quick POST helper.
 */
export async function apiPost<T = any>(url: string, body?: any) {
  return apiFetch<T>(url, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
  });
}
