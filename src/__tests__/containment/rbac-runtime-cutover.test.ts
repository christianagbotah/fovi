import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../..');
const proxySource = readFileSync(resolve(ROOT, 'src/proxy.ts'), 'utf8');
const signinSource = readFileSync(resolve(ROOT, 'src/app/api/auth/signin/route.ts'), 'utf8');
const refreshSource = readFileSync(resolve(ROOT, 'src/app/api/auth/refresh/route.ts'), 'utf8');
const twoFactorSource = readFileSync(
  resolve(ROOT, 'src/app/api/auth/two-factor/authenticate/route.ts'),
  'utf8',
);

describe('Phase 3BB durable RBAC runtime cutover', () => {
  it('requires current durable admin.access permission for admin API routes', () => {
    expect(proxySource).toContain(
      "import { AUTHZ_PERMISSIONS, getAuthorizationSnapshot } from '@/lib/rbac';",
    );

    const adminBoundary = proxySource.indexOf(
      'if (matchesAnyPrefix(pathname, ADMIN_PREFIXES))',
    );
    const snapshotLookup = proxySource.indexOf(
      'await getAuthorizationSnapshot(payload.sub)',
      adminBoundary,
    );
    const permissionCheck = proxySource.indexOf(
      'authorization.permissions.includes(AUTHZ_PERMISSIONS.ADMIN_ACCESS)',
      snapshotLookup,
    );

    expect(adminBoundary).toBeGreaterThanOrEqual(0);
    expect(snapshotLookup).toBeGreaterThan(adminBoundary);
    expect(permissionCheck).toBeGreaterThan(snapshotLookup);
  });

  it('distinguishes authorization infrastructure failure from forbidden access', () => {
    const adminBoundary = proxySource.indexOf(
      'if (matchesAnyPrefix(pathname, ADMIN_PREFIXES))',
    );
    const adminBlock = proxySource.slice(adminBoundary);

    expect(adminBlock).toContain("code: 'AUTHORIZATION_UNAVAILABLE'");
    expect(adminBlock).toContain('{ status: 503 }');
    expect(adminBlock).toContain("code: 'FORBIDDEN'");
    expect(adminBlock).toContain('{ status: 403 }');
  });

  it('does not authorize or propagate JWT role claims', () => {
    expect(proxySource).not.toContain("if (payload.role !== 'admin')");
    expect(proxySource).not.toContain("cleanedHeaders.set('X-User-Role', payload.role)");
    expect(proxySource).not.toContain("cleanedHeaders.set('X-User-Role'");
  });

  it('does not derive access-token privilege from ADMIN_EMAIL during issuance', () => {
    for (const source of [signinSource, refreshSource, twoFactorSource]) {
      expect(source).not.toContain('ADMIN_EMAIL');
      expect(source).not.toContain("isAdmin ? 'admin' : undefined");
    }
  });

  it('keeps persistent session-family binding while omitting role claims', () => {
    expect(signinSource).toContain(
      "user.name || undefined,\n        undefined,\n        session.familyId,",
    );
    expect(refreshSource).toContain(
      "rotation.user.name || undefined,\n    undefined,\n    rotation.familyId,",
    );
    expect(twoFactorSource).toContain(
      "user.name || undefined,\n      undefined,\n      session.familyId,",
    );
  });
});
