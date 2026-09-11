// ============================================================
// broker-execution-ownership.test.ts
// Production-path ownership, provider-identity, idempotency and
// execution-containment tests (CORRECTION ROUND, defect 11
// scenarios E, F, G, H, I, K).
//
// Real route handlers, repositories, managers, the central
// ExecutionProvider and the canonical provider registry run for
// real against a faithful fake PostgreSQL (unique constraints,
// $transaction rollback). The database wire is the ONLY boundary
// replaced.
//
//   E. Admin authorization: a valid admin whose ID does NOT begin
//      admin_ works; a non-admin whose ID begins admin_ does NOT
//      gain privilege (manager performs no ID-based checks).
//   F. Commands: user A cannot submit/validate against user B's
//      account; POST and GET /commands/[id] use the SAME
//      PostgreSQL record.
//   G. Reconciliation: omitting connectionId cannot bypass
//      ownership; accountId/connectionId mismatch is rejected.
//   H. Provider identity: a REST_WS live provider is not treated
//      as demo; a caller cannot relabel a live provider as demo.
//   I. Idempotency: duplicate submissions produce ONE
//      authoritative record; same key with changed payload is
//      rejected (409).
//   K. Execution containment: no broker execution method is ever
//      called; live trading is denied regardless of feature
//      flags/env flags/admin role.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

// ── adapter spy: any adapter construction/execution attempt is
// observable here (scenario K) ──
const adapterSpy = vi.hoisted(() => ({
  adapterCreated: 0,
}));

vi.mock('@/lib/broker-execution/adapter/adapter-registry', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const registryModule = actual as {
    getAdapterRegistry: () => { getAdapter: (...args: unknown[]) => unknown };
  };
  const originalGet = registryModule.getAdapterRegistry;
  return {
    ...actual,
    getAdapterRegistry: () => {
      const registry = originalGet();
      return {
        ...registry,
        getAdapter: (...args: unknown[]) => {
          adapterSpy.adapterCreated += 1;
          return registry.getAdapter(...args);
        },
      };
    },
  };
});

function fakeDb(): FakeBrokerDb {
  return (globalThis as unknown as Record<string, unknown>).__brokerFakeDb as FakeBrokerDb;
}

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

function authedReq(userId: string, url: string, method = 'GET', body?: unknown): NextRequest {
  const headers: Record<string, string> = { 'x-user-id': userId, 'Content-Type': 'application/json' };
  const init: RequestInit & { headers: Record<string, string> } = { method, headers };
  if (body) init.body = JSON.stringify(body);
  return new NextRequest(new URL(url), init as ConstructorParameters<typeof NextRequest>[1]);
}

function adminReq(url: string, method = 'GET', body?: unknown, userId = 'usr_plain_admin'): NextRequest {
  const headers: Record<string, string> = {
    'x-user-id': userId,
    'x-user-role': 'admin',
    'Content-Type': 'application/json',
  };
  const init: RequestInit & { headers: Record<string, string> } = { method, headers };
  if (body) init.body = JSON.stringify(body);
  return new NextRequest(new URL(url), init as ConstructorParameters<typeof NextRequest>[1]);
}

function nonAdminReq(url: string, method = 'GET', body?: unknown, userId = 'user_plain'): NextRequest {
  const headers: Record<string, string> = {
    'x-user-id': userId,
    'x-user-role': 'user',
    'Content-Type': 'application/json',
  };
  const init: RequestInit & { headers: Record<string, string> } = { method, headers };
  if (body) init.body = JSON.stringify(body);
  return new NextRequest(new URL(url), init as ConstructorParameters<typeof NextRequest>[1]);
}

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  vi.clearAllMocks();
  fakeDb().__reset();
  adapterSpy.adapterCreated = 0;
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

// ════════════════════════════════════════════════════════════════
// SCENARIO E: admin authorization — role, never user ID
// ════════════════════════════════════════════════════════════════

