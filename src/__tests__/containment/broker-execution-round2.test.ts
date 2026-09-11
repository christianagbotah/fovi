// ============================================================
// broker-execution-round2.test.ts — Regression tests for the
// architect's SECOND correction round (items 2, 4, 5).
//
// Real route handlers, repositories, the connection manager and
// the canonical provider registry run for real against the
// faithful fake PostgreSQL (unique constraints, $transaction
// rollback) — only the database wire is replaced. The fake-DB
// level complements broker-execution-postgres.test.ts (real
// PostgreSQL) so these regressions hold in EVERY CI run, with or
// without a database service.
//
// Covered regressions:
//   ITEM 2 — cross-tenant existence oracle removed:
//     - resolveOwnedConnection: foreign vs non-existent ids give
//       IDENTICAL resolutions (status, code, message).
//   ITEM 4 — unified transactional audit sanitizer:
//     - sanitizeBrokerAuditInput redacts NESTED credential fields
//     - over-long User-Agent truncated to 256 chars
//     - malformed forwarded-for data dropped; valid chains reduced
//       to the first validated IP
//     - length caps on identifiers and reason text
//     - the input object is never mutated
//     - the TRANSACTIONAL path (connection create) and the
//       STANDALONE path (AuditRepository.append) persist the SAME
//       sanitized ipMetadata shape
//   ITEM 5 — operational state is server-owned:
//     - PATCH /connections/[id] rejects isActive (400, strict)
//     - PATCH with only accountName succeeds and never touches
//       isActive
//     - ConnectionManager.testConnection reports success ONLY
//       when BOTH the canonical registry AND the record say demo
//       — a non-demo record can never be "tested successfully"
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { FakeBrokerDb } from '../helpers/broker-execution-fake-db';

// Trigger the db mock at module-load time.
import '@/lib/broker-execution/persistence/db-access';

// ── db wire mock (reuses the globalThis instance across resets) ──
vi.mock('@/lib/db', async () => {
  const existing = (globalThis as unknown as Record<string, unknown>).__brokerFakeDb;
  if (existing) {
    return {
      db: (existing as { db: unknown }).db,
      dbAvailable: true,
      isDbAvailable: () =>
        (globalThis as unknown as Record<string, unknown>).__brokerFakeDbAvailable === true,
      hasModel: () => true,
      safeDbQuery: async (fn: () => Promise<unknown>) => {
        try {
          return await fn();
        } catch {
          return undefined;
        }
      },
      DEMO_USER_ID: 'usr_demo_1',
      ensureDemoUser: async () => null,
    };
  }
  const { createFakeBrokerDb } = await import('../helpers/broker-execution-fake-db');
  const control = createFakeBrokerDb();
  (globalThis as unknown as Record<string, unknown>).__brokerFakeDb = control;
  (globalThis as unknown as Record<string, unknown>).__brokerFakeDbAvailable = true;
  return {
    db: control.db,
    dbAvailable: true,
    isDbAvailable: () =>
      (globalThis as unknown as Record<string, unknown>).__brokerFakeDbAvailable === true,
    hasModel: () => true,
    safeDbQuery: async (fn: () => Promise<unknown>) => {
      try {
        return await fn();
      } catch {
        return undefined;
      }
    },
    DEMO_USER_ID: 'usr_demo_1',
    ensureDemoUser: async () => null,
  };
});

function fakeDb(): FakeBrokerDb {
  return (globalThis as unknown as Record<string, unknown>).__brokerFakeDb as FakeBrokerDb;
}

function seedConnection(
  overrides: Partial<Record<string, unknown>> & { id: string; tenantId: string },
): void {
  const table = fakeDb().__tables.get('brokerConnection')!;
  table.set(overrides.id, {
    providerId: 'demo',
    accountId: null,
    accountName: null,
    accountType: 'demo',
    isDemo: true,
    isActive: false,
    connectionState: 'DISCONNECTED',
    encryptedApiKey: null,
    encryptedApiSecret: null,
    encryptedPassphrase: null,
    encryptedToken: null,
    encryptedRefreshToken: null,
    credentialVersion: 0,
    lastConnectedAt: null,
    lastErrorAt: null,
    errorMessage: null,
    reconnectAttempts: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });
}

function authedReq(userId: string, url: string, method = 'GET', body?: unknown): NextRequest {
  const headers: Record<string, string> = { 'x-user-id': userId, 'Content-Type': 'application/json' };
  const init: RequestInit & { headers: Record<string, string> } = { method, headers };
  if (body) init.body = JSON.stringify(body);
  return new NextRequest(new URL(url), init as ConstructorParameters<typeof NextRequest>[1]);
}

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  vi.clearAllMocks();
  fakeDb().__reset();
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

