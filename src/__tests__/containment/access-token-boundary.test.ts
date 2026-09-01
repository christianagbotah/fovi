import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../..');
const SRC = resolve(ROOT, 'src');
const PAGE = resolve(ROOT, 'src/app/page.tsx');
const API_FETCH = resolve(ROOT, 'src/lib/api-fetch.ts');

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

describe('Phase 3G browser access-token boundary', () => {
  it('keeps browser access-token reads, writes, and Bearer construction inside approved boundaries', () => {
    expect(browserAccessTokenViolations()).toEqual([]);
  });

  it('routes dashboard authentication through the central refresh-aware boundary', () => {
    const page = readFileSync(PAGE, 'utf8');
    expect(page).toContain("import { authFetch, hydrateBrowserAuthFromStorage } from '@/lib/api-fetch';");
    expect(page).toContain('hydrateBrowserAuthFromStorage()');
    expect(page).toContain("authFetch('/api/auth/me')");
    expect(page).not.toContain("localStorage.getItem('fovi_token')");
    expect(page).not.toMatch(/Authorization:\s*`Bearer\s+\$\{/);
  });

  it('allows protected auth endpoints to refresh without recursive refresh/logout retries', () => {
    const apiFetch = readFileSync(API_FETCH, 'utf8');
    expect(apiFetch).toContain("url.includes('/api/auth/refresh')");
    expect(apiFetch).toContain("url.includes('/api/auth/logout')");
    expect(apiFetch).toContain('!isRefreshBoundaryEndpoint(url)');
    expect(apiFetch).not.toContain("return url.includes('/api/auth/');");
  });
});