describe('Scenario E: admin authorization comes from the verified role — never a user-ID prefix', () => {
  it('a valid admin whose ID does NOT begin with admin_ can list kill switches', async () => {
    const { GET } = await import('@/app/api/broker-execution/kill-switches/route');
    const res = await GET(adminReq('http://localhost/api/broker-execution/kill-switches', 'GET', undefined, 'usr_7c2f9a41'));
    expect(res.status).toBe(200);
  });

  it('a valid admin whose ID does NOT begin with admin_ can activate a kill switch', async () => {
    const { POST } = await import('@/app/api/broker-execution/kill-switches/route');
    const res = await POST(adminReq('http://localhost/api/broker-execution/kill-switches', 'POST', {
      scope: 'GLOBAL',
      reason: 'activated by a plain-ID admin',
    }, 'usr_7c2f9a41'));
    expect(res.status).toBe(201);
    expect(fakeDb().__tables.get('killSwitchRecord')!.size).toBe(1);
  });

  it('a non-admin whose ID begins with admin_ does NOT gain privilege', async () => {
    const { POST } = await import('@/app/api/broker-execution/kill-switches/route');
    const res = await POST(nonAdminReq('http://localhost/api/broker-execution/kill-switches', 'POST', {
      scope: 'GLOBAL',
      reason: 'should be denied',
    }, 'admin_impostor_123'));
    expect(res.status).toBe(403);
    expect(fakeDb().__tables.get('killSwitchRecord')!.size).toBe(0);
  });

  it('the kill-switch manager source contains NO user-ID prefix convention', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/lib/broker-execution/kill-switches/kill-switch-manager.ts'),
      'utf-8',
    );
    expect(source).not.toContain("startsWith('admin_')");
    expect(source).not.toContain("userId === 'system'");
    expect(source).not.toContain('isAdminUser');
  });
});

// ════════════════════════════════════════════════════════════════
// SCENARIO F: commands ownership + single authoritative record
// ════════════════════════════════════════════════════════════════

