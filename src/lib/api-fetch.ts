// ============================================================
// API Fetch Wrapper
// Wraps fetch() to:
// 1. Auto-attach Authorization header from store
// 2. Rotate a server-side refresh session after an authenticated 401
// 3. Detect x-demo response header and update store
// ============================================================

import { useTradingStore } from './store/trading-store';

// Access token is still read from localStorage for compatibility with the
// current browser auth boundary. Refresh secrets remain HttpOnly cookies and
// are never exposed to JavaScript.
function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('fovi_token');
}

function isAuthEndpoint(url: string): boolean {
  return url.includes('/api/auth/');
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
        localStorage.removeItem('fovi_token');
        localStorage.removeItem('fovi_user');
      }
      return null;
    }

    const data = await response.json();
    if (!data || typeof data.token !== 'string' || data.token.length === 0) {
      return null;
    }

    localStorage.setItem('fovi_token', data.token);
    if (data.user) {
      localStorage.setItem('fovi_user', JSON.stringify(data.user));
    }
    return data.token;
  } catch {
    return null;
  }
}

/**
 * Typed fetch wrapper that auto-injects auth token, performs one refresh
 * rotation after an authenticated 401, and detects demo mode.
 */
export async function apiFetch<T = any>(
  url: string,
  options: RequestInit = {},
): Promise<{ data: T; demo: boolean }> {
  const token = getToken();
  const headers = new Headers(options.headers || {});
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!headers.has('Content-Type') && options.method && options.method !== 'GET') {
    headers.set('Content-Type', 'application/json');
  }

  let res = await fetch(url, {
    ...options,
    headers,
    credentials: options.credentials || 'same-origin',
  });

  if (res.status === 401 && token && !isAuthEndpoint(url)) {
    const nextToken = await refreshAccessToken();
    if (nextToken) {
      const retryHeaders = new Headers(options.headers || {});
      retryHeaders.set('Authorization', `Bearer ${nextToken}`);
      if (!retryHeaders.has('Content-Type') && options.method && options.method !== 'GET') {
        retryHeaders.set('Content-Type', 'application/json');
      }

      res = await fetch(url, {
        ...options,
        headers: retryHeaders,
        credentials: options.credentials || 'same-origin',
      });
    }
  }

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
