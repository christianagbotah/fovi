import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const proxySource = readFileSync(resolve(__dirname, '../../../src/proxy.ts'), 'utf8');
const signinSource = readFileSync(resolve(__dirname, '../../../src/app/api/auth/signin/route.ts'), 'utf8');

describe('Phase 3AX admin role revalidation', () => {
  it('keeps admin authority tied to the current ADMIN_EMAIL configuration', () => {
    expect(signinSource).toContain('const isAdmin = process.env.ADMIN_EMAIL');
    expect(proxySource).toContain('function hasCurrentAdminAuthority');
    expect(proxySource).toContain('const configuredAdminEmail = process.env.ADMIN_EMAIL;');
    expect(proxySource).toContain("payload.role !== 'admin'");
    expect(proxySource).toContain('tokenEmail.toLowerCase() === configuredAdminEmail.toLowerCase()');
  });

  it('fails closed when ADMIN_EMAIL is missing or whitespace-padded', () => {
    expect(proxySource).toContain('!configuredAdminEmail || configuredAdminEmail.trim() !== configuredAdminEmail');
    expect(proxySource).toContain('tokenEmail.trim() !== tokenEmail');
  });

  it('does not propagate a stale admin role to downstream API handlers', () => {
    expect(proxySource).toContain("const verifiedRole = payload.role === 'admin'");
    expect(proxySource).toContain("hasCurrentAdminAuthority(payload) ? 'admin' : undefined");
    expect(proxySource).toContain("if (verifiedRole) cleanedHeaders.set('X-User-Role', verifiedRole);");
    expect(proxySource).not.toContain("if (payload.role) cleanedHeaders.set('X-User-Role', payload.role);");
  });

  it('requires revalidated authority for /api/admin routes', () => {
    expect(proxySource).toContain("'/api/admin/',");
    expect(proxySource).toContain("if (verifiedRole !== 'admin')");
    expect(proxySource).not.toContain("if (payload.role !== 'admin')");
  });
});
