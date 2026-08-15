// ============================================================
// Phase 1 — Correction Round 1 Containment Tests
// Verifies emergency containment fixes across the Fovi platform.
// ============================================================
//
// CRITICAL: proxy and trading-policy are imported at the TOP LEVEL so
// that trading-policy's INTERNAL_SERVICE_SECRET const captures the
// empty value (env not set at module-load time).  The proxy tests then
// set the env var BEFORE CALLING proxy() (the function reads
// process.env at call time, not import time).
// ============================================================

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

// ── File-level mocks (hoisted by vitest) for route handler tests ──
// These are safe: proxy, trading-policy, and other non-route code
// never call into these mocked modules during their tests.

vi.mock('@/lib/db', () => ({
  db: null,
  hasModel: () => false,
  dbAvailable: false,
  isDbAvailable: () => false,
  safeDbQuery: async () => undefined,
  ensureDemoUser: async () => null,
  DEMO_USER_ID: 'usr_demo_1',
}));

vi.mock('@/lib/get-user-id', () => ({
  getUserId: async () => 'test-user',
  getUserIdSync: () => 'test-user',
}));

vi.mock('@/lib/encryption', () => ({
  encrypt: async (v: string) => `encrypted:${v}`,
  decrypt: async (v: string) => v.replace('encrypted:', ''),
}));

vi.mock('@/lib/subscription-guard', () => ({
  checkSubscriptionLimit: async () => ({ allowed: true, current: 0, limit: 5 }),
  getLimitMessage: () => 'Limit reached',
}));

vi.mock('@/lib/system-config', () => ({
  getGlobalAdminLevy: async () => 0,
}));

vi.mock('@/lib/demo-sltp-store', () => ({
  loadDemoPositionSLTP: () => new Map(),
  saveDemoPositionSLTP: () => {},
}));

vi.mock('@/lib/broker/demo', () => ({
  getAssetType: (_symbol: string) => 'stock',
}));

vi.mock('@/lib/broker/factory', () => ({
  createBrokerFromAccount: async () => {
    throw new Error('BrokerFactory should not be reached when db is null');
  },
  createBroker: () => {
    throw new Error('BrokerFactory should not be reached when db is null');
  },
  BrokerFactoryError: class BrokerFactoryError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.name = 'BrokerFactoryError';
      this.code = code;
    }
  },
}));

// ── Top-level imports (load BEFORE any beforeAll sets env vars) ──
// This ensures trading-policy.ts captures INTERNAL_SERVICE_SECRET = ''.
import { proxy } from '@/proxy';
import {
  enforceInternalAuth,
  enforceLiveTradingPolicy,
  isExplicitlyDemo,
  CONTAINMENT_CODES,
  AUTOMATED_TRADING_ENABLED,
  LIVE_TRADING_ENABLED,
  BROKER_CREDENTIAL_INTAKE_ENABLED,
  safeAccountDTO,
  demoResponse,
} from '@/lib/trading-policy';

// ── Helper: create NextRequest objects ──
function makeReq(
  urlPath: string,
  method = 'GET',
  headers: Record<string, string> = {},
  body?: string,
) {
  const init: RequestInit = { method, headers: new Headers(headers) };
  if (body) init.body = body;
  return new NextRequest(`http://localhost:3000${urlPath}`, init);
}

// ================================================================
// 1–7: proxy.ts tests
// ================================================================
describe('proxy', () => {
  // Set INTERNAL_SERVICE_SECRET so proxy's INLINE check (which reads
  // process.env at call-time, not import-time) sees a configured secret.
  // This makes anonymous requests return 401 (wrong credential) rather
  // than 503 (secret not configured).
  // Note: trading-policy's const is already '' (captured at top-level import),
  // so enforceInternalAuth in its own describe block still returns 503.
  beforeAll(() => {
    process.env.INTERNAL_SERVICE_SECRET = 'test-secret-for-proxy';
  });
  afterAll(() => {
    delete process.env.INTERNAL_SERVICE_SECRET;
  });

  it('imports and executes the real proxy function', async () => {
    const res = await proxy(makeReq('/api/trading/market/symbols'));
    // NextResponse.next() does not set an explicit 200; verify it is NOT a rejection
    expect(res.status === 401 || res.status === 503).toBe(false);
  });

  it('repository has src/proxy.ts and no src/middleware.ts', () => {
    const srcDir = path.resolve(__dirname, '../../..');
    expect(fs.existsSync(path.join(srcDir, 'src', 'proxy.ts'))).toBe(true);
    expect(fs.existsSync(path.join(srcDir, 'src', 'middleware.ts'))).toBe(false);
  });

  it('anonymous GET to protected trading routes returns 401', async () => {
    const res = await proxy(makeReq('/api/trading/portfolio'));
    expect(res.status).toBe(401);
  });

  it('anonymous POST to protected trading routes returns 401', async () => {
    const res = await proxy(makeReq('/api/trading/orders', 'POST'));
    expect(res.status).toBe(401);
  });

  it('strips forged X-User-Id header', async () => {
    // The proxy strips x-user-id at Step 0, so the forged value never
    // influences auth. Without a valid JWT the request is rejected.
    const res = await proxy(
      makeReq('/api/trading/orders', 'GET', { 'x-user-id': 'attacker_123' }),
    );
    expect(res.status).toBe(401);
    // Also confirm the response body is a JSON auth error, not a next() passthrough
    const body = await res.json();
    expect(body.code).toBe('AUTH_REQUIRED');
  });

  it('X-Internal-Service: true without valid secret does not bypass auth', async () => {
    // x-internal-service is in IDENTITY_HEADERS_TO_STRIP and is removed
    // before any auth logic.  No JWT + wrong/missing secret → 401.
    const res = await proxy(
      makeReq('/api/trading/orders', 'GET', { 'x-internal-service': 'true' }),
    );
    expect(res.status).toBe(401);
  });

  it('allows public routes without auth', async () => {
    const res = await proxy(makeReq('/api/trading/market/symbols'));
    if (res.status === 401 || res.status === 503) {
      expect.unreachable('Public route should not require auth');
    }
    // Explicit guard: public paths must not be rejected
    expect([401, 503]).not.toContain(res.status);
  });
});

