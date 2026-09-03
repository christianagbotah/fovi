import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const ROUTE = join(process.cwd(), 'src/app/api/auth/change-password/route.ts');

describe('Phase 3Z verified password-change identity boundary', () => {
  it('derives the user only from a verified access bearer token', () => {
    const source = readFileSync(ROUTE, 'utf8');

    expect(source).toContain('const bearerToken = extractBearerToken(request);');
    expect(source).toContain('const accessPayload = await verifyToken(bearerToken);');
    expect(source).toContain("accessPayload.type !== 'access'");
    expect(source).toContain('const userId = accessPayload.sub;');
    expect(source).not.toContain("request.headers.get('X-User-Id')");
    expect(source).not.toContain('request.headers.get("X-User-Id")');
  });

  it('keeps session and 2FA revocation in the password-change transaction', () => {
    const source = readFileSync(ROUTE, 'utf8');

    expect(source).toContain("revokeAllAuthSessionsForUser(tx, user.id, 'PASSWORD_CHANGED')");
    expect(source).toContain('revokeTwoFactorChallengesForUser(tx, user.id)');
    expect(source).toContain("clearRefreshCookie(response)");
  });

  it('uses the non-cacheable auth response boundary', () => {
    const source = readFileSync(ROUTE, 'utf8');

    expect(source).toContain("import { authJson } from '@/lib/auth-response';");
    expect(source).not.toContain('NextResponse.json');
  });
});
