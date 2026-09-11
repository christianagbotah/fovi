import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../..');
const PROXY = resolve(ROOT, 'src/proxy.ts');

describe('Phase 3AX admin privilege revalidation', () => {
  it('revalidates an embedded admin claim against the current ADMIN_EMAIL', () => {
    const source = readFileSync(PROXY, 'utf8');

    const helper = source.indexOf('function currentEffectiveRole(');
    const adminClaim = source.indexOf("if (payload.role !== 'admin') return payload.role;", helper);
    const config = source.indexOf("process.env.ADMIN_EMAIL?.trim().toLowerCase()", adminClaim);
    const tokenEmail = source.indexOf("payload.email?.trim().toLowerCase()", config);
    const mismatch = source.indexOf('tokenEmail !== configuredAdminEmail', tokenEmail);
    const revoke = source.indexOf('return undefined;', mismatch);

    expect(helper).toBeGreaterThanOrEqual(0);
    expect(adminClaim).toBeGreaterThan(helper);
    expect(config).toBeGreaterThan(adminClaim);
    expect(tokenEmail).toBeGreaterThan(config);
    expect(mismatch).toBeGreaterThan(tokenEmail);
    expect(revoke).toBeGreaterThan(mismatch);
  });

  it('does not forward a stale admin role into trusted request headers', () => {
    const source = readFileSync(PROXY, 'utf8');

    const effectiveRole = source.indexOf('const effectiveRole = currentEffectiveRole(payload);');
    const roleHeader = source.indexOf("cleanedHeaders.set('X-User-Role', effectiveRole)", effectiveRole);

    expect(effectiveRole).toBeGreaterThanOrEqual(0);
    expect(roleHeader).toBeGreaterThan(effectiveRole);
    expect(source).not.toContain("cleanedHeaders.set('X-User-Role', payload.role)");
  });

  it('authorizes admin routes with the revalidated role, not the stale JWT claim', () => {
    const source = readFileSync(PROXY, 'utf8');

    const adminBoundary = source.indexOf('if (matchesAnyPrefix(pathname, ADMIN_PREFIXES))');
    const currentRoleCheck = source.indexOf("if (effectiveRole !== 'admin')", adminBoundary);

    expect(adminBoundary).toBeGreaterThanOrEqual(0);
    expect(currentRoleCheck).toBeGreaterThan(adminBoundary);

    const adminBlock = source.slice(adminBoundary);
    expect(adminBlock).not.toContain("if (payload.role !== 'admin')");
  });

  it('preserves non-admin role claims for forward compatibility', () => {
    const source = readFileSync(PROXY, 'utf8');
    expect(source).toContain("if (payload.role !== 'admin') return payload.role;");
  });
});