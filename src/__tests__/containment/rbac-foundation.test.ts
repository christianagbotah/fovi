import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../..');
const PACKAGE = resolve(ROOT, 'package.json');
const RBAC_SCHEMA = resolve(ROOT, 'prisma/rbac.prisma');
const RBAC_MIGRATION = resolve(
  ROOT,
  'prisma/migrations/20260911015500_rbac_foundation/migration.sql',
);
const RBAC_HELPER = resolve(ROOT, 'src/lib/rbac.ts');
const BOOTSTRAP = resolve(ROOT, 'scripts/bootstrap-rbac-admin.ts');
const PRODUCTION_MIGRATION = resolve(ROOT, 'scripts/migrate-production.ts');

describe('Phase 3BA explicit RBAC foundation', () => {
  it('configures Prisma to load the multi-file schema directory', () => {
    const pkg = JSON.parse(readFileSync(PACKAGE, 'utf8')) as {
      prisma?: { schema?: string };
      scripts?: Record<string, string>;
    };

    expect(pkg.prisma?.schema).toBe('prisma');
    expect(pkg.scripts?.['auth:bootstrap-admin']).toBe(
      'bun scripts/bootstrap-rbac-admin.ts',
    );
  });

  it('defines explicit role, permission, assignment, and grant records', () => {
    const source = readFileSync(RBAC_SCHEMA, 'utf8');

    expect(source).toContain('model Role {');
    expect(source).toContain('model Permission {');
    expect(source).toContain('model UserRole {');
    expect(source).toContain('model RolePermission {');
    expect(source).toContain('@@id([userId, roleId])');
    expect(source).toContain('@@id([roleId, permissionId])');
  });

  it('seeds a granular admin permission catalog instead of an email identity', () => {
    const source = readFileSync(RBAC_MIGRATION, 'utf8');

    expect(source).toContain("'system_admin'");
    expect(source).toContain("'admin.access'");
    expect(source).toContain("'admin.users.read'");
    expect(source).toContain("'admin.users.write'");
    expect(source).toContain("'admin.finance.read'");
    expect(source).toContain("'admin.subscriptions.write'");
    expect(source).toContain("'admin.config.write'");
    expect(source).toContain("'admin.brokers.write'");
    expect(source).not.toContain('@');
  });

  it('revalidates the current user before honoring durable role assignments', () => {
    const source = readFileSync(RBAC_HELPER, 'utf8');

    const userLookup = source.indexOf('database.user.findUnique');
    const activeCheck = source.indexOf('if (!user?.isActive) return null;', userLookup);
    const roleLookup = source.indexOf('database.userRole.findMany', activeCheck);

    expect(userLookup).toBeGreaterThanOrEqual(0);
    expect(activeCheck).toBeGreaterThan(userLookup);
    expect(roleLookup).toBeGreaterThan(activeCheck);
    expect(source).toContain('return null;');
    expect(source).toContain("'[RBAC] Authorization lookup failed:'");
  });

  it('accepts an existing admin assignment only when its user is active and verified', () => {
    const source = readFileSync(BOOTSTRAP, 'utf8');

    expect(source).toContain('await prisma.userRole.findMany');
    expect(source).toContain('id: { in: existingAssignments.map');
    expect(source).toContain('isActive: true');
    expect(source).toContain('emailVerified: true');
    expect(source).toContain('if (existingAdmin)');
  });

  it('allows a truly empty installation to deploy without fabricating an admin identity', () => {
    const source = readFileSync(BOOTSTRAP, 'utf8');

    expect(source).toContain('const userCount = await prisma.user.count();');
    expect(source).toContain('if (userCount === 0)');
    expect(source).toContain('initial administrator assignment is deferred');
  });

  it('fails closed for an established user base unless a safe bootstrap target can be proven', () => {
    const source = readFileSync(BOOTSTRAP, 'utf8');

    expect(source).toContain('process.env.RBAC_BOOTSTRAP_ADMIN_EMAIL');
    expect(source).toContain('process.env.ADMIN_EMAIL');
    expect(source).toContain('users exist, no active verified system_admin assignment exists');
    expect(source).toContain('if (!user.isActive)');
    expect(source).toContain('if (!user.emailVerified)');
    expect(source).toContain('await prisma.userRole.upsert');
    expect(source).toContain('process.exitCode = 1');
  });

  it('runs RBAC bootstrap only after committed production migrations are applied and verified', () => {
    const source = readFileSync(PRODUCTION_MIGRATION, 'utf8');

    const migrateDeploy = source.indexOf("runPrisma(['migrate', 'deploy'");
    const migrateStatus = source.indexOf("runPrisma(['migrate', 'status'", migrateDeploy);
    const rbacBootstrap = source.indexOf("runPackageScript('auth:bootstrap-admin')", migrateStatus);
    const migrationPassed = source.indexOf("console.log('[migration] Production migration gate passed.')", rbacBootstrap);

    expect(migrateDeploy).toBeGreaterThanOrEqual(0);
    expect(migrateStatus).toBeGreaterThan(migrateDeploy);
    expect(rbacBootstrap).toBeGreaterThan(migrateStatus);
    expect(migrationPassed).toBeGreaterThan(rbacBootstrap);
  });

  it('does not wire runtime authorization back to ADMIN_EMAIL in the RBAC helper', () => {
    const source = readFileSync(RBAC_HELPER, 'utf8');
    expect(source).not.toContain('ADMIN_EMAIL');
    expect(source).not.toContain('process.env');
  });
});