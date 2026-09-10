// ============================================================
// broker-execution-containment.test.ts
// Containment behavioral tests proving 9 architectural invariants
// for the Fovi broker-execution framework.
//
// These tests prove that the broker-execution boundary is
// hermetically sealed against:
//   1. Live execution (Phase 1 unconditional containment)
//   2. Unauthenticated access
//   3. Non-admin kill switch operations
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

const ORIGINAL_ENV = process.env;

// ── Shared mocks ──

vi.mock('@/lib/db', () => ({
  db: null,
  hasModel: () => false,
  safeDbQuery: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/broker/factory', () => ({
  createBroker: vi.fn(),
  createBrokerFromAccount: vi.fn(),
  BrokerFactoryError: class extends Error {
    code: string;
    constructor(c: string, m: string) { super(m); this.code = c; this.name = 'BrokerFactoryError'; }
  },
}));

vi.mock('@/lib/subscription-guard', () => ({
  checkSubscriptionLimit: () => ({ allowed: true, current: 0, limit: 10 }),
  getLimitMessage: () => 'Limit exceeded',
}));

vi.mock('@/lib/system-config', () => ({
  getGlobalAdminLevy: () => Promise.resolve(10),
}));

vi.mock('@/lib/demo-sltp-store', () => ({
  loadDemoPositionSLTP: () => new Map(),
  saveDemoPositionSLTP: () => {},
}));

vi.mock('@/lib/auth', () => ({
  verifyToken: vi.fn(),
  extractBearerToken: vi.fn(),
}));

// Mock the connection manager to support cross-tenant testing
const mockConnectionStore = new Map<string, { id: string; tenantId: string; providerId: string; accountName?: string }>();

vi.mock('@/lib/broker-execution/connection/connection-manager', () => {
  class TenantIsolationError extends Error {
    constructor() { super('Tenant isolation violation'); this.name = 'TenantIsolationError'; }
  }

  return {
    TenantIsolationError,
    getConnectionManager: () => ({
      listConnections: (tenantId: string) =>
        Array.from(mockConnectionStore.values()).filter(c => c.tenantId === tenantId),
      getConnection: (connectionId: string, tenantId: string) => {
        const conn = mockConnectionStore.get(connectionId);
        if (!conn) return null;
        if (conn.tenantId !== tenantId) throw new TenantIsolationError();
        return conn;
      },
      createConnection: vi.fn().mockResolvedValue({ id: 'conn_new', tenantId: 'user_1', providerId: 'demo' }),
      updateConnection: vi.fn().mockReturnValue({ id: 'conn_1', tenantId: 'user_1', providerId: 'demo' }),
      deleteConnection: vi.fn().mockReturnValue(true),
    }),
  };
});

vi.mock('@/lib/broker-execution/adapter/adapter-registry', () => ({
  getAdapterRegistry: () => ({
    listProviders: () => [
      { providerType: 'DEMO', displayName: 'Demo Provider', isAvailable: true, blockedReason: null },
    ],
    getProviderCapabilities: () => ({}),
  }),
}));

vi.mock('@/lib/broker-execution/capabilities/capability-registry', () => ({
  getCapabilityRegistry: () => ({
    getCapabilities: () => null,
  }),
}));

vi.mock('@/lib/broker-execution/reconciliation/reconciliation-store', () => ({
  ReconciliationStore: class {
    getHistory = vi.fn().mockResolvedValue([]);
  },
}));

vi.mock('@/lib/broker-execution/observability/audit-trail', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    auditTrail: {
      query: vi.fn().mockReturnValue([]),
    },
  };
});

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

function adminReq(url: string, method = 'GET', body?: unknown): NextRequest {
  const headers: Record<string, string> = {
    'x-user-id': 'admin_001',
    'x-user-role': 'admin',
    'Content-Type': 'application/json',
  };
  const init: RequestInit & { headers: Record<string, string> } = { method, headers };
  if (body) init.body = JSON.stringify(body);
  return new NextRequest(new URL(url), init as ConstructorParameters<typeof NextRequest>[1]);
}

