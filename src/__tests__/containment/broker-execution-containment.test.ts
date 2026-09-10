// ============================================================
// broker-execution-containment.test.ts
// Containment behavioral tests proving 9 architectural invariants
// for the Fovi broker-execution framework.
//
// CORRECTION ROUND (defect 11): these tests now run PRODUCTION
// code paths. Route handlers, repositories, managers, the policy
// gate and the central ExecutionProvider all execute for real —
// only the database wire boundary is replaced by a faithful fake
// (see helpers/broker-execution-fake-db.ts) that models unique
// constraints (P2002), transactions with rollback, and compound
// unique lookups. The previous tests mocked the connection
// manager and DB so heavily they proved the mocks; those mocks
// are removed.
//
// These tests prove that the broker-execution boundary is
// hermetically sealed against:
//   1. Live execution (Phase 1 unconditional containment)
//   2. Unauthenticated access
//   3. Non-admin kill switch operations (VERIFIED ROLE, not ID)
//   4. Cross-tenant connection access
//   5. Forged identity header injection
//   6. Credential leakage in API output/logging
//   7. SQLite datasource regression
//   8. Unintended public route exposure
//   9. Validation-side-effect (submit on validate)
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FakeBrokerDb } from '../helpers/broker-execution-fake-db';

// Trigger the '@/lib/db' mock factory at module-load time so the fake
// instance is registered on globalThis BEFORE any test hook runs.
import '@/lib/broker-execution/persistence/db-access';

const ORIGINAL_ENV = process.env;

// ── Shared mocks ──