// ════════════════════════════════════════════════════════════════
// ITEM 2 — resolveOwnedConnection: identical 404 for foreign and
// non-existent connections
// ════════════════════════════════════════════════════════════════

describe('Round 2, item 2: cross-tenant existence oracle removed', () => {
  it('resolveOwnedConnection: a foreign REAL id and a RANDOM id give IDENTICAL resolutions', async () => {
    const { resolveOwnedConnection } = await import('@/lib/broker-execution/security/ownership');
    seedConnection({ id: 'conn_r2_A', tenantId: 'user_A' });

    const foreign = await resolveOwnedConnection('conn_r2_A', 'user_B');
    const nonexistent = await resolveOwnedConnection('no-such-connection', 'user_B');

    expect(foreign).toEqual(nonexistent);
    expect(foreign.ok).toBe(false);
    if (foreign.ok) return;
    expect(foreign.status).toBe(404);
    expect(foreign.code).toBe('CONNECTION_NOT_FOUND');
    expect(foreign.message).toBe('Connection not found.');
  });

  it('the violation is logged internally with the REAL owning tenant preserved', async () => {
    // logSecurityEvent emits one JSON line per event via
    // console.warn — observe the wire without coupling to the
    // module's internals.
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (message: unknown) => {
      warnings.push(String(message));
    };
    try {
      const { resolveOwnedConnection } = await import('@/lib/broker-execution/security/ownership');
      seedConnection({ id: 'conn_r2_log', tenantId: 'user_A' });
      await resolveOwnedConnection('conn_r2_log', 'user_B');
    } finally {
      console.warn = originalWarn;
    }

    const violationLines = warnings.filter(
      (line) => line.includes('OWNERSHIP_VIOLATION_BLOCKED'),
    );
    expect(violationLines.length).toBeGreaterThan(0);
    const violation = JSON.parse(violationLines[0]) as { reason?: string };
    expect(violation.reason).toContain('conn_r2_log');
    expect(violation.reason).toContain('user_A');
    expect(violation.reason).toContain('indistinguishable');
  });
});

// ════════════════════════════════════════════════════════════════
// ITEM 4 — the unified pure audit sanitizer
// ════════════════════════════════════════════════════════════════

