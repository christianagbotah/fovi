import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../..');
const SRC = resolve(ROOT, 'src');
const PAGE = resolve(ROOT, 'src/app/page.tsx');
const SIGNIN = resolve(ROOT, 'src/app/auth/signin/page.tsx');
const API_FETCH = resolve(ROOT, 'src/lib/api-fetch.ts');
const TRADING_STORE = resolve(ROOT, 'src/lib/store/trading-store.ts');

const APPROVED_BROWSER_AUTH_BOUNDARIES = new Set([
  'src/lib/api-fetch.ts',
  'src/lib/store/trading-store.ts',
]);

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const absolute = resolve(dir, entry);
    const stat = statSync(absolute);
    if (stat.isDirectory()) {
      files.push(...sourceFiles(absolute));
      continue;
    }
    if (absolute.endsWith('.ts') || absolute.endsWith('.tsx')) files.push(absolute);
  }
  return files;
}

function isBrowserCandidate(path: string, content: string): boolean {
  const repoPath = relative(ROOT, path).replaceAll('\\', '/');
  if (repoPath.startsWith('src/__tests__/')) return false;
  if (repoPath.startsWith('src/app/api/')) return false;
  if (repoPath === 'src/proxy.ts') return false;
  if (repoPath.startsWith('src/lib/auth')) return false;
  if (repoPath === 'src/lib/db.ts' || repoPath === 'src/lib/rate-limit.ts') return false;
  if (APPROVED_BROWSER_AUTH_BOUNDARIES.has(repoPath)) return false;

  return (
    repoPath.startsWith('src/components/') ||
    repoPath.startsWith('src/hooks/') ||
    repoPath.startsWith('src/app/') ||
    content.includes("'use client'") ||
    content.includes('"use client"')
  );
}

function browserAccessTokenViolations(): string[] {
  const violations: string[] = [];

  for (const path of sourceFiles(SRC)) {
    const content = readFileSync(path, 'utf8');
    if (!isBrowserCandidate(path, content)) continue;

    const repoPath = relative(ROOT, path).replaceAll('\\', '/');
    const reasons: string[] = [];

    if (/localStorage\.(?:getItem|setItem)\(\s*['"]fovi_token['"]/.test(content)) {
      reasons.push('direct fovi_token localStorage access');
    }
    if (/['"]Authorization['"]\s*[,):=]/.test(content) || /\.set\(\s*['"]Authorization['"]/.test(content)) {
      reasons.push('direct Authorization header construction');
    }
    if (/Bearer\s+\$\{/.test(content)) {
      reasons.push('direct Bearer credential construction');
    }

    if (reasons.length > 0) violations.push(`${repoPath}: ${reasons.join(', ')}`);
  }

  return violations.sort();
}

function persistentAccessTokenViolations(): string[] {
  const violations: string[] = [];
  for (const path of sourceFiles(SRC)) {
    const repoPath = relative(ROOT, path).replaceAll('\\', '/');
    if (repoPath.startsWith('src/__tests__/')) continue;
    const content = readFileSync(path, 'utf8');
    if (/(?:localStorage|sessionStorage)\.(?:getItem|setItem)\(\s*['"]fovi_token['"]/.test(content)) {
      violations.push(repoPath);
    }
  }
  return violations.sort();
}

describe('Phase 3G/3I browser access-token boundary', () => {
  it('keeps browser Bearer construction inside approved boundaries', () => {
    expect(browserAccessTokenViolations()).toEqual([]);
  });

  it('never persists or restores an access JWT from browser storage', () => {
    expect(persistentAccessTokenViolations()).toEqual([]);

    const apiFetch = readFileSync(API_FETCH, 'utf8');
    const store = readFileSync(TRADING_STORE, 'utf8');
    expect(apiFetch).toContain('return useTradingStore.getState().authToken;');
    expect(apiFetch).not.toMatch(/(?:localStorage|sessionStorage)\.getItem\(\s*['"]fovi_token['"]/);
    expect(store).not.toMatch(/(?:localStorage|sessionStorage)\.setItem\(\s*['"]fovi_token['"]/);
    expect(store).not.toMatch(/(?:localStorage|sessionStorage)\.setItem\(\s*['"]fovi_user['"]/);
  });

  it('bootstraps dashboard authentication from the HttpOnly refresh session', () => {
    const page = readFileSync(PAGE, 'utf8');
    const apiFetch = readFileSync(API_FETCH, 'utf8');

    expect(page).toContain("import { authFetch, bootstrapBrowserAuth } from '@/lib/api-fetch';");
    expect(page).toContain('void bootstrapBrowserAuth();');
    expect(page).not.toContain('hydrateBrowserAuthFromStorage');
    expect(apiFetch).toContain("fetch('/api/auth/refresh'");
    expect(apiFetch).toContain('export async function bootstrapBrowserAuth()');
    expect(apiFetch).toContain('purgeLegacyPersistedAuth();');
  });

  it('preserves the memory-only access token across sign-in navigation', () => {
    const signin = readFileSync(SIGNIN, 'utf8');
    expect(signin).toContain("import { useRouter } from 'next/navigation';");
    expect(signin).toContain("router.replace('/');");
    expect(signin).not.toContain("window.location.href = '/';");
  });

  it('allows a 401 without an in-memory token to recover through refresh once', () => {
    const apiFetch = readFileSync(API_FETCH, 'utf8');
    expect(apiFetch).toContain('if (res.status === 401 && !isRefreshBoundaryEndpoint(url))');
    expect(apiFetch).not.toContain('res.status === 401 && token &&');
    expect(apiFetch).toContain("url.includes('/api/auth/refresh')");
    expect(apiFetch).toContain("url.includes('/api/auth/logout')");
  });
});
