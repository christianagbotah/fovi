// ============================================================
// broker-execution-failclosed.test.ts
// Production-path fail-closed containment tests (CORRECTION
// ROUND, defect 11 scenarios A, B, C, D, J).
//
// These tests run REAL repositories, managers and route handlers
// against a faithful fake PostgreSQL (unique constraints, $transaction
// rollback). Only the encryption primitives are selectively
// instrumented to simulate failure (A/B) and only the db wire is
// made unavailable (C/D).
//
//   A. Encryption returns empty → credential storage fails;
//      NO credential DB write occurs.
//   B. Credential decryption/authentication fails → retrieval
//      fails as a whole; NO partial credentials are returned.
//   C. DB unavailable during kill-switch load → the store is not
//      treated as safely hydrated; execution evaluation cannot
//      assume no kill switch exists (fail closed).
//   D. DB failure during kill-switch activation/deactivation →
//      the API does NOT return false success.
//   J. Security-relevant state survives module re-import (a
//      simulated process restart) — it lives in the database,
//      NOT in module-local Maps.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { FakeBrokerDb } from '../helpers/broker-execution-fake-db';

// Trigger the db mock at module-load time (registers the fake on globalThis).
import '@/lib/broker-execution/persistence/db-access';

// ── db wire mock: faithful fake PostgreSQL ──
// The database wire boundary: a faithful fake with unique
// constraints, transaction rollback and compound unique lookups.
// Production repositories/managers/routes run for real on top of it.
// The factory REUSES the globalThis instance when present so the
// fake (and its seeded data) survives vi.resetModules() — which is
// exactly what a process restart must NOT lose.
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

// ── encryption mock: real crypto, with test-controlled failure ──
// encrypt() returns '' when __encFail is set (the exact production
// failure mode). decrypt() returns '' when __decFail is set.
vi.mock('@/lib/encryption', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/encryption')>();
  return {
    ...actual,
    encrypt: async (plaintext: string, aad?: string) => {
      if ((globalThis as unknown as Record<string, unknown>).__encFail === true) return '';
      return actual.encrypt(plaintext, aad);
    },
    decrypt: async (encryptedBase64: string, aad?: string) => {
      if ((globalThis as unknown as Record<string, unknown>).__decFail === true) return '';
      return actual.decrypt(encryptedBase64, aad);
    },
  };
});

