// ============================================================
// API Fetch Wrapper
// Central browser access-token boundary:
// 1. Auto-attach the access token
// 2. Rotate a server-side refresh session after an authenticated 401
// 3. Retry the original request once with the rotated access token
// 4. Hydrate browser auth without exposing storage access to page components
// 5. Detect x-demo response headers for typed API callers
// ============================================================

import { useTradingStore } from './store/trading-store';

// Access token is still read from localStorage for compatibility with the
// current browser auth boundary. Refresh secrets remain HttpOnly cookies and
// are never exposed to JavaScript.
function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('fovi_token');
}

function isRefreshBoundaryEndpoint(url: string): boolean {
  return url.includes('/api/auth/refresh') || url.includes('/api/auth/logout');
}

function clearBrowserAccessState(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('fovi_token');
    localStorage.removeItem('fovi_user');
  }
  useTradingStore.setState({ authUser: null, authToken: null, isAuthenticated: false });
}

/**
 * Restore the last browser access identity into Zustand without allowing page
 * components to read access credentials from localStorage directly. The
 * caller should validate it through authFetch('/api/auth/me'); a 401 can then
 * rotate the HttpOnly refresh session once before the identity is cleared.
 */
export function hydrateBrowserAuthFromStorage(): boolean {
  if (typeof window === 'undefined') return false;

  const token = getToken();
  const rawUser = localStorage.getItem('fovi_user');
  if (!token || !rawUser) return false;

  try {
    const user = JSON.parse(rawUser);
    if (!user || typeof user.id !== 'string' || typeof user.email !== 'string') {
      clearBrowserAccessState();
      return false;
    }

    useTradingStore.setState({ authUser: user, authToken: token, isAuthenticated: true });
    return true;
  } catch {
    clearBrowserAccessState();
    return false;
  }
}

async function refreshAccessToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null;

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
      return null;
    }

    // Keep in-memory Zustand auth and localStorage on the same rotated access token.
    useTradingStore.getState().setAuth(data.user, data.token);
    return data.token;
  } catch {
    return null;
  }
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
 * need status codes or response headers. It performs at most one refresh and
 * one retry. Refresh/logout are explicitly excluded to prevent recursion.
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

  if (res.status === 401 && token && !isRefreshBoundaryEndpoint(url)) {
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