describe('Scenario F: user A cannot submit/validate against user B\'s account; POST and GET use the same record', () => {
  beforeEach(() => {
    seedConnection({ id: 'conn_fa', tenantId: 'user_A', isDemo: false, accountType: 'live', providerId: 'okx' });
  });

  it('user B cannot SUBMIT a command against user A\'s connection', async () => {
    const { POST } = await import('@/app/api/broker-execution/commands/route');
    const res = await POST(
      authedReq('user_B', 'http://localhost/api/broker-execution/commands', 'POST', {
        commandType: 'PLACE_MARKET',
        connectionId: 'conn_fa',
        idempotencyKey: 'idem_f_b',
        symbol: 'BTC/USDT',
        side: 'BUY',
        size: 1,
      }),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    // Round 2, item 2: foreign connection = indistinguishable 404
    expect(body.code).toBe('CONNECTION_NOT_FOUND');
    expect(fakeDb().__tables.get('executionCommandRecord')!.size).toBe(0);
  });

  it('user B cannot VALIDATE a command against user A\'s connection', async () => {
    const { POST } = await import('@/app/api/broker-execution/commands/validate/route');
    const res = await POST(
      authedReq('user_B', 'http://localhost/api/broker-execution/commands/validate', 'POST', {
        commandType: 'PLACE_MARKET',
        connectionId: 'conn_fa',
        idempotencyKey: 'idem_f_b_val',
        symbol: 'BTC/USDT',
        side: 'BUY',
        size: 1,
      }),
    );
    // Round 2, item 2: foreign connection = indistinguishable 404
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('CONNECTION_NOT_FOUND');
  });

  it('user A submits and user B cannot READ the resulting command by id', async () => {
    const { POST } = await import('@/app/api/broker-execution/commands/route');
    const createRes = await POST(
      authedReq('user_A', 'http://localhost/api/broker-execution/commands', 'POST', {
        commandType: 'PLACE_MARKET',
        connectionId: 'conn_fa',
        idempotencyKey: 'idem_f_a',
        symbol: 'BTC/USDT',
        side: 'BUY',
        size: 1,
      }),
    );
    expect(createRes.status).toBe(403); // blocked by Phase 1 containment
    const created = await createRes.json();

    const { GET } = await import('@/app/api/broker-execution/commands/[id]/route');
    const getRes = await GET(
      authedReq('user_B', `http://localhost/api/broker-execution/commands/${created.commandId}`),
      { params: Promise.resolve({ id: created.commandId }) },
    );
    // 404 without leaking that the command exists for another tenant
    expect(getRes.status).toBe(404);
  });

  it('POST /commands and GET /commands/[id] use the SAME PostgreSQL record', async () => {
    const { POST } = await import('@/app/api/broker-execution/commands/route');
    const createRes = await POST(
      authedReq('user_A', 'http://localhost/api/broker-execution/commands', 'POST', {
        commandType: 'PLACE_MARKET',
        connectionId: 'conn_fa',
        idempotencyKey: 'idem_f_same',
        symbol: 'BTC/USDT',
        side: 'BUY',
        size: 1,
      }),
    );
    const created = await createRes.json();

    const { GET } = await import('@/app/api/broker-execution/commands/[id]/route');
    const getRes = await GET(
      authedReq('user_A', `http://localhost/api/broker-execution/commands/${created.commandId}`),
      { params: Promise.resolve({ id: created.commandId }) },
    );
    expect(getRes.status).toBe(200);
    const fetched = await getRes.json();
    expect(fetched.commandId).toBe(created.commandId);
    expect(fetched.status).toBe('BLOCKED');
    // Exactly ONE authoritative record exists
    expect(fakeDb().__tables.get('executionCommandRecord')!.size).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════
// SCENARIO G: reconciliation ownership bypass
// ════════════════════════════════════════════════════════════════

describe('Scenario G: omitting connectionId cannot bypass ownership; accountId/connectionId mismatch rejected', () => {
  beforeEach(() => {
    seedConnection({ id: 'conn_g1', tenantId: 'user_A', accountId: 'acct_g1' });
    seedConnection({ id: 'conn_g2', tenantId: 'user_B', accountId: 'acct_g2' });
  });

  it('GET without connectionId is rejected (400) — it cannot fall back to an unscoped accountId', async () => {
    const { GET } = await import('@/app/api/broker-execution/reconciliation/route');
    const res = await GET(
      authedReq('user_B', 'http://localhost/api/broker-execution/reconciliation?accountId=acct_g1'),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('connectionId');
  });

  it('POST without connectionId is rejected (400)', async () => {
    const { POST } = await import('@/app/api/broker-execution/reconciliation/route');
    const res = await POST(
      authedReq('user_B', 'http://localhost/api/broker-execution/reconciliation', 'POST', {
        accountId: 'acct_g1',
      }),
    );
    expect(res.status).toBe(400);
  });

  it('user B cannot reconcile user A\'s account by supplying user A\'s connectionId', async () => {
    const { GET } = await import('@/app/api/broker-execution/reconciliation/route');
    const res = await GET(
      authedReq(
        'user_B',
        'http://localhost/api/broker-execution/reconciliation?accountId=acct_g1&connectionId=conn_g1',
      ),
    );
    // Round 2, items 2+3: owner-scoped reconciliation with the
    // indistinguishable 404 for foreign connections (admin or not).
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('CONNECTION_NOT_FOUND');
  });

  it('accountId/connectionId mismatch is rejected even for the owning user', async () => {
    const { GET } = await import('@/app/api/broker-execution/reconciliation/route');
    // user_A owns conn_g1 (acct_g1) but claims acct_g2 — mismatch
    const res = await GET(
      authedReq(
        'user_A',
        'http://localhost/api/broker-execution/reconciliation?accountId=acct_g2&connectionId=conn_g1',
      ),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('ACCOUNT_CONNECTION_MISMATCH');
  });

  it('POST with matching owned pair proceeds (read-only, demo-only) and persists the result', async () => {
    const { POST } = await import('@/app/api/broker-execution/reconciliation/route');
    const res = await POST(
      authedReq('user_A', 'http://localhost/api/broker-execution/reconciliation', 'POST', {
        accountId: 'acct_g1',
        connectionId: 'conn_g1',
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.readOnly).toBe(true);
    // The result was persisted to the authoritative store
    expect(fakeDb().__tables.get('reconciliationResult')!.size).toBe(1);
  });

  it('a non-demo (live) connection is refused under Phase 1 containment', async () => {
    seedConnection({ id: 'conn_g_live', tenantId: 'user_A', accountId: 'acct_live', isDemo: false, accountType: 'live', providerId: 'okx' });
    const { POST } = await import('@/app/api/broker-execution/reconciliation/route');
    const res = await POST(
      authedReq('user_A', 'http://localhost/api/broker-execution/reconciliation', 'POST', {
        accountId: 'acct_live',
        connectionId: 'conn_g_live',
      }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('PHASE1_DEMO_ONLY');
  });
});

// ════════════════════════════════════════════════════════════════
// SCENARIO H: provider identity is canonical, server-side
// ════════════════════════════════════════════════════════════════

describe('Scenario H: REST_WS live providers are not demo; callers cannot relabel providers', () => {
  it('REST_WS live providers (okx, binance, bybit) are explicitly NOT demo', async () => {
    const { isCanonicalDemoProvider } = await import(
      '@/lib/broker-execution/providers/canonical-providers'
    );
    expect(isCanonicalDemoProvider('okx')).toBe(false);
    expect(isCanonicalDemoProvider('binance')).toBe(false);
    expect(isCanonicalDemoProvider('bybit')).toBe(false);
    expect(isCanonicalDemoProvider('demo')).toBe(true);
    expect(isCanonicalDemoProvider('unknown-provider')).toBeNull();
  });

  it('connection creation for a live REST_WS provider is refused under Phase 1', async () => {
    const { POST } = await import('@/app/api/broker-execution/connections/route');
    const res = await POST(
      authedReq('user_1', 'http://localhost/api/broker-execution/connections', 'POST', {
        providerId: 'okx',
      }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('PROVIDER_UNAVAILABLE');
    expect(fakeDb().__tables.get('brokerConnection')!.size).toBe(0);
  });

  it('a caller cannot relabel a live provider as demo (contradiction rejected)', async () => {
    const { POST } = await import('@/app/api/broker-execution/connections/route');
    const res = await POST(
      authedReq('user_1', 'http://localhost/api/broker-execution/connections', 'POST', {
        providerId: 'okx',
        isDemo: true, // caller-supplied contradiction — never trusted
      }),
    );
    expect(res.status).toBe(400);
    expect(fakeDb().__tables.get('brokerConnection')!.size).toBe(0);
  });

  it('a caller cannot relabel the demo provider as live (contradiction rejected)', async () => {
    const { POST } = await import('@/app/api/broker-execution/connections/route');
    const res = await POST(
      authedReq('user_1', 'http://localhost/api/broker-execution/connections', 'POST', {
        providerId: 'demo',
        isDemo: false,
      }),
    );
    expect(res.status).toBe(400);
  });

  it('unknown providers are rejected', async () => {
    const { POST } = await import('@/app/api/broker-execution/connections/route');
    const res = await POST(
      authedReq('user_1', 'http://localhost/api/broker-execution/connections', 'POST', {
        providerId: 'totally-unknown',
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('PROVIDER_UNKNOWN');
  });

  it('connection creation for the demo provider derives isDemo from the canonical registry', async () => {
    const { POST } = await import('@/app/api/broker-execution/connections/route');
    const res = await POST(
      authedReq('user_1', 'http://localhost/api/broker-execution/connections', 'POST', {
        providerId: 'demo',
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.isDemo).toBe(true);
    expect(body.accountType).toBe('demo');
    // persisted with server-derived classification
    const row = fakeDb().__tables.get('brokerConnection')!.get(body.id)!;
    expect(row.isDemo).toBe(true);
  });

  it('no display-name or transport-family demo heuristics remain in the provider surface', () => {
    const canonical = readFileSync(
      resolve(process.cwd(), 'src/lib/broker-execution/providers/canonical-providers.ts'),
      'utf-8',
    );
    const providersRoute = readFileSync(
      resolve(process.cwd(), 'src/app/api/broker-execution/providers/route.ts'),
      'utf-8',
    );
    const adapterRegistry = readFileSync(
      resolve(process.cwd(), 'src/lib/broker-execution/adapter/adapter-registry.ts'),
      'utf-8',
    );
    for (const source of [canonical, providersRoute, adapterRegistry]) {
      expect(source).not.toMatch(/toLowerCase\(\)\.includes\(['"]demo['"]\)/);
      expect(source).not.toMatch(/displayName\.toLowerCase/);
    }
    // REST_WS must not imply demo anywhere
    expect(adapterRegistry).not.toMatch(/providerType\s*===\s*['"]REST_WS['"]\s*\|\|/);
  });
});

// ════════════════════════════════════════════════════════════════
// SCENARIO I: idempotency — one authoritative record
// ════════════════════════════════════════════════════════════════

describe('Scenario I: idempotency — exactly one authoritative record per key+scope+fingerprint', () => {
  beforeEach(() => {
    seedConnection({ id: 'conn_i1', tenantId: 'user_1', isDemo: false, accountType: 'live', providerId: 'okx' });
  });

  it('duplicate identical submissions produce ONE record and a safe-retry response with the SAME commandId', async () => {
    const { POST } = await import('@/app/api/broker-execution/commands/route');
    const payload = {
      commandType: 'PLACE_MARKET',
      connectionId: 'conn_i1',
      idempotencyKey: 'idem_i_same',
      symbol: 'BTC/USDT',
      side: 'BUY',
      size: 1,
    };

    const first = await POST(authedReq('user_1', 'http://localhost/api/broker-execution/commands', 'POST', payload));
    expect(first.status).toBe(403); // blocked by containment
    const firstBody = await first.json();

    const second = await POST(authedReq('user_1', 'http://localhost/api/broker-execution/commands', 'POST', payload));
    expect(second.status).toBe(200); // safe retry
    const secondBody = await second.json();
    expect(secondBody.outcome).toBe('DUPLICATE');
    expect(secondBody.commandId).toBe(firstBody.commandId);

    // Exactly ONE command record and ONE idempotency record exist
    expect(fakeDb().__tables.get('executionCommandRecord')!.size).toBe(1);
    expect(fakeDb().__tables.get('idempotencyRecord')!.size).toBe(1);

    // The deduplicate count was atomically incremented on the retry
    const idemRow = [...fakeDb().__tables.get('idempotencyRecord')!.values()][0];
    expect(idemRow.deduplicateCount).toBe(1);
  });

  it('same key with a CHANGED payload is rejected with 409 conflict', async () => {
    const { POST } = await import('@/app/api/broker-execution/commands/route');
    const first = await POST(
      authedReq('user_1', 'http://localhost/api/broker-execution/commands', 'POST', {
        commandType: 'PLACE_MARKET',
        connectionId: 'conn_i1',
        idempotencyKey: 'idem_i_conflict',
        symbol: 'BTC/USDT',
        side: 'BUY',
        size: 1,
      }),
    );
    expect(first.status).toBe(403);

    // Same key, different payload (size changed)
    const second = await POST(
      authedReq('user_1', 'http://localhost/api/broker-execution/commands', 'POST', {
        commandType: 'PLACE_MARKET',
        connectionId: 'conn_i1',
        idempotencyKey: 'idem_i_conflict',
        symbol: 'BTC/USDT',
        side: 'BUY',
        size: 999,
      }),
    );
    expect(second.status).toBe(409);
    expect((await second.json()).code).toBe('IDEMPOTENCY_CONFLICT');
    // Still exactly one authoritative record
    expect(fakeDb().__tables.get('executionCommandRecord')!.size).toBe(1);
  });

  it('the unique-constraint serialization path: a second create for the same key+scope aborts its transaction and deduplicates', async () => {
    // Repository-level proof of the database semantics the atomic
    // claim depends on: the loser's transaction (command record +
    // transitions) is rolled back and deduplicated to the winner.
    const { CommandRepository } = await import(
      '@/lib/broker-execution/persistence/command-repository'
    );

    const base = {
      idempotencyKey: 'idem_i_p2002',
      tenantId: 'user_1',
      connectionId: 'conn_i1',
      accountId: 'conn_i1',
      providerId: 'okx',
      commandType: 'PLACE_MARKET',
      commandPayload: { symbol: 'BTC/USDT', side: 'BUY', size: 1 },
      requestFingerprint: 'fingerprint-fixed-value',
      correlationId: 'corr_i_p2002',
      transitions: [
        { fromState: 'CREATED', toState: 'VALIDATING', reason: 'Policy evaluation started', actorId: 'user_1' },
        { fromState: 'VALIDATING', toState: 'BLOCKED', reason: 'Phase 1 containment', actorId: 'user_1' },
      ],
      audit: { actorId: 'user_1', tenantId: 'user_1', action: 'COMMAND_BLOCKED' },
    };

    const first = await CommandRepository.createWithIdempotencyAndAudit({
      ...base, commandId: 'cmd_i_winner', finalState: 'BLOCKED',
    });
    expect(first.outcome).toBe('CREATED');

    const second = await CommandRepository.createWithIdempotencyAndAudit({
      ...base, commandId: 'cmd_i_loser', finalState: 'BLOCKED',
    });
    // The loser hits the P2002 unique constraint, its transaction
    // rolls back, and it deduplicates to the winner.
    expect(second.outcome).toBe('DUPLICATE');
    expect((second as { commandId: string }).commandId).toBe('cmd_i_winner');

    // Exactly ONE command record exists — the loser's was rolled back
    expect(fakeDb().__tables.get('executionCommandRecord')!.size).toBe(1);
    // ...and only the winner's transitions and audit survived
    const transitions = [...fakeDb().__tables.get('executionStateTransition')!.values()];
    expect(transitions.every((t) => t.commandId === 'cmd_i_winner')).toBe(true);
    expect(fakeDb().__tables.get('brokerExecutionAudit')!.size).toBe(1);
  });

  it('concurrent identical submissions via Promise.all settle on exactly ONE authoritative record', async () => {
    // In-process interleaving cannot force a true check-then-insert race
    // (the implementation has no check — it inserts and lets the unique
    // constraint serialize). This route-level test drives both requests
    // concurrently and asserts the invariant OUTCOME: one record, both
    // callers converge on the same commandId. The constraint itself is
    // verified against real PostgreSQL in the migration qualification.
    const { POST } = await import('@/app/api/broker-execution/commands/route');
    const payload = {
      commandType: 'PLACE_MARKET',
      connectionId: 'conn_i1',
      idempotencyKey: 'idem_i_concurrent',
      symbol: 'BTC/USDT',
      side: 'BUY',
      size: 1,
    };

    const [resA, resB] = await Promise.all([
      POST(authedReq('user_1', 'http://localhost/api/broker-execution/commands', 'POST', payload)),
      POST(authedReq('user_1', 'http://localhost/api/broker-execution/commands', 'POST', payload)),
    ]);

    const bodyA = await resA.json();
    const bodyB = await resB.json();

    // Exactly ONE authoritative command record exists
    expect(fakeDb().__tables.get('executionCommandRecord')!.size).toBe(1);
    expect(fakeDb().__tables.get('idempotencyRecord')!.size).toBe(1);

    // Both callers converge on the SAME authoritative commandId
    const commandIds = new Set([bodyA.commandId, bodyB.commandId]);
    expect(commandIds.size).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════
// SCENARIO K: execution containment — no broker method is reachable
// ════════════════════════════════════════════════════════════════

describe('Scenario K: no broker execution method is called; live trading denied under all conditions', () => {
  beforeEach(() => {
    seedConnection({ id: 'conn_k_live', tenantId: 'user_1', isDemo: false, accountType: 'live', providerId: 'okx' });
    seedConnection({ id: 'conn_k_demo', tenantId: 'user_1', isDemo: true, accountType: 'demo', providerId: 'demo' });
  });

  it('submitting commands never constructs or invokes a broker adapter', async () => {
    const { POST } = await import('@/app/api/broker-execution/commands/route');
    for (const connectionId of ['conn_k_live', 'conn_k_demo']) {
      await POST(
        authedReq('user_1', 'http://localhost/api/broker-execution/commands', 'POST', {
          commandType: 'PLACE_MARKET',
          connectionId,
          idempotencyKey: `idem_k_${connectionId}`,
          symbol: 'BTC/USDT',
          side: 'BUY',
          size: 1,
        }),
      );
    }
    expect(adapterSpy.adapterCreated).toBe(0);
  });

  it('live trading remains denied with ALL env override flags set to true', async () => {
    process.env.LIVE_TRADING_ENABLED = 'true';
    process.env.BROKER_CREDENTIAL_INTAKE_ENABLED = 'true';
    process.env.AUTOMATED_TRADING_ENABLED = 'true';

    const { POST } = await import('@/app/api/broker-execution/commands/route');
    const res = await POST(
      authedReq('user_1', 'http://localhost/api/broker-execution/commands', 'POST', {
        commandType: 'PLACE_MARKET',
        connectionId: 'conn_k_live',
        idempotencyKey: 'idem_k_env',
        symbol: 'BTC/USDT',
        side: 'BUY',
        size: 1,
      }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('PHASE1_LIVE_TRADING_DISABLED');
    expect(adapterSpy.adapterCreated).toBe(0);
  });

  it('live trading remains denied for an ADMIN user on a live connection THEY OWN', async () => {
    // The admin OWNS this live connection — the only remaining
    // barrier is Phase 1 containment itself, which must hold for
    // admins too (round 2, item 3 removed admin cross-tenant
    // resolution, NOT the containment denial).
    seedConnection({ id: 'conn_k_admin_live', tenantId: 'usr_admin_k', isDemo: false, accountType: 'live', providerId: 'okx' });
    const { POST } = await import('@/app/api/broker-execution/commands/route');
    const req = new NextRequest(new URL('http://localhost/api/broker-execution/commands'), {
      method: 'POST',
      headers: {
        'x-user-id': 'usr_admin_k',
        'x-user-role': 'admin',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        commandType: 'PLACE_MARKET',
        connectionId: 'conn_k_admin_live',
        idempotencyKey: 'idem_k_admin',
        symbol: 'BTC/USDT',
        side: 'BUY',
        size: 1,
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('PHASE1_LIVE_TRADING_DISABLED');
    expect(adapterSpy.adapterCreated).toBe(0);
  });

  it('an ADMIN gets the indistinguishable 404 for a live connection owned by ANOTHER user (round 2, items 2+3)', async () => {
    const { POST } = await import('@/app/api/broker-execution/commands/route');
    const req = new NextRequest(new URL('http://localhost/api/broker-execution/commands'), {
      method: 'POST',
      headers: {
        'x-user-id': 'usr_admin_k',
        'x-user-role': 'admin',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        commandType: 'PLACE_MARKET',
        connectionId: 'conn_k_live',
        idempotencyKey: 'idem_k_admin_foreign',
        symbol: 'BTC/USDT',
        side: 'BUY',
        size: 1,
      }),
    });
    const res = await POST(req);
    // conn_k_live belongs to user_1 — the admin receives the SAME
    // indistinguishable 404 CONNECTION_NOT_FOUND as anyone else
    // (no admin cross-tenant branch exists anywhere).
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('CONNECTION_NOT_FOUND');
    expect(adapterSpy.adapterCreated).toBe(0);
  });

  it('demo commands are blocked at the Phase 1 environment gate (hard constant, not flag-derivable)', async () => {
    const { POST } = await import('@/app/api/broker-execution/commands/route');
    const res = await POST(
      authedReq('user_1', 'http://localhost/api/broker-execution/commands', 'POST', {
        commandType: 'PLACE_MARKET',
        connectionId: 'conn_k_demo',
        idempotencyKey: 'idem_k_demo',
        symbol: 'BTC/USDT',
        side: 'BUY',
        size: 1,
      }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('ENVIRONMENT_EXECUTION_DISABLED');
    expect(adapterSpy.adapterCreated).toBe(0);
  });

  it('an active kill switch blocks even a structurally-valid demo command (persisted BLOCKED)', async () => {
    // Activate a GLOBAL kill switch first (admin route)
    const { POST: postKillSwitch } = await import('@/app/api/broker-execution/kill-switches/route');
    await postKillSwitch(
      adminReq('http://localhost/api/broker-execution/kill-switches', 'POST', {
        scope: 'GLOBAL',
        reason: 'K-scenario containment',
      }),
    );

    const { POST } = await import('@/app/api/broker-execution/commands/route');
    const res = await POST(
      authedReq('user_1', 'http://localhost/api/broker-execution/commands', 'POST', {
        commandType: 'PLACE_MARKET',
        connectionId: 'conn_k_demo',
        idempotencyKey: 'idem_k_killswitch',
        symbol: 'BTC/USDT',
        side: 'BUY',
        size: 1,
      }),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    // blocked by the kill-switch gate with a persisted BLOCKED record
    const row = [...fakeDb().__tables.get('executionCommandRecord')!.values()]
      .find((r) => r.commandId === body.commandId);
    expect(row).toBeDefined();
    expect(row!.currentState).toBe('BLOCKED');
    expect(adapterSpy.adapterCreated).toBe(0);
  });

  it('the policy gate source keeps enforceLiveTradingPolicy as the unconditional FIRST check', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/lib/broker-execution/execution/policy-gate.ts'),
      'utf-8',
    );
    const gateOne = source.indexOf('enforceLiveTradingPolicy');
    const gateTwo = source.indexOf('GATE 2: Environment gate');
    expect(gateOne).toBeGreaterThan(-1);
    expect(gateTwo).toBeGreaterThan(gateOne);
  });
});