// ================================================================
// 8–9: Internal auth tests
// ================================================================
describe('internal auth', () => {
  // trading-policy.ts was imported at the TOP LEVEL, before the proxy
  // beforeAll set INTERNAL_SERVICE_SECRET.  So the module-level const
  // INTERNAL_SERVICE_SECRET is '' and enforceInternalAuth returns 503.

  it('engine/bots route rejects missing secret', () => {
    const req = new Request('http://localhost:3000/api/trading/engine/bots');
    const res = enforceInternalAuth(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(503);
 // eslint-disable-next-line @typescript-eslint/no-explicit-any
    res!.json().then((body: any) => {
      expect(body.code).toBe('INTERNAL_AUTH_REQUIRED');
    });
  });

  it('engine/report route rejects missing secret', () => {
    const req = new Request('http://localhost:3000/api/trading/engine/report', {
      method: 'POST',
    });
    const res = enforceInternalAuth(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(503);
 // eslint-disable-next-line @typescript-eslint/no-explicit-any
    res!.json().then((body: any) => {
      expect(body.code).toBe('INTERNAL_AUTH_REQUIRED');
    });
  });
});

// ================================================================
// 10–15: Live trading policy tests
// ================================================================
describe('live trading policy', () => {
  // LIVE_TRADING_ENABLED is false (captured at module-load time).

  it('manual live order route does not call broker while disabled', () => {
    const result = enforceLiveTradingPolicy(
      { broker: 'okx', accountType: 'live' },
      'order placement (buy 0.01 BTC)',
    );
    expect(result.blocked).toBe(true);
    if ('response' in result) {
      expect(result.response.status).toBe(403);
    }
  });

  it('live position close is blocked', () => {
    const result = enforceLiveTradingPolicy(
      { broker: 'okx', accountType: 'live' },
      'position close (BTC)',
    );
    expect(result.blocked).toBe(true);
    if ('response' in result) {
      expect(result.response.status).toBe(403);
    }
  });

  it('live order cancel is blocked', () => {
    const result = enforceLiveTradingPolicy(
      { broker: 'binance', accountType: 'live' },
      'order cancel (ETH ord_123)',
    );
    expect(result.blocked).toBe(true);
    if ('response' in result) {
      expect(result.response.status).toBe(403);
    }
  });

  it('live position-protection PATCH is rejected', () => {
    const liveAccount = { broker: 'okx', accountType: 'live' };
    // The PATCH handler checks isExplicitlyDemo directly, so verify that too
    expect(isExplicitlyDemo(liveAccount)).toBe(false);
    // Also verify enforceLiveTradingPolicy blocks the operation
    const result = enforceLiveTradingPolicy(liveAccount, 'position protection update');
    expect(result.blocked).toBe(true);
  });

  it('demo orders are allowed', () => {
    const result = enforceLiveTradingPolicy(
      { broker: 'demo', accountType: 'demo' },
      'order placement (buy 1 AAPL)',
    );
    expect(result.blocked).toBe(false);
  });

  it('null account fails closed', async () => {
    const result = enforceLiveTradingPolicy(null, 'order');
    expect(result.blocked).toBe(true);
    if ('response' in result) {
      expect(result.response.status).toBe(403);
      const body = JSON.parse(await result.response.text());
      expect(body.code).toBe(CONTAINMENT_CODES.CONFIGURATION_REQUIRED);
    }
  });
});

// ================================================================
// 16–19: Error handling / DB failure tests
// ================================================================
describe('error handling', () => {
  it('webhook route returns disabled response', async () => {
    const { POST } = await import('@/app/api/trading/webhook/route');
    const req = makeReq(
      '/api/trading/webhook',
      'POST',
      { 'content-type': 'application/json' },
      JSON.stringify({ symbol: 'BTC', side: 'buy' }),
    );
    const res = await POST(req as Parameters<typeof POST>[0]);
    // Webhook ingress is disabled during containment — must return 503
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe('WEBHOOK_INGRESS_DISABLED');
    expect(body.remediationPhase).toBe('containment');
  });

  it('portfolio DB failure returns non-2xx', async () => {
    const { GET } = await import('@/app/api/trading/portfolio/route');
    const req = makeReq('/api/trading/portfolio');
    const res = await GET(req as Parameters<typeof GET>[0]);
    // db is null → must return 503, never a fake $100k balance
    expect(res.status).toBe(503);
  });

  it('position DB failure returns non-2xx', async () => {
    const { GET } = await import('@/app/api/trading/positions/route');
    const req = makeReq('/api/trading/positions');
    const res = await GET(req as Parameters<typeof GET>[0]);
    // db is null → must return 503, not demo positions
    expect(res.status).toBe(503);
  });

  it('account GET DB failure returns non-2xx', async () => {
    const { GET } = await import('@/app/api/trading/accounts/route');
    const req = makeReq('/api/trading/accounts');
    const res = await GET(req as Parameters<typeof GET>[0]);
    // db is null → must return 503 (checked before getUserId is awaited)
    expect(res.status).toBe(503);
  });
});

// ================================================================
// 20: Safe account DTO
// ================================================================
describe('safe account DTO', () => {
  it('account responses contain no credential fields', () => {
    const input: Record<string, unknown> = {
      id: 'acc_1',
      broker: 'okx',
      accountType: 'live',
      balance: 50000,
      apiKey: 'sk-live-secret-key',
      apiSecret: 'sk-live-secret-value',
      passphrase: 'my-broker-pass',
      isActive: true,
    };
    const dto = safeAccountDTO(input);
    // Credentials must be stripped
    expect(dto).not.toHaveProperty('apiKey');
    expect(dto).not.toHaveProperty('apiSecret');
    expect(dto).not.toHaveProperty('passphrase');
    // Non-credential fields must remain
    expect(dto).toHaveProperty('id', 'acc_1');
    expect(dto).toHaveProperty('broker', 'okx');
    expect(dto).toHaveProperty('balance', 50000);
    expect(dto).toHaveProperty('isActive', true);
  });
});

// ================================================================
// 21: Demo provenance
// ================================================================
describe('demo provenance', () => {
  it('demo responses contain complete provenance', async () => {
    const res = demoResponse({ data: { foo: 'bar' } });
    const body = await res.json();
    // Body-level provenance fields
    expect(body.environment).toBe('demo');
    expect(body.isSynthetic).toBe(true);
    expect(body.source).toBe('fovi-demo-generator');
    // Header-level provenance markers
    expect(res.headers.get('x-environment')).toBe('demo');
    expect(res.headers.get('x-synthetic')).toBe('true');
    expect(res.headers.get('x-data-source')).toBe('fovi-demo-generator');
    expect(res.headers.get('x-demo')).toBe('true');
  });
});

// ================================================================
// 22–24: Environment defaults
// ================================================================
describe('environment defaults', () => {
  it('AUTOMATED_TRADING_ENABLED defaults to false', () => {
    expect(AUTOMATED_TRADING_ENABLED).toBe(false);
  });

  it('LIVE_TRADING_ENABLED defaults to false', () => {
    expect(LIVE_TRADING_ENABLED).toBe(false);
  });

  it('BROKER_CREDENTIAL_INTAKE_ENABLED defaults to false', () => {
    expect(BROKER_CREDENTIAL_INTAKE_ENABLED).toBe(false);
  });
});

// ================================================================
// 25: Caddyfile
// ================================================================
describe('Caddyfile', () => {
  it('Caddyfile has no XTransformPort', () => {
    const caddyfile = fs.readFileSync(
      path.resolve(__dirname, '../../../Caddyfile'),
      'utf-8',
    );
    // Filter out comment lines (lines starting with #)
    const nonCommentLines = caddyfile
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'));
    const content = nonCommentLines.join('\n');
    // Must not contain the old vulnerable query-param routing
    expect(content).not.toContain('XTransformPort');
    expect(content).not.toContain('{query.');
  });
});

// ================================================================
// 20.5–20.6: Mini-service localhost binding
// ================================================================
describe('mini-service network binding', () => {
  it('auto-trade-engine binds to 127.0.0.1', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../../mini-services/auto-trade-engine/index.ts'),
      'utf-8',
    );
    expect(src).toContain("hostname: '127.0.0.1'");
  });

  it('balance-sync binds to 127.0.0.1', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../../mini-services/balance-sync/index.ts'),
      'utf-8',
    );
    expect(src).toContain("hostname: '127.0.0.1'");
  });
});
