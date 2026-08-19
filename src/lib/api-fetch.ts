// ============================================================
// API Fetch Wrapper
// Wraps fetch() to:
// 1. Auto-attach Authorization header from store
// 2. Detect x-demo response header and update store
// ============================================================

import { useTradingStore } from './store/trading-store';

// Token is read from localStorage directly (works outside React)
function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('fovi_token');
}

/**
 * Typed fetch wrapper that auto-injects auth token and detects demo mode.
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

  const res = await fetch(url, { ...options, headers });

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