describe('Round 2, item 4: sanitizeBrokerAuditInput (pure unit contract)', () => {
  it('redacts NESTED credential fields (apiKey/apiSecret/passphrase/token) recursively', async () => {
    const { sanitizeBrokerAuditInput } = await import(
      '@/lib/broker-execution/observability/redaction'
    );
    const sanitized = sanitizeBrokerAuditInput({
      actorId: 'user_1',
      tenantId: 'user_1',
      action: 'TEST',
      reason: 'nested redaction test',
      ipMetadata: {
        ip: '198.51.100.9',
        nested: {
          apiKey: 'sk-live-SECRET',
          deeper: { apiSecret: 'SECRET-2', passphrase: 'SECRET-3' },
          harmless: 'keep me',
        },
      },
    });
    const meta = sanitized.ipMetadata as Record<string, unknown>;
    const nested = meta.nested as Record<string, unknown>;
    const deeper = nested.deeper as Record<string, unknown>;
    expect(nested.apiKey).toBe('[REDACTED]');
    expect(deeper.apiSecret).toBe('[REDACTED]');
    expect(deeper.passphrase).toBe('[REDACTED]');
    expect(nested.harmless).toBe('keep me');
  });

  it('truncates an over-long User-Agent to 256 characters', async () => {
    const { sanitizeBrokerAuditInput } = await import(
      '@/lib/broker-execution/observability/redaction'
    );
    const longUa = 'Mozilla/5.0 ' + 'X'.repeat(5000);
    const sanitized = sanitizeBrokerAuditInput({
      actorId: 'u',
      tenantId: 'u',
      action: 'TEST',
      ipMetadata: { userAgent: longUa },
    });
    const meta = sanitized.ipMetadata as Record<string, unknown>;
    expect((meta.userAgent as string).length).toBe(256);
    expect((meta.userAgent as string).startsWith('Mozilla/5.0 X')).toBe(true);
  });

  it('drops malformed forwarded-for data and reduces valid chains to the first IP', async () => {
    const { sanitizeBrokerAuditInput } = await import(
      '@/lib/broker-execution/observability/redaction'
    );

    const malformed = sanitizeBrokerAuditInput({
      actorId: 'u',
      tenantId: 'u',
      action: 'TEST',
      ipMetadata: { forwardedFor: 'definitely-not-an-ip, more garbage', ip: 'inject-attempt' },
    });
    const mMeta = malformed.ipMetadata as Record<string, unknown>;
    expect(mMeta.forwardedFor).toBeNull();
    expect(mMeta.ip).toBeNull();

    const validChain = sanitizeBrokerAuditInput({
      actorId: 'u',
      tenantId: 'u',
      action: 'TEST',
      ipMetadata: { forwardedFor: '203.0.113.5, 198.51.100.7, 10.0.0.1' },
    });
    const vMeta = validChain.ipMetadata as Record<string, unknown>;
    expect(vMeta.forwardedFor).toBe('203.0.113.5');
  });

  it('normalizes valid IPv4 and IPv6 addresses and drops non-scalar garbage', async () => {
    const { sanitizeBrokerAuditInput } = await import(
      '@/lib/broker-execution/observability/redaction'
    );
    const sanitized = sanitizeBrokerAuditInput({
      actorId: 'u',
      tenantId: 'u',
      action: 'TEST',
      ipMetadata: { ip: '2001:db8::1', clientIp: '192.0.2.44' },
      reason: 12345 as unknown as string,
    });
    const meta = sanitized.ipMetadata as Record<string, unknown>;
    expect(meta.ip).toBe('2001:db8::1');
    expect(meta.clientIp).toBe('192.0.2.44');
    // Non-string reason is dropped, not coerced from an object.
    expect(sanitized.reason).toBe('12345'); // numbers are stringified
    expect(sanitizeBrokerAuditInput({ actorId: 'u', tenantId: 'u', action: 'T', reason: { injected: true } as unknown as string }).reason).toBeNull();
  });

  it('caps identifier and reason lengths and NEVER mutates the input', async () => {
    const { sanitizeBrokerAuditInput } = await import(
      '@/lib/broker-execution/observability/redaction'
    );
    const input = {
      actorId: 'a'.repeat(600),
      tenantId: 't'.repeat(600),
      action: 'ACT'.repeat(100),
      reason: 'r'.repeat(5000),
      ipMetadata: { ip: '192.0.2.1' },
    };
    const snapshot = JSON.parse(JSON.stringify(input));
    const sanitized = sanitizeBrokerAuditInput(input);

    expect(sanitized.actorId.length).toBe(256);
    expect(sanitized.tenantId.length).toBe(256);
    expect(sanitized.action.length).toBe(128);
    expect(sanitized.reason!.length).toBe(2048);
    // Input untouched.
    expect(input).toEqual(snapshot);
  });

  it('the TRANSACTIONAL path and AuditRepository.append use the SAME sanitizer output', async () => {
    const { ConnectionRepository } = await import(
      '@/lib/broker-execution/persistence/connection-repository'
    );
    const { AuditRepository } = await import(
      '@/lib/broker-execution/persistence/audit-repository'
    );

    const malicious = {
      ip: '203.0.113.7',
      userAgent: 'UA-'.repeat(200), // 800 chars
      nested: { apiKey: 'SECRET-KEY' },
      forwardedFor: 'garbage-not-ip',
    };

    // Transactional write (audit inside the same $transaction).
    const created = await ConnectionRepository.createConnection({
      tenantId: 'user_r2',
      providerId: 'demo',
      accountId: null,
      actorId: 'user_r2',
      ipMetadata: malicious,
    });
    expect(created.ok).toBe(true);

    // Standalone write.
    await AuditRepository.append({
      actorId: 'user_r2',
      tenantId: 'user_r2',
      action: 'STANDALONE_PARITY',
      reason: 'parity',
      ipMetadata: malicious,
    });

    const auditTable = fakeDb().__tables.get('brokerExecutionAudit')!;
    const rows = [...auditTable.values()];
    const transactionalRow = rows.find((r) => r.action === 'CONNECT');
    const standaloneRow = rows.find((r) => r.action === 'STANDALONE_PARITY');
    expect(transactionalRow).toBeDefined();
    expect(standaloneRow).toBeDefined();

    // IDENTICAL sanitized shape on both paths.
    expect(standaloneRow!.ipMetadata).toEqual(transactionalRow!.ipMetadata);

    const meta = transactionalRow!.ipMetadata as Record<string, unknown>;
    expect(meta.ip).toBe('203.0.113.7');
    expect((meta.userAgent as string).length).toBe(256);
    expect((meta.nested as Record<string, unknown>).apiKey).toBe('[REDACTED]');
    expect(meta.forwardedFor).toBeNull();
  });

  it('the kill-switch repository transactional audit writes are sanitized too', async () => {
    const { KillSwitchRepository } = await import(
      '@/lib/broker-execution/persistence/kill-switch-repository'
    );
    await KillSwitchRepository.activateKillSwitch({
      scope: 'GLOBAL',
      activatedBy: 'admin_r2',
      reason: 'r'.repeat(5000),
    });

    const auditTable = fakeDb().__tables.get('brokerExecutionAudit')!;
    const row = [...auditTable.values()].find((r) => r.action === 'KILL_SWITCH_ACTIVATE');
    expect(row).toBeDefined();
    expect((row!.reason as string).length).toBeLessThanOrEqual(2048);
  });
});