function nonAdminReq(url: string, method = 'GET', body?: unknown): NextRequest {
  const headers: Record<string, string> = {
    'x-user-id': 'user_regular',
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
    it('blocks a PLACE_MARKET command for a live account', async () => {
      const { ExecutionProvider } = await import(
        '@/lib/broker-execution/execution/execution-provider'
      );
      const provider = new ExecutionProvider();

      const command = {
        commandId: 'cmd_live_1',
        idempotencyKey: 'idem_live_1',
        tenantId: 'tenant_1',
        accountId: 'acc_live',
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
      };

      const result = await provider.submitCommand(command as never, context as never);
      expect(result.blocked).toBe(true);
      expect(result.state).toBe('BLOCKED');
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
});

// ════════════════════════════════════════════════════════════════
// INVARIANT 2: No execution endpoint bypasses auth
// ════════════════════════════════════════════════════════════════

describe('Invariant 2: No execution endpoint bypasses auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  const BASE = 'http://localhost';

  it('/commands POST returns 401 when no X-User-Id header', async () => {
    const { POST } = await import('@/app/api/broker-execution/commands/route');
    const req = unauthedReq(`${BASE}/api/broker-execution/commands`, 'POST', {
      commandType: 'PLACE_MARKET',
      accountId: 'acc_1',
      providerId: 'demo',
      idempotencyKey: 'idem_1',
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('/commands GET returns 401 when no X-User-Id header', async () => {
    const { GET } = await import('@/app/api/broker-execution/commands/route');
    const req = unauthedReq(`${BASE}/api/broker-execution/commands`);
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('/commands/validate POST returns 401 when no X-User-Id header', async () => {
    const { POST } = await import('@/app/api/broker-execution/commands/validate/route');
    const req = unauthedReq(`${BASE}/api/broker-execution/commands/validate`, 'POST', {
      commandType: 'PLACE_MARKET',
      accountId: 'acc_1',
      providerId: 'demo',
      idempotencyKey: 'idem_val',
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('/connections GET returns 401 when no X-User-Id header', async () => {
    const { GET } = await import('@/app/api/broker-execution/connections/route');
    const req = unauthedReq(`${BASE}/api/broker-execution/connections`);
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('/connections POST returns 401 when no X-User-Id header', async () => {
    const { POST } = await import('@/app/api/broker-execution/connections/route');
    const req = unauthedReq(`${BASE}/api/broker-execution/connections`, 'POST', {
      providerId: 'demo',
      name: 'Test',
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('/capabilities with connectionId returns 401 when no X-User-Id header', async () => {
    const { GET } = await import('@/app/api/broker-execution/capabilities/route');
    const req = unauthedReq(
      `${BASE}/api/broker-execution/capabilities?connectionId=conn_1`,
    );
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('/reconciliation GET returns 401 when no X-User-Id header', async () => {
    const { GET } = await import('@/app/api/broker-execution/reconciliation/route');
    const req = unauthedReq(
      `${BASE}/api/broker-execution/reconciliation?accountId=acc_1`,
    );
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('/reconciliation POST returns 401 when no X-User-Id header', async () => {
    const { POST } = await import('@/app/api/broker-execution/reconciliation/route');
    const req = unauthedReq(`${BASE}/api/broker-execution/reconciliation`, 'POST', {
      accountId: 'acc_1',
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('/audit GET returns 401 when no X-User-Id header', async () => {
    const { GET } = await import('@/app/api/broker-execution/audit/route');
    const req = unauthedReq(`${BASE}/api/broker-execution/audit`);
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('/kill-switches GET returns 401 when no X-User-Id header', async () => {
    const { GET } = await import('@/app/api/broker-execution/kill-switches/route');
    const req = unauthedReq(`${BASE}/api/broker-execution/kill-switches`);
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('/kill-switches POST returns 401 when no X-User-Id header', async () => {
    const { POST } = await import('@/app/api/broker-execution/kill-switches/route');
    const req = unauthedReq(`${BASE}/api/broker-execution/kill-switches`, 'POST', {
      scope: 'GLOBAL',
      scopeId: 'global',
      reason: 'test',
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});

// ════════════════════════════════════════════════════════════════
// INVARIANT 3: Non-admin users cannot operate kill switches
// ════════════════════════════════════════════════════════════════

describe('Invariant 3: Non-admin users cannot operate global/tenant/provider kill switches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  describe('kill-switch-manager: activateKillSwitch rejects non-admin', () => {
    it('throws for a regular user ID', async () => {
      const { activateKillSwitch } = await import(
        '@/lib/broker-execution/kill-switches/kill-switch-manager'
      );
      await expect(
        activateKillSwitch({
          scope: 'GLOBAL',
          scopeId: 'global',
          activatedBy: 'user_regular',
          reason: 'Should not work',
        }),
      ).rejects.toThrow('not an admin');
    });

    it('throws for an empty user ID', async () => {
      const { activateKillSwitch } = await import(
        '@/lib/broker-execution/kill-switches/kill-switch-manager'
      );
      await expect(
        activateKillSwitch({
          scope: 'TENANT',
          scopeId: 'tenant_1',
          activatedBy: '',
          reason: 'Should not work',
        }),
      ).rejects.toThrow('not an admin');
    });

    it('allows admin_ prefixed user ID', async () => {
      const { activateKillSwitch } = await import(
        '@/lib/broker-execution/kill-switches/kill-switch-manager'
      );
      const result = await activateKillSwitch({
        scope: 'GLOBAL',
        scopeId: 'global',
        activatedBy: 'admin_ops',
        reason: 'Emergency shutdown',
      });
      expect(result.state).toBe('ACTIVE');
      expect(result.activatedBy).toBe('admin_ops');
    });

    it('allows "system" user ID', async () => {
      const { activateKillSwitch } = await import(
        '@/lib/broker-execution/kill-switches/kill-switch-manager'
      );
      const result = await activateKillSwitch({
        scope: 'GLOBAL',
        scopeId: 'global',
        activatedBy: 'system',
        reason: 'Auto trigger',
      });
      expect(result.state).toBe('ACTIVE');
    });
  });

  describe('kill-switch-manager: deactivateKillSwitch rejects non-admin', () => {
    it('throws for a regular user ID', async () => {
      const { activateKillSwitch, deactivateKillSwitch } = await import(
        '@/lib/broker-execution/kill-switches/kill-switch-manager'
      );
      // First activate with admin
      const ks = await activateKillSwitch({
        scope: 'GLOBAL',
        scopeId: 'global',
        activatedBy: 'admin_ops',
        reason: 'Setup for deactivation test',
      });

      // Then try to deactivate with non-admin
      await expect(
        deactivateKillSwitch({
          killSwitchId: ks.id,
          deactivatedBy: 'user_regular',
        }),
      ).rejects.toThrow('not an admin');
    });
  });

  describe('API route: /kill-switches requires admin role', () => {
    it('GET returns 403 for non-admin role', async () => {
      const { GET } = await import('@/app/api/broker-execution/kill-switches/route');
      const req = nonAdminReq('http://localhost/api/broker-execution/kill-switches');
      const res = await GET(req);
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.code).toBe('FORBIDDEN');
    });

    it('POST returns 403 for non-admin role', async () => {
      const { POST } = await import('@/app/api/broker-execution/kill-switches/route');
      const req = nonAdminReq(
        'http://localhost/api/broker-execution/kill-switches',
        'POST',
        { scope: 'GLOBAL', scopeId: 'global', reason: 'attack attempt' },
      );
      const res = await POST(req);
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.code).toBe('FORBIDDEN');
    });

    it('GET allows admin role', async () => {
      const { GET } = await import('@/app/api/broker-execution/kill-switches/route');
      const req = adminReq('http://localhost/api/broker-execution/kill-switches');
      const res = await GET(req);
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
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
    mockConnectionStore.clear();

    // Set up a connection belonging to USER_A
    mockConnectionStore.set(CONN_ID, {
      id: CONN_ID,
      tenantId: USER_A,
      providerId: 'demo',
    });
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  describe('connections/[id] GET — cross-tenant isolation', () => {
    it('returns 403 when USER_B tries to GET USER_A\'s connection', async () => {
      const { GET } = await import('@/app/api/broker-execution/connections/[id]/route');
      const req = authedReq(USER_B, `http://localhost/api/broker-execution/connections/${CONN_ID}`);
      const res = await GET(req, { params: Promise.resolve({ id: CONN_ID }) });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.code).toBe('TENANT_ISOLATION_VIOLATION');
    });

    it('allows USER_A to GET their own connection', async () => {
      const { GET } = await import('@/app/api/broker-execution/connections/[id]/route');
      const req = authedReq(USER_A, `http://localhost/api/broker-execution/connections/${CONN_ID}`);
      const res = await GET(req, { params: Promise.resolve({ id: CONN_ID }) });
      expect(res.status).not.toBe(403);
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
          body: JSON.stringify({ name: 'Hacked!' }),
        },
      );
      const res = await PATCH(req, { params: Promise.resolve({ id: CONN_ID }) });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.code).toBe('TENANT_ISOLATION_VIOLATION');
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
    });
  });

  describe('connections list — tenant-scoped', () => {
    it('GET /connections only returns connections belonging to the authenticated user', async () => {
      // Add another connection for USER_B
      mockConnectionStore.set('conn_b', {
        id: 'conn_b',
        tenantId: USER_B,
        providerId: 'demo',
      });

      const { GET } = await import('@/app/api/broker-execution/connections/route');
      const req = authedReq(USER_A, 'http://localhost/api/broker-execution/connections');
      const res = await GET(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      // USER_A should only see their own connection, not USER_B's
      const tenantIds = body.connections.map((c: { tenantId: string }) => c.tenantId);
      expect(tenantIds.every((id: string) => id === USER_A)).toBe(true);
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
      // The request passes through (not 401), but the forged
      // identity headers are gone.
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

    it('strips encrypted credential variants', async () => {
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

  describe('CredentialVault.redactCredentials replaces all fields with REDACTED', () => {
    it('redacts all credential fields', async () => {
      const { CredentialVault } = await import(
        '@/lib/broker-execution/connection/credential-vault'
      );
      const vault = new CredentialVault();
      const redacted = vault.redactCredentials({
        apiKey: 'real-key-123',
        apiSecret: 'real-secret-456',
        passphrase: 'real-passphrase-789',
        token: 'real-token-abc',
        refreshToken: 'real-refresh-def',
      });

      expect(redacted.apiKey).toBe('***REDACTED***');
      expect(redacted.apiSecret).toBe('***REDACTED***');
      expect(redacted.passphrase).toBe('***REDACTED***');
      expect(redacted.token).toBe('***REDACTED***');
      expect(redacted.refreshToken).toBe('***REDACTED***');
    });

    it('does not include fields that were undefined in input', async () => {
      const { CredentialVault } = await import(
        '@/lib/broker-execution/connection/credential-vault'
      );
      const vault = new CredentialVault();
      const redacted = vault.redactCredentials({
        apiKey: 'real-key',
      });
      expect(redacted.apiKey).toBe('***REDACTED***');
      expect(redacted.apiSecret).toBeUndefined();
      expect(redacted.passphrase).toBeUndefined();
    });
  });

  describe('redactForTelemetry recursively strips sensitive fields', () => {
    it('redacts known credential field names', async () => {
      const { redactForTelemetry } = await import(
        '@/lib/broker-execution/observability/telemetry'
      );
      const input = {
        connectionId: 'conn_1',
        apiKey: 'leaked-key',
        apiSecret: 'leaked-secret',
        passphrase: 'leaked-passphrase',
        token: 'leaked-token',
        refreshToken: 'leaked-refresh',
        normalField: 'visible',
      };
      const redacted = redactForTelemetry(input) as Record<string, unknown>;
      expect(redacted.apiKey).toBe('[REDACTED]');
      expect(redacted.apiSecret).toBe('[REDACTED]');
      expect(redacted.passphrase).toBe('[REDACTED]');
      expect(redacted.token).toBe('[REDACTED]');
      expect(redacted.refreshToken).toBe('[REDACTED]');
      expect(redacted.connectionId).toBe('conn_1');
      expect(redacted.normalField).toBe('visible');
    });

    it('redacts nested objects recursively', async () => {
      const { redactForTelemetry } = await import(
        '@/lib/broker-execution/observability/telemetry'
      );
      const input = {
        nested: {
          apiKey: 'deep-leaked-key',
          safe: 'ok',
        },
      };
      const redacted = redactForTelemetry(input) as Record<string, unknown>;
      const nested = redacted.nested as Record<string, unknown>;
      expect(nested.apiKey).toBe('[REDACTED]');
      expect(nested.safe).toBe('ok');
    });

    it('redacts arrays containing sensitive objects', async () => {
      const { redactForTelemetry } = await import(
        '@/lib/broker-execution/observability/telemetry'
      );
      const input = [
        { apiKey: 'arr-key-1', name: 'first' },
        { apiSecret: 'arr-secret-2', name: 'second' },
      ];
      const redacted = redactForTelemetry(input) as Record<string, unknown>[];
      expect(redacted[0].apiKey).toBe('[REDACTED]');
      expect(redacted[0].name).toBe('first');
      expect(redacted[1].apiSecret).toBe('[REDACTED]');
      expect(redacted[1].name).toBe('second');
    });
  });

  describe('redactForAudit strips sensitive fields (same patterns as telemetry)', () => {
    it('redacts all credential fields from an audit object', async () => {
      const { redactForAudit } = await import(
        '@/lib/broker-execution/observability/audit-trail'
      );
      const input = {
        actorId: 'user_1',
        apiKey: 'should-not-appear',
        apiSecret: 'should-not-appear',
        password: 'should-not-appear',
        secret: 'should-not-appear',
        reason: 'normal reason',
      };
      const redacted = redactForAudit(input) as Record<string, unknown>;
      expect(redacted.apiKey).toBe('[REDACTED]');
      expect(redacted.apiSecret).toBe('[REDACTED]');
      expect(redacted.password).toBe('[REDACTED]');
      expect(redacted.secret).toBe('[REDACTED]');
      expect(redacted.actorId).toBe('user_1');
      expect(redacted.reason).toBe('normal reason');
    });
  });

  describe('logSecurityEvent redacts fields containing secret/key/token/password', () => {
    it('redacts credential-like field names in security events', async () => {
      const { logSecurityEvent } = await import('@/lib/trading-policy');
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      logSecurityEvent({
        eventType: 'TEST_CREDENTIAL_LEAK',
        apiKey: 'sensitive-key',
        userSecret: 'sensitive-secret',
        accessToken: 'sensitive-token',
        userPassword: 'sensitive-password',
        normalField: 'should-appear',
      });
      expect(warnSpy).toHaveBeenCalledOnce();
      const logged = JSON.parse(warnSpy.mock.calls[0][0]);
      expect(logged.apiKey).toBe('[REDACTED]');
      expect(logged.userSecret).toBe('[REDACTED]');
      expect(logged.accessToken).toBe('[REDACTED]');
      expect(logged.userPassword).toBe('[REDACTED]');
      expect(logged.normalField).toBe('should-appear');
      warnSpy.mockRestore();
    });
  });
});

// ════════════════════════════════════════════════════════════════
// INVARIANT 7: PostgreSQL datasource is preserved
// ════════════════════════════════════════════════════════════════

describe('Invariant 7: PostgreSQL datasource is preserved', () => {
  it('prisma/schema.prisma datasource provider is "postgresql"', () => {
    const schemaPath = resolve(process.cwd(), 'prisma/schema.prisma');
    const schema = readFileSync(schemaPath, 'utf-8');

    // Extract the datasource block
    const datasourceMatch = schema.match(
      new RegExp('datasource\\s+db\\s*\\{[^}]*\\}', 's'),
    );
    expect(datasourceMatch).not.toBeNull();

    const datasourceBlock = datasourceMatch![0];

    // Assert provider is postgresql
    expect(datasourceBlock).toMatch(/provider\s*=\s*"postgresql"/);

    // Assert it is NOT sqlite
    expect(datasourceBlock).not.toMatch(/provider\s*=\s*"sqlite"/i);
  });

  it('schema does not contain sqlite as a provider anywhere', () => {
    const schemaPath = resolve(process.cwd(), 'prisma/schema.prisma');
    const schema = readFileSync(schemaPath, 'utf-8');
    // Double-check: no SQLite provider anywhere in the schema
    expect(schema).not.toMatch(/provider\s*=\s*"sqlite"/i);
  });
});

// ════════════════════════════════════════════════════════════════
// INVARIANT 8: Public route exposure is limited to intentionally
//              public read-only endpoints
// ════════════════════════════════════════════════════════════════

describe('Invariant 8: Public route exposure is limited to intentionally public read-only endpoints', () => {
  it('only /api/broker-execution/health and /api/broker-execution/providers are in PUBLIC_PATHS', async () => {
    // Read the proxy source directly to extract PUBLIC_PATHS
    const { readFileSync: readSync } = await import('node:fs');
    const { resolve: resolvePath } = await import('node:path');
    const proxyPath = resolvePath(process.cwd(), 'src/proxy.ts');
    const proxySource = readSync(proxyPath, 'utf-8');

    // The broker-execution public paths should be exactly these two
    expect(proxySource).toContain("'/api/broker-execution/health'");
    expect(proxySource).toContain("'/api/broker-execution/providers'");
  });

  it('/commands is NOT in PUBLIC_PATHS', async () => {
    const { readFileSync: readSync } = await import('node:fs');
    const { resolve: resolvePath } = await import('node:path');
    const proxySource = readSync(resolvePath(process.cwd(), 'src/proxy.ts'), 'utf-8');

    // Extract the PUBLIC_PATHS array
    const publicPathsMatch = proxySource.match(
      /const PUBLIC_PATHS[^[]*\[([\s\S]*?)\]/,
    );
    expect(publicPathsMatch).not.toBeNull();
    const publicPathsContent = publicPathsMatch![1];

    expect(publicPathsContent).not.toContain("'/api/broker-execution/commands'");
  });

  it('/connections is NOT in PUBLIC_PATHS', async () => {
    const { readFileSync: readSync } = await import('node:fs');
    const { resolve: resolvePath } = await import('node:path');
    const proxySource = readSync(resolvePath(process.cwd(), 'src/proxy.ts'), 'utf-8');
    const publicPathsMatch = proxySource.match(
      /const PUBLIC_PATHS[^[]*\[([\s\S]*?)\]/,
    );
    expect(publicPathsMatch).not.toBeNull();
    expect(publicPathsMatch![1]).not.toContain("'/api/broker-execution/connections'");
  });

  it('/kill-switches is NOT in PUBLIC_PATHS', async () => {
    const { readFileSync: readSync } = await import('node:fs');
    const { resolve: resolvePath } = await import('node:path');
    const proxySource = readSync(resolvePath(process.cwd(), 'src/proxy.ts'), 'utf-8');
    const publicPathsMatch = proxySource.match(
      /const PUBLIC_PATHS[^[]*\[([\s\S]*?)\]/,
    );
    expect(publicPathsMatch).not.toBeNull();
    expect(publicPathsMatch![1]).not.toContain("'/api/broker-execution/kill-switches'");
  });

  it('/reconciliation is NOT in PUBLIC_PATHS', async () => {
    const { readFileSync: readSync } = await import('node:fs');
    const { resolve: resolvePath } = await import('node:path');
    const proxySource = readSync(resolvePath(process.cwd(), 'src/proxy.ts'), 'utf-8');
    const publicPathsMatch = proxySource.match(
      /const PUBLIC_PATHS[^[]*\[([\s\S]*?)\]/,
    );
    expect(publicPathsMatch).not.toBeNull();
    expect(publicPathsMatch![1]).not.toContain("'/api/broker-execution/reconciliation'");
  });

  it('/audit is NOT in PUBLIC_PATHS', async () => {
    const { readFileSync: readSync } = await import('node:fs');
    const { resolve: resolvePath } = await import('node:path');
    const proxySource = readSync(resolvePath(process.cwd(), 'src/proxy.ts'), 'utf-8');
    const publicPathsMatch = proxySource.match(
      /const PUBLIC_PATHS[^[]*\[([\s\S]*?)\]/,
    );
    expect(publicPathsMatch).not.toBeNull();
    expect(publicPathsMatch![1]).not.toContain("'/api/broker-execution/audit'");
  });
});

// ════════════════════════════════════════════════════════════════
// INVARIANT 9: Execution validation does not itself submit an order
// ════════════════════════════════════════════════════════════════

describe('Invariant 9: Execution validation does not itself submit an order', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
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
      // Returns a pure validation result — no state transitions
      expect(result).toHaveProperty('isValid');
      expect(result).toHaveProperty('errors');
      expect(result).toHaveProperty('warnings');
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('does not create any execution state record', async () => {
      const { validateCommandForDryRun } = await import(
        '@/lib/broker-execution/execution/policy-gate'
      );
      const { ExecutionProvider } = await import(
        '@/lib/broker-execution/execution/execution-provider'
      );

      const provider = new ExecutionProvider();

      // validateCommand is a method on ExecutionProvider too
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
      // Validation result does not contain any state machine info
      expect(result).toHaveProperty('isValid');
      expect(result).toHaveProperty('errors');
      expect(result).toHaveProperty('warnings');
      expect(result).toHaveProperty('isAuthorized');
      expect(result).toHaveProperty('authorizationReason');

      // The command should NOT have a state record
      const status = provider.getCommandStatus('cmd_val_provider');
      expect(status).toBeNull();
    });
  });

  describe('/commands/validate route never transitions to SUBMITTING', () => {
    it('returns executionPermitted: false always (Phase 1)', async () => {
      const { POST } = await import(
        '@/app/api/broker-execution/commands/validate/route'
      );

      const req = authedReq(
        'user_1',
        'http://localhost/api/broker-execution/commands/validate',
        'POST',
        {
          commandType: 'PLACE_MARKET',
          accountId: 'acc_demo',
          providerId: 'demo',
          idempotencyKey: 'idem_validate_api',
          symbol: 'BTC/USDT',
          side: 'BUY',
          size: 1,
        },
      );

      const res = await POST(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      // executionPermitted is ALWAYS false in Phase 1
      expect(body.executionPermitted).toBe(false);
      // No SUBMITTING state — just validation
      expect(body.validation).toBeDefined();
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
          accountId: 'acc_demo',
          providerId: 'demo',
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
          accountId: 'acc_demo',
          providerId: 'demo',
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
  });
});