function fakeDb(): FakeBrokerDb {
  return (globalThis as unknown as Record<string, unknown>).__brokerFakeDb as FakeBrokerDb;
}
function setDbAvailable(v: boolean) {
  (globalThis as unknown as Record<string, unknown>).__brokerFakeDbAvailable = v;
}
function setEncFail(v: boolean) {
  (globalThis as unknown as Record<string, unknown>).__encFail = v;
}
function setDecFail(v: boolean) {
  (globalThis as unknown as Record<string, unknown>).__decFail = v;
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

function adminReq(url: string, method = 'GET', body?: unknown): NextRequest {
  const headers: Record<string, string> = {
    'x-user-id': 'usr_admin_1',
    'x-user-role': 'admin',
    'Content-Type': 'application/json',
  };
  const init: RequestInit & { headers: Record<string, string> } = { method, headers };
  if (body) init.body = JSON.stringify(body);
  return new NextRequest(new URL(url), init as ConstructorParameters<typeof NextRequest>[1]);
}

beforeEach(() => {
  vi.clearAllMocks();
  fakeDb().__reset();
  setDbAvailable(true);
  setEncFail(false);
  setDecFail(false);
});

// ════════════════════════════════════════════════════════════════
// SCENARIO A: encryption returns empty → NO credential DB write
// ════════════════════════════════════════════════════════════════

describe('Scenario A: encryption returns empty → credential storage fails, no credential DB write', () => {
  it('encryptCredentialFields THROWS (fail-closed) when encrypt() returns empty', async () => {
    setEncFail(true);
    const { encryptCredentialFields, CredentialEncryptionFailureError } = await import(
      '@/lib/broker-execution/connection/credential-vault'
    );
    await expect(
      encryptCredentialFields({ apiKey: 'secret-key' }, 'tenant_1', 'conn_1'),
    ).rejects.toBeInstanceOf(CredentialEncryptionFailureError);
  });

  it('credential UPDATE aborts the ENTIRE write — no partial credentials, version unchanged', async () => {
    seedConnection({ id: 'conn_a1', tenantId: 'user_1' });
    setEncFail(true);

    const { ConnectionRepository } = await import(
      '@/lib/broker-execution/persistence/connection-repository'
    );
    const result = await ConnectionRepository.updateCredentials(
      'conn_a1',
      'user_1',
      { apiKey: 'new-key', apiSecret: 'new-secret' },
      'user_1',
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('CREDENTIAL_ENCRYPTION_FAILED');
    }

    // NOTHING was persisted: no credential columns, unchanged version
    const row = fakeDb().__tables.get('brokerConnection')!.get('conn_a1')!;
    expect(row.encryptedApiKey).toBeNull();
    expect(row.encryptedApiSecret).toBeNull();
    expect(row.credentialVersion).toBe(0);
    // No audit entry claiming storage
    expect(fakeDb().__tables.get('brokerExecutionAudit')!.size).toBe(0);
  });

  it('connection CREATION with credentials aborts the ENTIRE transaction — no connection row survives', async () => {
    setEncFail(true);
    const { ConnectionRepository } = await import(
      '@/lib/broker-execution/persistence/connection-repository'
    );
    const result = await ConnectionRepository.createConnection({
      tenantId: 'user_1',
      providerId: 'demo',
      credentials: { apiKey: 'key' },
      actorId: 'user_1',
    });

    expect(result.ok).toBe(false);
    // The whole transaction rolled back — NO connection was created
    expect(fakeDb().__tables.get('brokerConnection')!.size).toBe(0);
  });

  it('the API returns an error (not success) when encryption fails', async () => {
    setEncFail(true);
    const { POST } = await import('@/app/api/broker-execution/connections/route');
    const req = authedReq('user_1', 'http://localhost/api/broker-execution/connections', 'POST', {
      providerId: 'demo',
      credentials: { apiKey: 'key' },
    });
    const res = await POST(req);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(fakeDb().__tables.get('brokerConnection')!.size).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════
// SCENARIO B: decryption failure → retrieval fails as a whole
// ════════════════════════════════════════════════════════════════

describe('Scenario B: credential decryption/authentication fails → retrieval fails as a whole, no partial credentials', () => {
  it('decryptCredentialFields THROWS (fail-closed) when a stored value fails decryption', async () => {
    setDecFail(true);
    const { decryptCredentialFields, CredentialDecryptionFailureError } = await import(
      '@/lib/broker-execution/connection/credential-vault'
    );
    await expect(
      decryptCredentialFields({ apiKey: 'enc:v3:validlookingbase64' }, 'tenant_1', 'conn_1'),
    ).rejects.toBeInstanceOf(CredentialDecryptionFailureError);
  });

  it('retrieval fails as a WHOLE when one field is corrupt (no partial credential set)', async () => {
    // Store a REAL encrypted apiKey (valid) and a corrupt apiSecret.
    const { encrypt, decrypt } = await import('@/lib/encryption');
    const validEncrypted = await encrypt('real-key', 'fovi:broker-credential:user_1:conn_b1');

    seedConnection({
      id: 'conn_b1',
      tenantId: 'user_1',
      encryptedApiKey: `enc:v3:${validEncrypted}`,
      encryptedApiSecret: 'enc:v3:corrupt-not-base64-!!!',
    });

    const { ConnectionRepository } = await import(
      '@/lib/broker-execution/persistence/connection-repository'
    );
    // The ENTIRE retrieval fails — even though apiKey decrypts fine,
    // a partial { apiKey } set is NEVER returned.
    await expect(
      ConnectionRepository.getDecryptedCredentials('conn_b1', 'user_1'),
    ).rejects.toThrow();
    expect(decrypt).toBeDefined();
  });

  it('AAD-bound ciphertext transplanted to another connection fails the WHOLE retrieval', async () => {
    // Real crypto: encrypt for connection conn_orig, transplant to conn_other.
    const { encrypt } = await import('@/lib/encryption');
    const ciphertext = await encrypt('transplant-secret', 'fovi:broker-credential:user_1:conn_orig');

    seedConnection({
      id: 'conn_other',
      tenantId: 'user_1',
      encryptedApiKey: `enc:v3:${ciphertext}`,
    });

    const { ConnectionRepository } = await import(
      '@/lib/broker-execution/persistence/connection-repository'
    );
    // Decrypting under conn_other's AAD must fail — and the whole
    // retrieval fails rather than returning an empty/partial set.
    await expect(
      ConnectionRepository.getDecryptedCredentials('conn_other', 'user_1'),
    ).rejects.toThrow();
  });

  it('a stored value NOT in enc:v3 format fails the whole retrieval', async () => {
    seedConnection({
      id: 'conn_b3',
      tenantId: 'user_1',
      encryptedApiKey: 'plaintext-should-not-exist',
    });
    const { ConnectionRepository } = await import(
      '@/lib/broker-execution/persistence/connection-repository'
    );
    await expect(
      ConnectionRepository.getDecryptedCredentials('conn_b3', 'user_1'),
    ).rejects.toThrow();
  });
});

// ════════════════════════════════════════════════════════════════
// SCENARIO C: DB unavailable during kill-switch load → fail closed
// ════════════════════════════════════════════════════════════════

describe('Scenario C: DB unavailable during kill-switch load → evaluation fails closed (never "no kill switch")', () => {
  it('evaluateKillSwitches THROWS (fail-closed) when the DB is unreachable', async () => {
    fakeDb().__setFailMode(true);
    const { evaluateKillSwitches, KillSwitchEvaluationUnavailableError } = await import(
      '@/lib/broker-execution/kill-switches/kill-switch-manager'
    );
    await expect(
      evaluateKillSwitches({ tenantId: 't1', accountId: 'a1', providerId: 'demo' }),
    ).rejects.toBeInstanceOf(KillSwitchEvaluationUnavailableError);
  });

  it('the commands route returns 503 (fail-closed) when the kill-switch store is unreachable', async () => {
    seedConnection({ id: 'conn_c1', tenantId: 'user_1' });
    // Make every model call fail with a connection error AFTER seeding.
    fakeDb().__setFailMode(true);

    const { POST } = await import('@/app/api/broker-execution/commands/route');
    const req = authedReq('user_1', 'http://localhost/api/broker-execution/commands', 'POST', {
      commandType: 'PLACE_MARKET',
      connectionId: 'conn_c1',
      idempotencyKey: 'idem_c1',
      symbol: 'BTC/USDT',
      side: 'BUY',
      size: 1,
    });
    const res = await POST(req);
    // Fail-closed: NOT a 403 "blocked-by-policy" and definitely not
    // a success — the store cannot be proven switch-free.
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('the kill-switches LIST endpoint returns 503 (not an empty success) when the DB is down', async () => {
    fakeDb().__setFailMode(true);
    const { GET } = await import('@/app/api/broker-execution/kill-switches/route');
    const res = await GET(adminReq('http://localhost/api/broker-execution/kill-switches'));
    expect(res.status).toBe(503);
    const body = await res.json();
    // NEVER an empty 200 that would look like "no kill switches exist"
    expect(body.killSwitches).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════
// SCENARIO D: DB failure during activation/deactivation → no false success
// ════════════════════════════════════════════════════════════════

describe('Scenario D: DB failure during kill-switch activation/deactivation → no false success', () => {
  it('activation with the DB down returns 503, never 201', async () => {
    fakeDb().__setFailMode(true);
    const { POST } = await import('@/app/api/broker-execution/kill-switches/route');
    const req = adminReq('http://localhost/api/broker-execution/kill-switches', 'POST', {
      scope: 'GLOBAL',
      reason: 'attempt while db down',
    });
    const res = await POST(req);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toContain('fail-closed');
    // No kill switch record was persisted (nothing to persist to)
    expect(fakeDb().__tables.get('killSwitchRecord')!.size).toBe(0);
  });

  it('deactivation with the DB down returns 503, never 200', async () => {
    fakeDb().__setFailMode(true);
    const { PATCH } = await import('@/app/api/broker-execution/kill-switches/route');
    const req = adminReq('http://localhost/api/broker-execution/kill-switches', 'PATCH', {
      killSwitchId: 'ks_1',
    });
    const res = await PATCH(req);
    expect(res.status).toBe(503);
  });

  it('positive control: with the DB up, activation persists durably AND is visible to a fresh module import', async () => {
    const { POST } = await import('@/app/api/broker-execution/kill-switches/route');
    const req = adminReq('http://localhost/api/broker-execution/kill-switches', 'POST', {
      scope: 'GLOBAL',
      reason: 'durable activation',
    });
    const res = await POST(req);
    expect(res.status).toBe(201);

    // Simulated "other instance"/restart: fresh module registry.
    vi.resetModules();
    const { evaluateKillSwitches } = await import(
      '@/lib/broker-execution/kill-switches/kill-switch-manager'
    );
    const blocking = await evaluateKillSwitches({
      tenantId: 'any-tenant',
      accountId: 'any-account',
      providerId: 'any-provider',
    });
    // The authoritative store still blocks: state survived the "restart"
    expect(blocking).not.toBeNull();
    expect(blocking!.scope).toBe('GLOBAL');
    expect(blocking!.scopeId).toBe('global');
  });
});

// ════════════════════════════════════════════════════════════════
// SCENARIO J: security state is NOT dependent on module-local Maps
// ════════════════════════════════════════════════════════════════

describe('Scenario J: security-relevant state survives a simulated process restart (no module-local Maps)', () => {
  it('a command created by POST is retrievable by GET /commands/[id] after a full module reset', async () => {
    seedConnection({ id: 'conn_j1', tenantId: 'user_1', isDemo: false, accountType: 'live', providerId: 'okx' });

    // "Process 1": create the command
    const { POST } = await import('@/app/api/broker-execution/commands/route');
    const createRes = await POST(
      authedReq('user_1', 'http://localhost/api/broker-execution/commands', 'POST', {
        commandType: 'PLACE_MARKET',
        connectionId: 'conn_j1',
        idempotencyKey: 'idem_j1',
        symbol: 'BTC/USDT',
        side: 'BUY',
        size: 1,
      }),
    );
    expect(createRes.status).toBe(403); // blocked by Phase 1 containment
    const created = await createRes.json();
    expect(created.commandId).toBeDefined();

    // "Process 2": simulate a restart — clear the module registry so
    // every module (routes, repositories, providers) is re-imported
    // from scratch. Module-local Maps would be EMPTY here; the
    // database is not.
    vi.resetModules();

    const { GET } = await import('@/app/api/broker-execution/commands/[id]/route');
    const getRes = await GET(
      authedReq('user_1', `http://localhost/api/broker-execution/commands/${created.commandId}`),
      { params: Promise.resolve({ id: created.commandId }) },
    );
    expect(getRes.status).toBe(200);
    const fetched = await getRes.json();
    // SAME authoritative record (the split-Map bug is fixed: POST and
    // GET read the same PostgreSQL table).
    expect(fetched.commandId).toBe(created.commandId);
    expect(fetched.status).toBe('BLOCKED');
  });

  it('command history listing also survives the module reset (tenant-scoped)', async () => {
    seedConnection({ id: 'conn_j2', tenantId: 'user_1', isDemo: false, accountType: 'live', providerId: 'okx' });
    const { POST } = await import('@/app/api/broker-execution/commands/route');
    await POST(
      authedReq('user_1', 'http://localhost/api/broker-execution/commands', 'POST', {
        commandType: 'CANCEL',
        connectionId: 'conn_j2',
        idempotencyKey: 'idem_j2',
        brokerOrderId: 'ord-1',
      }),
    );

    vi.resetModules();

    const { GET } = await import('@/app/api/broker-execution/commands/route');
    const res = await GET(authedReq('user_1', 'http://localhost/api/broker-execution/commands'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.commands.length).toBe(1);
    expect(body.commands[0].commandType).toBe('CANCEL');
  });
});