// ════════════════════════════════════════════════════════════════
// ITEM 5 — operational state is server-owned
// ════════════════════════════════════════════════════════════════

describe('Round 2, item 5: PATCH cannot control operational state', () => {
  it('PATCH with isActive is REJECTED with 400 (strict schema)', async () => {
    const { PATCH } = await import('@/app/api/broker-execution/connections/[id]/route');
    seedConnection({ id: 'conn_r2_patch', tenantId: 'user_1' });

    const req = new NextRequest(new URL('http://localhost/api/broker-execution/connections/conn_r2_patch'), {
      method: 'PATCH',
      headers: { 'x-user-id': 'user_1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: true }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'conn_r2_patch' }) });
    expect(res.status).toBe(400);

    // The row is untouched — isActive cannot be flipped by callers.
    const row = fakeDb().__tables.get('brokerConnection')!.get('conn_r2_patch')!;
    expect(row.isActive).toBe(false);
  });

  it('PATCH with accountName AND isActive is still REJECTED (400)', async () => {
    const { PATCH } = await import('@/app/api/broker-execution/connections/[id]/route');
    seedConnection({ id: 'conn_r2_patch2', tenantId: 'user_1' });

    const req = new NextRequest(new URL('http://localhost/api/broker-execution/connections/conn_r2_patch2'), {
      method: 'PATCH',
      headers: { 'x-user-id': 'user_1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountName: 'renamed', isActive: false }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'conn_r2_patch2' }) });
    expect(res.status).toBe(400);
    const row = fakeDb().__tables.get('brokerConnection')!.get('conn_r2_patch2')!;
    expect(row.accountName).toBeNull();
  });

  it('PATCH with ONLY accountName succeeds, updates metadata, and never touches isActive', async () => {
    const { PATCH } = await import('@/app/api/broker-execution/connections/[id]/route');
    seedConnection({ id: 'conn_r2_patch3', tenantId: 'user_1', isActive: false });

    const req = new NextRequest(new URL('http://localhost/api/broker-execution/connections/conn_r2_patch3'), {
      method: 'PATCH',
      headers: { 'x-user-id': 'user_1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountName: 'My demo account' }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'conn_r2_patch3' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accountName).toBe('My demo account');
    expect(body.isActive).toBe(false);

    const row = fakeDb().__tables.get('brokerConnection')!.get('conn_r2_patch3')!;
    expect(row.accountName).toBe('My demo account');
    expect(row.isActive).toBe(false);
  });
});

describe('Round 2, item 5: testConnection is demo-gated on BOTH sides', () => {
  it('reports success for a demo record whose provider is canonically demo', async () => {
    const { getConnectionManager } = await import(
      '@/lib/broker-execution/connection/connection-manager'
    );
    seedConnection({ id: 'conn_r2_t1', tenantId: 'user_1', providerId: 'demo', isDemo: true });
    const result = await getConnectionManager().testConnection('conn_r2_t1', 'user_1');
    expect(result.success).toBe(true);
    expect(result.isDemo).toBe(true);
  });

  it('REFUSES a non-demo record (provider canonically live) — never reports success', async () => {
    const { getConnectionManager } = await import(
      '@/lib/broker-execution/connection/connection-manager'
    );
    seedConnection({ id: 'conn_r2_t2', tenantId: 'user_1', providerId: 'okx', isDemo: false, accountType: 'live' });
    const result = await getConnectionManager().testConnection('conn_r2_t2', 'user_1');
    expect(result.success).toBe(false);
    expect(result.isDemo).toBe(false);
    expect(result.message).toContain('refused');
  });

  it('REFUSES a record that CLAIMS demo while its provider is canonically live (contradiction)', async () => {
    const { getConnectionManager } = await import(
      '@/lib/broker-execution/connection/connection-manager'
    );
    // Tampered/legacy row: isDemo=true but provider is 'okx' in the
    // canonical registry (isDemo: false). The double gate catches it.
    seedConnection({ id: 'conn_r2_t3', tenantId: 'user_1', providerId: 'okx', isDemo: true, accountType: 'demo' });
    const result = await getConnectionManager().testConnection('conn_r2_t3', 'user_1');
    expect(result.success).toBe(false);
  });

  it('REFUSES a record whose provider is unknown to the canonical registry', async () => {
    const { getConnectionManager } = await import(
      '@/lib/broker-execution/connection/connection-manager'
    );
    seedConnection({ id: 'conn_r2_t4', tenantId: 'user_1', providerId: 'mystery-provider', isDemo: true });
    const result = await getConnectionManager().testConnection('conn_r2_t4', 'user_1');
    expect(result.success).toBe(false);
  });
});