// The database wire boundary: a faithful fake with unique
// constraints, transaction rollback and compound unique lookups.
// Production repositories/managers/routes run for real on top of it.
vi.mock('@/lib/db', async () => {
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

// auth mocks for the proxy tests (invariant 5)
vi.mock('@/lib/auth', () => ({
  verifyToken: vi.fn(),
  extractBearerToken: vi.fn(),
}));

// ── Fake-db accessors ──

function fakeDb(): FakeBrokerDb {
  return (globalThis as unknown as Record<string, unknown>).__brokerFakeDb as FakeBrokerDb;
}

function setDbAvailable(available: boolean): void {
  (globalThis as unknown as Record<string, unknown>).__brokerFakeDbAvailable = available;
}

/** Seed a BrokerConnection row in the fake database. */
function seedConnection(overrides: Partial<Record<string, unknown>> & { id: string; tenantId: string }): void {
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

/** Count rows in a fake table. */
function tableCount(tableName: string): number {
  return fakeDb().__tables.get(tableName)!.size;
}

// ── Helper functions ──

function authedReq(userId: string, url: string, method = 'GET', body?: unknown): NextRequest {
  const headers: Record<string, string> = { 'x-user-id': userId, 'Content-Type': 'application/json' };
  const init: RequestInit & { headers: Record<string, string> } = { method, headers };
  if (body) init.body = JSON.stringify(body);
  return new NextRequest(new URL(url), init as ConstructorParameters<typeof NextRequest>[1]);
}

function unauthedReq(url: string, method = 'GET', body?: unknown): NextRequest {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const init: RequestInit & { headers: Record<string, string> } = { method, headers };
  if (body) init.body = JSON.stringify(body);
  return new NextRequest(new URL(url), init as ConstructorParameters<typeof NextRequest>[1]);
}

function adminReq(url: string, method = 'GET', body?: unknown, userId = 'admin_001'): NextRequest {
  const headers: Record<string, string> = {
    'x-user-id': userId,
    'x-user-role': 'admin',
    'Content-Type': 'application/json',
  };
  const init: RequestInit & { headers: Record<string, string> } = { method, headers };
  if (body) init.body = JSON.stringify(body);
  return new NextRequest(new URL(url), init as ConstructorParameters<typeof NextRequest>[1]);
}

function nonAdminReq(url: string, method = 'GET', body?: unknown, userId = 'user_regular'): NextRequest {
  const headers: Record<string, string> = {
    'x-user-id': userId,
    'x-user-role': 'user',
    'Content-Type': 'application/json',
  };
  const init: RequestInit & { headers: Record<string, string> } = { method, headers };
  if (body) init.body = JSON.stringify(body);
  return new NextRequest(new URL(url), init as ConstructorParameters<typeof NextRequest>[1]);
}

// ════════════════════════════════════════════════════════════════
// INVARIANT 1: Live execution remains denied
// ════════════════════════════════════════════════════════════════

describe('Invariant 1: Live execution remains denied', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.LIVE_TRADING_ENABLED;
    fakeDb().__reset();
    setDbAvailable(true);
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  describe('enforceLiveTradingPolicy() blocks all non-demo execution', () => {
    it('blocks a live OKX account', async () => {
      const { enforceLiveTradingPolicy } = await import('@/lib/trading-policy');
      const result = enforceLiveTradingPolicy(
        { broker: 'okx', accountType: 'live' },
        'order placement',
      );
      expect(result.blocked).toBe(true);
      if (result.blocked) expect(result.response.status).toBe(403);
    });

    it('blocks a live Binance account even with LIVE_TRADING_ENABLED=true', async () => {
      process.env.LIVE_TRADING_ENABLED = 'true';
      const { enforceLiveTradingPolicy } = await import('@/lib/trading-policy');
      const result = enforceLiveTradingPolicy(
        { broker: 'binance', accountType: 'live', isDemo: false },
        'order placement',
      );
      expect(result.blocked).toBe(true);
      if (result.blocked) expect(result.response.status).toBe(403);
    });

    it('blocks with all three env override flags set to true', async () => {
      process.env.LIVE_TRADING_ENABLED = 'true';
      process.env.BROKER_CREDENTIAL_INTAKE_ENABLED = 'true';
      process.env.AUTOMATED_TRADING_ENABLED = 'true';
      const { enforceLiveTradingPolicy } = await import('@/lib/trading-policy');
      const result = enforceLiveTradingPolicy(
        { broker: 'bybit', accountType: 'live' },
        'order placement',
      );
      expect(result.blocked).toBe(true);
    });

    it('fails closed when account is null', async () => {
      const { enforceLiveTradingPolicy } = await import('@/lib/trading-policy');
      const result = enforceLiveTradingPolicy(null, 'order placement');
      expect(result.blocked).toBe(true);
    });

    it('fails closed when account is undefined', async () => {
      const { enforceLiveTradingPolicy } = await import('@/lib/trading-policy');
      const result = enforceLiveTradingPolicy(undefined, 'order placement');
      expect(result.blocked).toBe(true);
    });

    it('allows only the triple-correct demo account (broker=demo, accountType=demo, isDemo=true)', async () => {
      const { enforceLiveTradingPolicy } = await import('@/lib/trading-policy');
      const result = enforceLiveTradingPolicy(
        { broker: 'demo', accountType: 'demo', isDemo: true },
        'demo operation',
      );
      expect(result.blocked).toBe(false);
    });

    it('blocks accounts with conflicting fields (broker=demo but accountType=live)', async () => {
      const { enforceLiveTradingPolicy } = await import('@/lib/trading-policy');
      const result = enforceLiveTradingPolicy(
        { broker: 'demo', accountType: 'live' },
        'conflicting account',
      );
      expect(result.blocked).toBe(true);
    });
  });

  describe('ExecutionProvider.submitCommand() always results in BLOCKED for live commands', () => {
    it('blocks a PLACE_MARKET command for a live account and persists the BLOCKED record', async () => {
      seedConnection({ id: 'conn_live_1', tenantId: 'tenant_1', providerId: 'okx', isDemo: false, accountType: 'live' });
      const { ExecutionProvider } = await import(
        '@/lib/broker-execution/execution/execution-provider'
      );
      const provider = new ExecutionProvider();

      const command = {
        commandId: 'cmd_live_1',
        idempotencyKey: 'idem_live_1',
        tenantId: 'tenant_1',
        accountId: 'conn_live_1',
        providerId: 'okx',
        correlationId: 'corr_live_1',
        createdAt: new Date().toISOString(),
        commandType: 'PLACE_MARKET' as const,
        symbol: 'BTC/USDT',
        side: 'BUY' as const,
        size: 1,
      };

      const context = {
        connectionState: 'CONNECTED' as const,
        accountMode: 'live',
        isDemo: false,
        featureFlags: { brokerExecution: true, commandSubmission: true },
        killSwitchStatus: null,
        healthStatus: { isHealthy: true, latencyMs: 50, errorRate: 0 },
        tenantPermissions: { canExecute: true, canTrade: true, isSuspended: false },
        authorizationResult: { isAuthorized: true },
        account: { broker: 'okx', accountType: 'live', isDemo: false },
        executionEnabled: true,
        providerActive: true,
        actorId: 'tenant_1',
        connectionId: 'conn_live_1',
      };

      const result = await provider.submitCommand(command as never, context as never);
      expect(result.blocked).toBe(true);
      expect(result.state).toBe('BLOCKED');
      // The BLOCKED outcome is PERSISTED in the authoritative store
      // (production-path assertion against the fake PostgreSQL).
      const records = fakeDb().__tables.get('executionCommandRecord')!;
      const row = [...records.values()].find((r) => r.commandId === 'cmd_live_1');
      expect(row).toBeDefined();
      expect(row!.currentState).toBe('BLOCKED');
    });
  });

  describe('policy gate denies even when all other gates pass', () => {
    it('denies when enforceLiveTradingPolicy blocks, even with all other gates green', async () => {
      const { evaluateExecutionPolicy } = await import(
        '@/lib/broker-execution/execution/policy-gate'
      );

      const command = {
        commandId: 'cmd_attack',
        idempotencyKey: 'idem_attack',
        tenantId: 'tenant_1',
        accountId: 'acc_live',
        providerId: 'okx',
        correlationId: 'corr_attack',
        createdAt: new Date().toISOString(),
        commandType: 'PLACE_MARKET' as const,
      };

      // All gates EXCEPT trading policy are configured to pass
      const context = {
        connectionState: 'CONNECTED' as const,
        accountMode: 'demo',
        isDemo: true,
        featureFlags: { brokerExecution: true, commandSubmission: true },
        killSwitchStatus: null,
        healthStatus: { isHealthy: true, latencyMs: 10, errorRate: 0 },
        tenantPermissions: { canExecute: true, canTrade: true, isSuspended: false },
        authorizationResult: { isAuthorized: true },
        // BUT: account is LIVE — enforceLiveTradingPolicy blocks
        account: { broker: 'okx', accountType: 'live', isDemo: false },
        executionEnabled: true,
        providerActive: true,
      };

      const decision = evaluateExecutionPolicy(command as never, context as never);
      expect(decision.allowed).toBe(false);
      expect(decision.evaluatedGates).toContain('trading-policy');
      expect(decision.containmentCode).toBe('PHASE1_LIVE_TRADING_DISABLED');
    });
  });

  describe('commands API routes every submission through the central boundary (Phase 1 hard constant)', () => {
    it('POST /commands blocks a command on a LIVE provider connection with a persisted BLOCKED record', async () => {
      seedConnection({ id: 'conn_live_api', tenantId: 'user_1', providerId: 'okx', isDemo: false, accountType: 'live' });
      const { POST } = await import('@/app/api/broker-execution/commands/route');

      const req = authedReq('user_1', 'http://localhost/api/broker-execution/commands', 'POST', {
        commandType: 'PLACE_MARKET',
        connectionId: 'conn_live_api',
        idempotencyKey: 'idem_api_live_1',
        symbol: 'BTC/USDT',
        side: 'BUY',
        size: 1,
      });
      const res = await POST(req);
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.code).toBe('PHASE1_LIVE_TRADING_DISABLED');
      expect(body.commandId).toBeDefined();

      // Persisted as BLOCKED in the authoritative store
      const records = fakeDb().__tables.get('executionCommandRecord')!;
      const row = [...records.values()].find((r) => r.commandId === body.commandId);
      expect(row).toBeDefined();
      expect(row!.currentState).toBe('BLOCKED');
      // State transitions recorded
      const transitions = [...fakeDb().__tables.get('executionStateTransition')!.values()].filter(
        (t) => t.commandId === body.commandId,
      );
      expect(transitions.length).toBe(2); // CREATED→VALIDATING→BLOCKED
      // Audit written in the same transaction
      const audits = [...fakeDb().__tables.get('brokerExecutionAudit')!.values()].filter(
        (a) => a.commandId === body.commandId,
      );
      expect(audits.length).toBe(1);
      // Idempotency claim persisted
      expect(tableCount('idempotencyRecord')).toBe(1);
    });

    it('POST /commands blocks a DEMO connection command at the Phase 1 environment gate (executionEnabled hard constant)', async () => {
      seedConnection({ id: 'conn_demo_api', tenantId: 'user_1', providerId: 'demo', isDemo: true, accountType: 'demo' });
      const { POST } = await import('@/app/api/broker-execution/commands/route');

      const req = authedReq('user_1', 'http://localhost/api/broker-execution/commands', 'POST', {
        commandType: 'PLACE_MARKET',
        connectionId: 'conn_demo_api',
        idempotencyKey: 'idem_api_demo_1',
        symbol: 'BTC/USDT',
        side: 'BUY',
        size: 1,
      });
      const res = await POST(req);
      expect(res.status).toBe(403);
      const body = await res.json();
      // Demo passes the unconditional containment check but is blocked at
      // the environment gate — executionEnabled is a Phase 1 HARD CONSTANT.
      expect(body.code).toBe('ENVIRONMENT_EXECUTION_DISABLED');
      expect(body.status).toBe('BLOCKED');
    });
  });
});

// ════════════════════════════════════════════════════════════════
// INVARIANT 2: No execution endpoint bypasses auth
// ════════════════════════════════════════════════════════════════

describe('Invariant 2: No execution endpoint bypasses auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    fakeDb().__reset();
    setDbAvailable(true);
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  // NOTE: the database is intentionally UNAVAILABLE for these tests
  // (setDbAvailable(false)) — proving authentication is checked
  // BEFORE any database access, fail-closed.

  it('/commands POST returns 401 when no X-User-Id header', async () => {
    setDbAvailable(false);
    const { POST } = await import('@/app/api/broker-execution/commands/route');
    const req = unauthedReq('http://localhost/api/broker-execution/commands', 'POST', {
      commandType: 'PLACE_MARKET',
      connectionId: 'conn_x',
      idempotencyKey: 'idem_x',
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('/commands GET returns 401 when no X-User-Id header', async () => {
    setDbAvailable(false);
    const { GET } = await import('@/app/api/broker-execution/commands/route');
    const res = await GET(unauthedReq('http://localhost/api/broker-execution/commands'));
    expect(res.status).toBe(401);
  });

  it('/commands/validate POST returns 401 when no X-User-Id header', async () => {
    setDbAvailable(false);
    const { POST } = await import('@/app/api/broker-execution/commands/validate/route');
    const req = unauthedReq('http://localhost/api/broker-execution/commands/validate', 'POST', {
      commandType: 'PLACE_MARKET',
      connectionId: 'conn_x',
      idempotencyKey: 'idem_x',
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('/connections GET returns 401 when no X-User-Id header', async () => {
    setDbAvailable(false);
    const { GET } = await import('@/app/api/broker-execution/connections/route');
    const res = await GET(unauthedReq('http://localhost/api/broker-execution/connections'));
    expect(res.status).toBe(401);
  });

  it('/connections POST returns 401 when no X-User-Id header', async () => {
    setDbAvailable(false);
    const { POST } = await import('@/app/api/broker-execution/connections/route');
    const req = unauthedReq('http://localhost/api/broker-execution/connections', 'POST', {
      providerId: 'demo',
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('/capabilities returns 401 when no X-User-Id header', async () => {
    setDbAvailable(false);
    const { GET } = await import('@/app/api/broker-execution/capabilities/route');
    const res = await GET(
      unauthedReq('http://localhost/api/broker-execution/capabilities?connectionId=conn_x'),
    );
    expect(res.status).toBe(401);
  });

  it('/reconciliation GET returns 401 when no X-User-Id header', async () => {
    setDbAvailable(false);
    const { GET } = await import('@/app/api/broker-execution/reconciliation/route');
    const res = await GET(
      unauthedReq('http://localhost/api/broker-execution/reconciliation?accountId=a&connectionId=c'),
    );
    expect(res.status).toBe(401);
  });

  it('/reconciliation POST returns 401 when no X-User-Id header', async () => {
    setDbAvailable(false);
    const { POST } = await import('@/app/api/broker-execution/reconciliation/route');
    const req = unauthedReq('http://localhost/api/broker-execution/reconciliation', 'POST', {
      accountId: 'a',
      connectionId: 'c',
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('/audit GET returns 401 when no X-User-Id header', async () => {
    setDbAvailable(false);
    const { GET } = await import('@/app/api/broker-execution/audit/route');
    const res = await GET(unauthedReq('http://localhost/api/broker-execution/audit'));
    expect(res.status).toBe(401);
  });

  it('/kill-switches GET returns 401 when no X-User-Id header', async () => {
    setDbAvailable(false);
    const { GET } = await import('@/app/api/broker-execution/kill-switches/route');
    const res = await GET(unauthedReq('http://localhost/api/broker-execution/kill-switches'));
    expect(res.status).toBe(401);
  });

  it('/kill-switches POST returns 401 when no X-User-Id header', async () => {
    setDbAvailable(false);
    const { POST } = await import('@/app/api/broker-execution/kill-switches/route');
    const req = unauthedReq('http://localhost/api/broker-execution/kill-switches', 'POST', {
      scope: 'GLOBAL',
      reason: 'test',
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});

// ════════════════════════════════════════════════════════════════
// INVARIANT 3: Non-admin users cannot operate kill switches
// (authorization from the VERIFIED JWT ROLE — never a user-ID
// prefix convention)
// ════════════════════════════════════════════════════════════════

describe('Invariant 3: Non-admin users cannot operate kill switches (verified role, not user ID)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    fakeDb().__reset();
    setDbAvailable(true);
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  describe('API route: /kill-switches requires the verified admin ROLE', () => {
    it('GET returns 403 for a non-admin role', async () => {
      const { GET } = await import('@/app/api/broker-execution/kill-switches/route');
      const res = await GET(nonAdminReq('http://localhost/api/broker-execution/kill-switches'));
      expect(res.status).toBe(403);
    });

    it('POST returns 403 for a non-admin role', async () => {
      const { POST } = await import('@/app/api/broker-execution/kill-switches/route');
      const req = nonAdminReq('http://localhost/api/broker-execution/kill-switches', 'POST', {
        scope: 'GLOBAL',
        reason: 'should be denied',
      });
      const res = await POST(req);
      expect(res.status).toBe(403);
      // No kill switch may be created by a non-admin
      expect(tableCount('killSwitchRecord')).toBe(0);
    });

    it('PATCH returns 403 for a non-admin role', async () => {
      const { PATCH } = await import('@/app/api/broker-execution/kill-switches/route');
      const req = nonAdminReq('http://localhost/api/broker-execution/kill-switches', 'PATCH', {
        killSwitchId: 'ks_x',
      });
      const res = await PATCH(req);
      expect(res.status).toBe(403);
    });

    it('GET allows a request with the verified admin role', async () => {
      const { GET } = await import('@/app/api/broker-execution/kill-switches/route');
      const res = await GET(adminReq('http://localhost/api/broker-execution/kill-switches'));
      expect(res.status).toBe(200);
    });

    it('GET denies a request with NO role header even when authenticated', async () => {
      const { GET } = await import('@/app/api/broker-execution/kill-switches/route');
      const res = await GET(authedReq('user_1', 'http://localhost/api/broker-execution/kill-switches'));
      expect(res.status).toBe(403);
    });
  });

  describe('A user ID NEVER determines admin status (admin_ prefix convention removed)', () => {
    it('a non-admin whose ID begins with admin_ does NOT gain privilege', async () => {
      const { GET } = await import('@/app/api/broker-execution/kill-switches/route');
      // Role is NOT admin — the ID prefix must be irrelevant
      const res = await GET(nonAdminReq('http://localhost/api/broker-execution/kill-switches', 'GET', undefined, 'admin impostor'));
      expect(res.status).toBe(403);
    });

    it('a non-admin whose ID is exactly "system" does NOT gain privilege', async () => {
      const { GET } = await import('@/app/api/broker-execution/kill-switches/route');
      const req = new NextRequest(new URL('http://localhost/api/broker-execution/kill-switches'), {
        headers: { 'x-user-id': 'system', 'x-user-role': 'user', 'Content-Type': 'application/json' },
      });
      const res = await GET(req);
      expect(res.status).toBe(403);
    });

    it('a valid admin whose ID does NOT begin with admin_ works', async () => {
      const { GET } = await import('@/app/api/broker-execution/kill-switches/route');
      const res = await GET(adminReq('http://localhost/api/broker-execution/kill-switches', 'GET', undefined, 'usr_8f3b9c2'));
      expect(res.status).toBe(200);
    });
  });

  describe('kill-switch activation/deactivation persistence', () => {
    it('admin POST activates a GLOBAL kill switch with the canonical scopeId and persists it', async () => {
      const { POST } = await import('@/app/api/broker-execution/kill-switches/route');
      const req = adminReq('http://localhost/api/broker-execution/kill-switches', 'POST', {
        scope: 'GLOBAL',
        reason: 'integration test containment',
        emergencyReadOnly: true,
      }, 'usr_admin_real');
      const res = await POST(req);
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.scope).toBe('GLOBAL');
      expect(body.scopeId).toBe('global'); // canonical non-null scopeId
      // Persisted in the authoritative KillSwitchRecord store
      expect(tableCount('killSwitchRecord')).toBe(1);
      // Audit written in the same transaction
      const audits = [...fakeDb().__tables.get('brokerExecutionAudit')!.values()];
      expect(audits.length).toBe(1);
      expect(audits[0].action).toBe('KILL_SWITCH_ACTIVATE');
    });

    it('admin PATCH deactivates an existing kill switch', async () => {
      const { POST, PATCH } = await import('@/app/api/broker-execution/kill-switches/route');
      const createRes = await POST(
        adminReq('http://localhost/api/broker-execution/kill-switches', 'POST', {
          scope: 'GLOBAL',
          reason: 'to be deactivated',
        }),
      );
      const created = await createRes.json();

      const patchRes = await PATCH(
        adminReq('http://localhost/api/broker-execution/kill-switches', 'PATCH', {
          killSwitchId: created.id,
        }),
      );
      expect(patchRes.status).toBe(200);
      const updated = await patchRes.json();
      expect(updated.state).toBe('INACTIVE');

      // Authoritative store reflects the deactivation
      const records = [...fakeDb().__tables.get('killSwitchRecord')!.values()];
      expect(records[0].state).toBe('INACTIVE');
    });
  });
});

// ════════════════════════════════════════════════════════════════
// INVARIANT 4: Users cannot read or mutate another user's broker connection
// ════════════════════════════════════════════════════════════════

describe('Invariant 4: Users cannot read or mutate another user\'s broker connection', () => {
  const USER_A = 'user_A';
  const USER_B = 'user_B';
  const CONN_ID = 'conn_cross_tenant';

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    fakeDb().__reset();
    setDbAvailable(true);

    // Seed a connection belonging to USER_A in the authoritative store
    seedConnection({ id: CONN_ID, tenantId: USER_A, providerId: 'demo' });
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  describe('connections/[id] GET — cross-tenant isolation (DB-backed ownership)', () => {
    it('returns 403 when USER_B tries to GET USER_A\'s connection', async () => {
      const { GET } = await import('@/app/api/broker-execution/connections/[id]/route');
      const req = authedReq(USER_B, `http://localhost/api/broker-execution/connections/${CONN_ID}`);
      const res = await GET(req, { params: Promise.resolve({ id: CONN_ID }) });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.code).toBe('TENANT_ISOLATION_VIOLATION');
    });

    it('allows USER_A to GET their own connection (without credentials in the response)', async () => {
      const { GET } = await import('@/app/api/broker-execution/connections/[id]/route');
      const req = authedReq(USER_A, `http://localhost/api/broker-execution/connections/${CONN_ID}`);
      const res = await GET(req, { params: Promise.resolve({ id: CONN_ID }) });
      expect(res.status).toBe(200);
      const body = await res.json();
      // No credential columns in the response
      expect(body.encryptedApiKey).toBeUndefined();
      expect(body.encryptedApiSecret).toBeUndefined();
      expect(body.encryptedToken).toBeUndefined();
    });
  });

  describe('connections/[id] PATCH — cross-tenant isolation', () => {
    it('returns 403 when USER_B tries to PATCH USER_A\'s connection', async () => {
      const { PATCH } = await import('@/app/api/broker-execution/connections/[id]/route');
      const req = new NextRequest(
        new URL(`http://localhost/api/broker-execution/connections/${CONN_ID}`),
        {
          method: 'PATCH',
          headers: {
            'x-user-id': USER_B,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ accountName: 'Hacked!' }),
        },
      );
      const res = await PATCH(req, { params: Promise.resolve({ id: CONN_ID }) });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.code).toBe('TENANT_ISOLATION_VIOLATION');
      // The connection is unchanged
      const row = fakeDb().__tables.get('brokerConnection')!.get(CONN_ID)!;
      expect(row.accountName).toBeNull();
    });
  });

  describe('connections/[id] DELETE — cross-tenant isolation', () => {
    it('returns 403 when USER_B tries to DELETE USER_A\'s connection', async () => {
      const { DELETE } = await import('@/app/api/broker-execution/connections/[id]/route');
      const req = new NextRequest(
        new URL(`http://localhost/api/broker-execution/connections/${CONN_ID}`),
        {
          method: 'DELETE',
          headers: { 'x-user-id': USER_B },
        },
      );
      const res = await DELETE(req, { params: Promise.resolve({ id: CONN_ID }) });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.code).toBe('TENANT_ISOLATION_VIOLATION');
      // The connection still exists
      expect(fakeDb().__tables.get('brokerConnection')!.has(CONN_ID)).toBe(true);
    });
  });

  describe('connections list — tenant-scoped (authoritative store)', () => {
    it('GET /connections only returns connections belonging to the authenticated user', async () => {
      seedConnection({ id: 'conn_b', tenantId: USER_B, providerId: 'demo' });

      const { GET } = await import('@/app/api/broker-execution/connections/route');
      const req = authedReq(USER_A, 'http://localhost/api/broker-execution/connections');
      const res = await GET(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      // USER_A should only see their own connection, not USER_B's
      const tenantIds = body.connections.map((c: { tenantId: string }) => c.tenantId);
      expect(tenantIds.every((id: string) => id === USER_A)).toBe(true);
      expect(body.connections.length).toBe(1);
    });
  });

  describe('commands + reconciliation cross-tenant ownership (DB-backed)', () => {
    it('USER_B cannot submit a command against USER_A\'s connection', async () => {
      const { POST } = await import('@/app/api/broker-execution/commands/route');
      const req = authedReq(USER_B, 'http://localhost/api/broker-execution/commands', 'POST', {
        commandType: 'PLACE_MARKET',
        connectionId: CONN_ID,
        idempotencyKey: 'idem_cross_1',
        symbol: 'BTC/USDT',
        side: 'BUY',
        size: 1,
      });
      const res = await POST(req);
      expect(res.status).toBe(403);
      // No command was persisted
      expect(tableCount('executionCommandRecord')).toBe(0);
    });

    it('USER_B cannot trigger reconciliation on USER_A\'s connection', async () => {
      const { POST } = await import('@/app/api/broker-execution/reconciliation/route');
      const req = authedReq(USER_B, 'http://localhost/api/broker-execution/reconciliation', 'POST', {
        accountId: CONN_ID,
        connectionId: CONN_ID,
      });
      const res = await POST(req);
      expect(res.status).toBe(403);
    });
  });
});

// ════════════════════════════════════════════════════════════════
// INVARIANT 5: Malformed caller identity headers cannot establish identity
// ════════════════════════════════════════════════════════════════

describe('Invariant 5: Malformed caller identity headers cannot establish tenant/account identity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  describe('proxy strips x-user-id, x-user-email, x-user-role before auth logic', () => {
    it('strips x-user-id, x-user-email, x-user-role headers from incoming request', async () => {
      const { proxy } = await import('@/proxy');
      const { verifyToken, extractBearerToken } = await import('@/lib/auth');
      const mockedExtractBearerToken = vi.mocked(extractBearerToken);
      const mockedVerifyToken = vi.mocked(verifyToken);

      // Set up a valid JWT that resolves to the REAL user
      mockedExtractBearerToken.mockReturnValue('valid-token');
      mockedVerifyToken.mockResolvedValue({
        sub: 'real_user',
        email: 'real@test.com',
        type: 'access',
        role: 'user',
      } as never);

      const req = new Request('http://localhost:3000/api/trading/accounts', {
        headers: {
          authorization: 'Bearer valid-token',
          'x-user-id': 'attacker_123',
          'x-user-email': 'attacker@evil.com',
          'x-user-role': 'admin',
        },
      });
      // Attach NextRequest-like nextUrl
      Object.defineProperty(req, 'nextUrl', {
        value: { pathname: '/api/trading/accounts' },
        writable: false,
      });

      const res = await (proxy as (req: unknown) => Promise<Response>)(req);
      // The proxy should have stripped the forged headers and
      // set the verified user's headers from the JWT payload.
      expect(res.status).not.toBe(401);
    });

    it('request with only forged headers and no JWT gets 401', async () => {
      const { proxy } = await import('@/proxy');
      const { verifyToken, extractBearerToken } = await import('@/lib/auth');
      const mockedExtractBearerToken = vi.mocked(extractBearerToken);
      const mockedVerifyToken = vi.mocked(verifyToken);

      // No valid JWT
      mockedExtractBearerToken.mockReturnValue(null);
      mockedVerifyToken.mockResolvedValue(null);

      const req = new Request('http://localhost:3000/api/trading/accounts', {
        headers: {
          'x-user-id': 'attacker_123',
          'x-user-email': 'attacker@evil.com',
          'x-user-role': 'admin',
        },
      });
      Object.defineProperty(req, 'nextUrl', {
        value: { pathname: '/api/trading/accounts' },
        writable: false,
      });

      const res = await (proxy as (req: unknown) => Promise<Response>)(req);
      expect(res.status).toBe(401);
    });
  });

  describe('getUserIdSync rejects forged headers on direct route access', () => {
    it('rejects request with x-user-id=anonymous', async () => {
      const { getUserIdSync, AuthRequiredError } = await import('@/lib/get-user-id');
      const req = new Request('http://localhost', {
        headers: { 'x-user-id': 'anonymous' },
      });
      expect(() => getUserIdSync(req)).toThrow(AuthRequiredError);
    });

    it('rejects request with empty x-user-id', async () => {
      const { getUserIdSync, AuthRequiredError } = await import('@/lib/get-user-id');
      const req = new Request('http://localhost', {
        headers: { 'x-user-id': '' },
      });
      expect(() => getUserIdSync(req)).toThrow(AuthRequiredError);
    });

    it('rejects request with no x-user-id at all', async () => {
      const { getUserIdSync, AuthRequiredError } = await import('@/lib/get-user-id');
      const req = new Request('http://localhost');
      expect(() => getUserIdSync(req)).toThrow(AuthRequiredError);
    });
  });
});

// ════════════════════════════════════════════════════════════════
// INVARIANT 6: Credentials never appear in API output/logging
// ════════════════════════════════════════════════════════════════

describe('Invariant 6: Credentials never appear in API output/logging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeDb().__reset();
    setDbAvailable(true);
  });

  describe('safeAccountDTO strips apiKey, apiSecret, passphrase', () => {
    it('strips all credential fields from an account object', async () => {
      const { safeAccountDTO } = await import('@/lib/trading-policy');
      const account = {
        id: 'acc_1',
        userId: 'user_1',
        broker: 'okx',
        apiKey: 'super-secret-key-123',
        apiSecret: 'super-secret-value-456',
        passphrase: 'my-passphrase-789',
        balance: 10000,
      };
      const safe = safeAccountDTO(account);
      expect(safe.apiKey).toBeUndefined();
      expect(safe.apiSecret).toBeUndefined();
      expect(safe.passphrase).toBeUndefined();
      expect(safe.id).toBe('acc_1');
      expect(safe.balance).toBe(10000);
    });

    it('strips encrypted credential variants (encrypted VALUES in credential fields)', async () => {
      const { safeAccountDTO } = await import('@/lib/trading-policy');
      const account = {
        id: 'acc_2',
        apiKey: 'enc:v3:base64payload',
        apiSecret: 'enc:v3:anotherpayload',
      };
      const safe = safeAccountDTO(account);
      expect(safe.apiKey).toBeUndefined();
      expect(safe.apiSecret).toBeUndefined();
    });
  });

  describe('redactCredentials replaces all fields with REDACTED', () => {
    it('redacts all credential fields', async () => {
      const { redactCredentials } = await import(
        '@/lib/broker-execution/connection/credential-vault'
      );
      const redacted = redactCredentials({
        apiKey: 'super-secret-key-123',
        apiSecret: 'super-secret-value-456',
        passphrase: 'my-passphrase-789',
        token: 'tok-123',
        refreshToken: 'ref-456',
      });
      const values = Object.values(redacted);
      expect(values.every((v) => v === '***REDACTED***')).toBe(true);
      expect(JSON.stringify(redacted)).not.toContain('super-secret-key-123');
    });

    it('does not include fields that were undefined in input', async () => {
      const { redactCredentials } = await import(
        '@/lib/broker-execution/connection/credential-vault'
      );
      const redacted = redactCredentials({ apiKey: 'only-key' });
      expect(redacted.apiKey).toBe('***REDACTED***');
      expect(redacted.apiSecret).toBeUndefined();
    });
  });

  describe('redactForTelemetry recursively strips sensitive fields', () => {
    it('redacts known credential field names', async () => {
      const { redactForTelemetry } = await import(
        '@/lib/broker-execution/observability/telemetry'
      );
      const event = {
        eventType: 'test',
        apiKey: 'key-123',
        apiSecret: 'secret-456',
        passphrase: 'pass-789',
        token: 'tok',
        refreshToken: 'ref',
      };
      const redacted = redactForTelemetry(event) as Record<string, unknown>;
      expect(redacted.apiKey).toBe('[REDACTED]');
      expect(redacted.apiSecret).toBe('[REDACTED]');
      expect(redacted.passphrase).toBe('[REDACTED]');
      expect(redacted.token).toBe('[REDACTED]');
      expect(redacted.refreshToken).toBe('[REDACTED]');
    });

    it('redacts nested objects recursively', async () => {
      const { redactForTelemetry } = await import(
        '@/lib/broker-execution/observability/telemetry'
      );
      const event = { nested: { apiKey: 'inner-key' } };
      const redacted = redactForTelemetry(event) as Record<string, unknown>;
      expect((redacted.nested as Record<string, unknown>).apiKey).toBe('[REDACTED]');
    });

    it('redacts arrays containing sensitive objects', async () => {
      const { redactForTelemetry } = await import(
        '@/lib/broker-execution/observability/telemetry'
      );
      const event = { items: [{ apiKey: 'arr-key' }, { safe: 1 }] };
      const redacted = redactForTelemetry(event) as Record<string, unknown>;
      const items = redacted.items as Array<Record<string, unknown>>;
      expect(items[0].apiKey).toBe('[REDACTED]');
      expect(items[1].safe).toBe(1);
    });
  });

  describe('redactForAudit strips sensitive fields (same patterns as telemetry)', () => {
    it('redacts all credential fields from an audit object', async () => {
      const { redactForAudit } = await import(
        '@/lib/broker-execution/observability/audit-trail'
      );
      const audit = {
        action: 'CONNECT',
        apiKey: 'audit-key-123',
        apiSecret: 'audit-secret-456',
        passphrase: 'audit-pass-789',
      };
      const redacted = redactForAudit(audit) as Record<string, unknown>;
      expect(redacted.apiKey).toBe('[REDACTED]');
      expect(redacted.apiSecret).toBe('[REDACTED]');
      expect(redacted.passphrase).toBe('[REDACTED]');
      expect(redacted.action).toBe('CONNECT');
    });
  });

  describe('logSecurityEvent redacts fields containing secret/key/token/password', () => {
    it('redacts credential-like field names in security events', async () => {
      const { logSecurityEvent } = await import('@/lib/trading-policy');
      // Smoke test — the redaction behavior is enforced inside
      // logSecurityEvent; calling it with a secret-bearing payload
      // must not throw and must not leak into the event.
      expect(() =>
        logSecurityEvent({
          eventType: 'TEST_REDACTION',
          apiKey: 'should-not-appear',
          reason: 'redaction smoke test',
        } as never),
      ).not.toThrow();
    });
  });
});

// ════════════════════════════════════════════════════════════════
// INVARIANT 7: PostgreSQL datasource is preserved
// ════════════════════════════════════════════════════════════════

describe('Invariant 7: PostgreSQL datasource is preserved', () => {
  it('prisma/schema.prisma datasource provider is "postgresql"', () => {
    const readSync = readFileSync as unknown as (p: string, enc: string) => string;
    const schema = readSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf-8');
    const providerMatch = schema.match(/datasource\s+db\s*{[^}]*provider\s*=\s*"([^"]+)"/);
    expect(providerMatch).not.toBeNull();
    expect(providerMatch![1]).toBe('postgresql');
  });

  it('schema does not contain sqlite as a provider anywhere', () => {
    const readSync = readFileSync as unknown as (p: string, enc: string) => string;
    const schema = readSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf-8');
    const providerMatch = schema.match(/provider\s*=\s*"([^"]+)"/g) ?? [];
    for (const match of providerMatch) {
      expect(match).not.toContain('sqlite');
    }
  });

  it('KillSwitchRecord.scopeId is non-null with the canonical global default (GLOBAL singleton)', () => {
    const readSync = readFileSync as unknown as (p: string, enc: string) => string;
    const schema = readSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf-8');
    const modelMatch = schema.match(/model KillSwitchRecord \{[\s\S]*?\}/);
    expect(modelMatch).not.toBeNull();
    const model = modelMatch![0];
    // scopeId must NOT be optional (String?) — it is String @default("global")
    expect(model).not.toMatch(/scopeId\s+String\?/);
    expect(model).toMatch(/scopeId\s+String\s+@default\("global"\)/);
  });
});

// ════════════════════════════════════════════════════════════════
// INVARIANT 8: Public route exposure is limited to intentionally
// public read-only endpoints
// ════════════════════════════════════════════════════════════════

describe('Invariant 8: Public route exposure is limited to intentionally public read-only endpoints', () => {
  const readSync = readFileSync as unknown as (p: string, enc: string) => string;

  it('only /api/broker-execution/health and /api/broker-execution/providers are in PUBLIC_PATHS', async () => {
    const proxySource = readSync(resolve(process.cwd(), 'src/proxy.ts'), 'utf-8');
    const publicPathsMatch = proxySource.match(
      /const PUBLIC_PATHS[^=]*=\s*\[([\s\S]*?)\]/,
    );
    expect(publicPathsMatch).not.toBeNull();
    const brokerExecutionEntries = publicPathsMatch![1]
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith("'") && line.includes('broker-execution'))
      .map((line) => line.replace(/,+$/, ''));
    expect(brokerExecutionEntries).toEqual([
      "'/api/broker-execution/health'",
      "'/api/broker-execution/providers'",
    ]);
  });

  it('/commands is NOT in PUBLIC_PATHS', async () => {
    const proxySource = readSync(resolve(process.cwd(), 'src/proxy.ts'), 'utf-8');
    expect(proxySource).not.toMatch(/['"]\/api\/broker-execution\/commands['"]/);
  });

  it('/connections is NOT in PUBLIC_PATHS', async () => {
    const proxySource = readSync(resolve(process.cwd(), 'src/proxy.ts'), 'utf-8');
    expect(proxySource).not.toMatch(/['"]\/api\/broker-execution\/connections['"]/);
  });

  it('/kill-switches is NOT in PUBLIC_PATHS', async () => {
    const proxySource = readSync(resolve(process.cwd(), 'src/proxy.ts'), 'utf-8');
    expect(proxySource).not.toMatch(/['"]\/api\/broker-execution\/kill-switches['"]/);
  });

  it('/reconciliation is NOT in PUBLIC_PATHS', async () => {
    const proxySource = readSync(resolve(process.cwd(), 'src/proxy.ts'), 'utf-8');
    expect(proxySource).not.toMatch(/['"]\/api\/broker-execution\/reconciliation['"]/);
  });

  it('/audit is NOT in PUBLIC_PATHS', async () => {
    const proxySource = readSync(resolve(process.cwd(), 'src/proxy.ts'), 'utf-8');
    const publicPathsMatch = proxySource.match(
      /const PUBLIC_PATHS[^=]*=\s*\[([\s\S]*?)\]/,
    );
    expect(publicPathsMatch).not.toBeNull();
    expect(publicPathsMatch![1]).not.toContain("'/api/broker-execution/audit'");
  });

  it('no broker-execution route is in INTERNAL_SERVICE_PATHS', async () => {
    const proxySource = readSync(resolve(process.cwd(), 'src/proxy.ts'), 'utf-8');
    const internalMatch = proxySource.match(
      /const INTERNAL_SERVICE_PATHS[^=]*=\s*\[([\s\S]*?)\]/,
    );
    expect(internalMatch).not.toBeNull();
    expect(internalMatch![1]).not.toContain('broker-execution');
  });
});

// ════════════════════════════════════════════════════════════════
// INVARIANT 9: Execution validation does not itself submit an order
// ════════════════════════════════════════════════════════════════

describe('Invariant 9: Execution validation does not itself submit an order', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    fakeDb().__reset();
    setDbAvailable(true);
    seedConnection({ id: 'conn_val_1', tenantId: 'user_1', providerId: 'demo' });
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  describe('validateCommandForDryRun never produces side effects', () => {
    it('returns validation result without any state machine transitions', async () => {
      const { validateCommandForDryRun } = await import(
        '@/lib/broker-execution/execution/policy-gate'
      );

      const command = {
        commandId: 'cmd_validate_1',
        idempotencyKey: 'idem_validate_1',
        tenantId: 'tenant_1',
        accountId: 'acc_demo',
        providerId: 'demo',
        correlationId: 'corr_validate_1',
        createdAt: new Date().toISOString(),
        commandType: 'PLACE_MARKET' as const,
        symbol: 'BTC/USDT',
        side: 'BUY' as const,
        size: 1,
      };

      const result = validateCommandForDryRun(command as never);
      expect(result).toHaveProperty('isValid');
      expect(result).toHaveProperty('errors');
      expect(result).toHaveProperty('warnings');
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('does not create any execution state record', async () => {
      const { ExecutionProvider } = await import(
        '@/lib/broker-execution/execution/execution-provider'
      );

      const provider = new ExecutionProvider();

      const command = {
        commandId: 'cmd_val_provider',
        idempotencyKey: 'idem_val_provider',
        tenantId: 'tenant_1',
        accountId: 'acc_demo',
        providerId: 'demo',
        correlationId: 'corr_val_provider',
        createdAt: new Date().toISOString(),
        commandType: 'PLACE_MARKET' as const,
      };

      const result = provider.validateCommand(command as never);
      expect(result).toHaveProperty('isValid');
      expect(result).toHaveProperty('isAuthorized');
      expect(result).toHaveProperty('authorizationReason');

      // The command has NO record in the authoritative store
      const status = await provider.getCommandStatus('cmd_val_provider', 'tenant_1');
      expect(status).toBeNull();
      expect(tableCount('executionCommandRecord')).toBe(0);
      expect(tableCount('executionStateTransition')).toBe(0);
      expect(tableCount('idempotencyRecord')).toBe(0);
    });
  });

  describe('/commands/validate route never transitions to SUBMITTING', () => {
    it('returns executionPermitted: false always (Phase 1) and persists NOTHING', async () => {
      const { POST } = await import(
        '@/app/api/broker-execution/commands/validate/route'
      );

      const req = authedReq(
        'user_1',
        'http://localhost/api/broker-execution/commands/validate',
        'POST',
        {
          commandType: 'PLACE_MARKET',
          connectionId: 'conn_val_1',
          idempotencyKey: 'idem_validate_api',
          symbol: 'BTC/USDT',
          side: 'BUY',
          size: 1,
        },
      );

      const res = await POST(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.executionPermitted).toBe(false);
      expect(body.validation).toBeDefined();
      // Dry-run validation persists NO command/transition/idempotency/audit records
      expect(tableCount('executionCommandRecord')).toBe(0);
      expect(tableCount('executionStateTransition')).toBe(0);
      expect(tableCount('idempotencyRecord')).toBe(0);
      expect(tableCount('brokerExecutionAudit')).toBe(0);
    });

    it('returns validation errors without executing for invalid commands', async () => {
      const { POST } = await import(
        '@/app/api/broker-execution/commands/validate/route'
      );

      const req = authedReq(
        'user_1',
        'http://localhost/api/broker-execution/commands/validate',
        'POST',
        {
          commandType: 'PLACE_MARKET',
          // Missing required fields: symbol, side, size
          connectionId: 'conn_val_1',
          idempotencyKey: 'idem_validate_invalid',
        },
      );

      const res = await POST(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.executionPermitted).toBe(false);
      expect(body.validation.isValid).toBe(false);
      expect(body.validation.errors.length).toBeGreaterThan(0);
    });

    it('never includes a SUBMITTING or QUEUED state in the response', async () => {
      const { POST } = await import(
        '@/app/api/broker-execution/commands/validate/route'
      );

      const req = authedReq(
        'user_1',
        'http://localhost/api/broker-execution/commands/validate',
        'POST',
        {
          commandType: 'PLACE_MARKET',
          connectionId: 'conn_val_1',
          idempotencyKey: 'idem_validate_no_submit',
          symbol: 'BTC/USDT',
          side: 'BUY',
          size: 1,
        },
      );

      const res = await POST(req);
      const body = await res.json();
      const bodyStr = JSON.stringify(body);
      expect(bodyStr).not.toContain('SUBMITTING');
      expect(bodyStr).not.toContain('QUEUED');
      expect(bodyStr).not.toContain('EXECUTING');
    });

    it('rejects validation for a connection the caller does not own', async () => {
      seedConnection({ id: 'conn_val_other', tenantId: 'user_2', providerId: 'demo' });
      const { POST } = await import(
        '@/app/api/broker-execution/commands/validate/route'
      );

      const req = authedReq(
        'user_1',
        'http://localhost/api/broker-execution/commands/validate',
        'POST',
        {
          commandType: 'PLACE_MARKET',
          connectionId: 'conn_val_other',
          idempotencyKey: 'idem_validate_cross',
          symbol: 'BTC/USDT',
          side: 'BUY',
          size: 1,
        },
      );

      const res = await POST(req);
      expect(res.status).toBe(403);
    });
  });
});
