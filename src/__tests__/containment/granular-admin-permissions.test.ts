import { readdirSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../..');
const ADMIN_ROOT = resolve(ROOT, 'src/app/api/admin');
const AUTH_HELPER = resolve(ROOT, 'src/lib/admin-authorization.ts');

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

const EXPECTED: Record<string, Partial<Record<Method, string>>> = {
  'brokers/[id]/route.ts': {
    PUT: 'AUTHZ_PERMISSIONS.ADMIN_BROKERS_WRITE',
    DELETE: 'AUTHZ_PERMISSIONS.ADMIN_BROKERS_WRITE',
  },
  'brokers/route.ts': {
    GET: 'AUTHZ_PERMISSIONS.ADMIN_BROKERS_READ',
    POST: 'AUTHZ_PERMISSIONS.ADMIN_BROKERS_WRITE',
  },
  'brokers/seed/route.ts': {
    POST: 'AUTHZ_PERMISSIONS.ADMIN_BROKERS_WRITE',
  },
  'config/email-test/route.ts': {
    POST: 'AUTHZ_PERMISSIONS.ADMIN_CONFIG_WRITE',
  },
  'config/hubtel-payment/route.ts': {
    GET: 'AUTHZ_PERMISSIONS.ADMIN_CONFIG_READ',
    POST: 'AUTHZ_PERMISSIONS.ADMIN_CONFIG_WRITE',
  },
  'config/hubtel-sms/route.ts': {
    GET: 'AUTHZ_PERMISSIONS.ADMIN_CONFIG_READ',
    POST: 'AUTHZ_PERMISSIONS.ADMIN_CONFIG_WRITE',
  },
  'config/otp/route.ts': {
    GET: 'AUTHZ_PERMISSIONS.ADMIN_CONFIG_READ',
    POST: 'AUTHZ_PERMISSIONS.ADMIN_CONFIG_WRITE',
  },
  'config/platform/route.ts': {
    GET: 'AUTHZ_PERMISSIONS.ADMIN_CONFIG_READ',
    POST: 'AUTHZ_PERMISSIONS.ADMIN_CONFIG_WRITE',
  },
  'config/smtp/route.ts': {
    GET: 'AUTHZ_PERMISSIONS.ADMIN_CONFIG_READ',
    POST: 'AUTHZ_PERMISSIONS.ADMIN_CONFIG_WRITE',
  },
  'config/trading/route.ts': {
    GET: 'AUTHZ_PERMISSIONS.ADMIN_CONFIG_READ',
    POST: 'AUTHZ_PERMISSIONS.ADMIN_CONFIG_WRITE',
  },
  'finance/route.ts': {
    GET: 'AUTHZ_PERMISSIONS.ADMIN_FINANCE_READ',
  },
  'subscriptions/route.ts': {
    GET: 'AUTHZ_PERMISSIONS.ADMIN_SUBSCRIPTIONS_READ',
    POST: 'AUTHZ_PERMISSIONS.ADMIN_SUBSCRIPTIONS_WRITE',
  },
  'users/[id]/route.ts': {
    PATCH: 'AUTHZ_PERMISSIONS.ADMIN_USERS_WRITE',
    DELETE: 'AUTHZ_PERMISSIONS.ADMIN_USERS_WRITE',
  },
  'users/route.ts': {
    GET: 'AUTHZ_PERMISSIONS.ADMIN_USERS_READ',
  },
};

function collectRouteFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const fullPath = resolve(directory, entry);
    if (statSync(fullPath).isDirectory()) return collectRouteFiles(fullPath);
    return entry === 'route.ts' ? [fullPath] : [];
  });
}

function methodBlock(source: string, method: Method): string {
  const marker = `export async function ${method}`;
  const start = source.indexOf(marker);
  if (start < 0) return '';
  const next = source.indexOf('export async function ', start + marker.length);
  return source.slice(start, next < 0 ? undefined : next);
}

describe('Phase 3BC granular admin authorization', () => {
  it('has an explicit permission contract for every admin route file', () => {
    const discovered = collectRouteFiles(ADMIN_ROOT)
      .map((file) => relative(ADMIN_ROOT, file).replaceAll('\\', '/'))
      .sort();
    const expected = Object.keys(EXPECTED).sort();

    expect(discovered).toEqual(expected);
  });

  it('guards every exported admin HTTP method with its narrow permission', () => {
    for (const [relativePath, methods] of Object.entries(EXPECTED)) {
      const source = readFileSync(resolve(ADMIN_ROOT, relativePath), 'utf8');
      expect(source).toContain("from '@/lib/admin-authorization'");
      expect(source).toContain("from '@/lib/rbac'");

      for (const [method, permission] of Object.entries(methods) as Array<[Method, string]>) {
        const block = methodBlock(source, method);
        expect(block, `${relativePath} must export ${method}`).not.toBe('');
        expect(block, `${relativePath} ${method} must call the route guard`).toContain(
          'requireAdminPermission(',
        );
        expect(block, `${relativePath} ${method} must require ${permission}`).toContain(permission);
        expect(block, `${relativePath} ${method} must stop on denied authorization`).toContain(
          'if (!authorization.ok) return authorization.response;',
        );
      }
    }
  });

  it('does not allow legacy role-header authorization in any admin handler', () => {
    for (const file of collectRouteFiles(ADMIN_ROOT)) {
      const source = readFileSync(file, 'utf8').toLowerCase();
      expect(source, relative(ADMIN_ROOT, file)).not.toContain('x-user-role');
    }
  });

  it('re-verifies identity and current durable permissions inside the route guard', () => {
    const source = readFileSync(AUTH_HELPER, 'utf8');

    expect(source).toContain('extractBearerToken(request)');
    expect(source).toContain('await verifyToken(token)');
    expect(source).toContain('await getAuthorizationSnapshot(payload.sub)');
    expect(source).toContain('AUTHZ_PERMISSIONS.ADMIN_ACCESS');
    expect(source).toContain('granted.has(permission)');
    expect(source).toContain("code: 'AUTH_REQUIRED'");
    expect(source).toContain("code: 'AUTHORIZATION_UNAVAILABLE'");
    expect(source).toContain("code: 'FORBIDDEN'");
  });
});
