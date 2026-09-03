import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const ROUTE = join(process.cwd(), 'src/app/api/auth/me/route.ts');

describe('Phase 3Y bearer-only auth me boundary', () => {
  it('accepts access credentials only through the bearer boundary', () => {
    const source = readFileSync(ROUTE, 'utf8');

    expect(source).toContain('const token = extractBearerToken(request);');
    expect(source).not.toContain("request.nextUrl.searchParams.get('token')");
    expect(source).not.toContain('searchParams.get("token")');
  });

  it('uses the hardened non-cacheable auth response boundary', () => {
    const source = readFileSync(ROUTE, 'utf8');

    expect(source).toContain("import { authJson } from '@/lib/auth-response';");
    expect(source).not.toContain('NextResponse.json');
    expect(source).toContain("payload.type !== 'access'");
  });
});
