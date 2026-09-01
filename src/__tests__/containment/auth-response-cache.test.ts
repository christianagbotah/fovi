import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { authJson } from '@/lib/auth-response';

const ROOT = resolve(__dirname, '../../..');
const SENSITIVE_AUTH_ROUTES = [
  'src/app/api/auth/signin/route.ts',
  'src/app/api/auth/refresh/route.ts',
  'src/app/api/auth/two-factor/authenticate/route.ts',
  'src/app/api/auth/logout/route.ts',
];

describe('Phase 3M non-cacheable authentication responses', () => {
  it('sets explicit no-store headers on auth responses', () => {
    const response = authJson({ token: 'test-only-token' });

    expect(response.headers.get('cache-control')).toBe('no-store, max-age=0');
    expect(response.headers.get('pragma')).toBe('no-cache');
  });

  it('routes credential and session endpoints through the shared auth response boundary', () => {
    for (const route of SENSITIVE_AUTH_ROUTES) {
      const source = readFileSync(resolve(ROOT, route), 'utf8');
      expect(source, route).toContain("import { authJson } from '@/lib/auth-response';");
      expect(source, route).toContain('authJson(');
      expect(source, route).not.toContain('NextResponse.json(');
    }
  });
});
