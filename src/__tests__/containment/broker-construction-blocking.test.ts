// ============================================================
// Broker Construction Blocking Tests (Task 10b-1)
// Spy on decrypt, createBrokerFromAccount, broker methods.
// Prove that for non-demo/unknown/ambiguous accounts:
//   - decrypt is never called
//   - createBrokerFromAccount may be called but throws
//   - getPositions / getAccountInfo are never called
// Positive control: demo accounts → spies ARE called.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const ORIGINAL_ENV = process.env;

// ── Spies on encryption and broker methods ──
const decryptSpy = vi.fn().mockResolvedValue('decrypted');
const getPositionsSpy = vi.fn().mockResolvedValue([]);
const getAccountInfoSpy = vi.fn().mockResolvedValue({
  accountId: 'x', balance: 10000, currency: 'USD', buyingPower: 10000, dayPnl: 0,
});

vi.mock('@/lib/encryption', () => ({
  encrypt: (v: string) => Promise.resolve('enc:' + v),
  decrypt: decryptSpy,
}));

vi.mock('@/lib/broker/factory', () => ({
  createBrokerFromAccount: vi.fn().mockResolvedValue({
    getPositions: getPositionsSpy,
    getAccountInfo: getAccountInfoSpy,
    placeOrder: vi.fn(),
    closePosition: vi.fn(),
    cancelOrder: vi.fn(),
    getCandles: vi.fn().mockResolvedValue([]),
    getPrice: vi.fn().mockResolvedValue(50000),
  }),
  createBroker: vi.fn(),
  BrokerFactoryError: class extends Error {
    code: string;
    constructor(c: string, m: string) { super(m); this.code = c; this.name = 'BrokerFactoryError'; }
  },
}));

// ── Mock DB ──
const mockFindFirst = vi.fn();
const mockFindMany = vi.fn();
const mockUpdate = vi.fn();
const mockCreate = vi.fn();

vi.mock('@/lib/db', () => ({
  db: {
    tradingAccount: { findFirst: mockFindFirst, findMany: mockFindMany, update: mockUpdate },
    position: { findFirst: mockFindFirst, findMany: mockFindMany, update: mockUpdate, create: mockCreate },
    tradingSignal: { count: vi.fn().mockResolvedValue(0) },
  },
  hasModel: (m: string) => ['tradingAccount', 'position', 'tradingSignal'].includes(m),
}));

vi.mock('@/lib/demo-sltp-store', () => ({
  loadDemoPositionSLTP: () => new Map(),
}));

vi.mock('uuid', () => ({
  v4: () => 'test-uuid-00000000-0000-4000-8000-000000000000',
}));

// ── Helpers ──
function authedReq(url: string) {
  return new NextRequest(new URL(url), { headers: { 'x-user-id': 'user_A' } });
}

// ── Account fixtures ──
const LIVE_ACCOUNT = {
  id: 'acc_live_1', userId: 'user_A', broker: 'okx', accountType: 'live',
  isDemo: false, apiKey: 'enc:key', apiSecret: 'enc:secret', passphrase: null,
  accountId: 'okx-1', balance: 50000, currency: 'USD',
};

const DEMO_ACCOUNT = {
  id: 'acc_demo_1', userId: 'user_A', broker: 'demo', accountType: 'demo',
  isDemo: true, apiKey: null, apiSecret: null, passphrase: null,
  accountId: null, balance: 100000, currency: 'USD',
};

const AMBIGUOUS_ACCOUNT = {
  id: 'acc_amb_1', userId: 'user_A', broker: 'demo', accountType: 'live',
  isDemo: null, apiKey: null, apiSecret: null, passphrase: null,
  accountId: null, balance: 5000, currency: 'USD',
};

const UNKNOWN_ACCOUNT = {
  id: 'acc_unk_1', userId: 'user_A', broker: 'alpaca', accountType: 'live',
  isDemo: false, apiKey: 'enc:k', apiSecret: 'enc:s', passphrase: null,
  accountId: 'alp-1', balance: 20000, currency: 'USD',
};

// ================================================================
// GET /api/trading/positions
// ================================================================
describe('broker construction blocking — positions GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    process.env.LIVE_TRADING_ENABLED = 'true';
  });
  afterEach(() => { process.env = ORIGINAL_ENV; });

  it('non-demo account → 403 PHASE1_LIVE_TRADING_DISABLED, decrypt never called', async () => {
    mockFindFirst.mockResolvedValue(LIVE_ACCOUNT);

    const { GET } = await import('@/app/api/trading/positions/route');
    const res = await GET(authedReq('http://localhost/api/trading/positions'));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('PHASE1_LIVE_TRADING_DISABLED');

    // Critical: decrypt was NEVER called — credentials not exposed
    expect(decryptSpy).not.toHaveBeenCalled();
    // getPositions was NEVER called — no broker network activity
    expect(getPositionsSpy).not.toHaveBeenCalled();
  });

  it('ambiguous account (demo/live conflict) → 403, no decrypt', async () => {
    mockFindFirst.mockResolvedValue(AMBIGUOUS_ACCOUNT);

    const { GET } = await import('@/app/api/trading/positions/route');
    const res = await GET(authedReq('http://localhost/api/trading/positions'));

    expect(res.status).toBe(403);
    expect(decryptSpy).not.toHaveBeenCalled();
    expect(getPositionsSpy).not.toHaveBeenCalled();
  });

  it('unknown broker account → 403, no decrypt', async () => {
    mockFindFirst.mockResolvedValue(UNKNOWN_ACCOUNT);

    const { GET } = await import('@/app/api/trading/positions/route');
    const res = await GET(authedReq('http://localhost/api/trading/positions'));

    expect(res.status).toBe(403);
    expect(decryptSpy).not.toHaveBeenCalled();
    expect(getPositionsSpy).not.toHaveBeenCalled();
  });

  it('POSITIVE CONTROL: demo account (isDemo=true) → spies ARE called', async () => {
    mockFindFirst.mockResolvedValue(DEMO_ACCOUNT);
    getPositionsSpy.mockResolvedValue([
      { symbol: 'BTC', qty: 0.1, avgEntryPrice: 65000, currentPrice: 67000, unrealizedPnl: 200, side: 'long' as const },
    ]);
    mockFindMany.mockResolvedValue([]);

    const { GET } = await import('@/app/api/trading/positions/route');
    const res = await GET(authedReq('http://localhost/api/trading/positions'));

    // Demo accounts pass through — 200 OK
    expect(res.status).toBe(200);

    // Spies WERE called — broker was actually constructed for demo
    expect(getPositionsSpy).toHaveBeenCalled();
  });
});

// ================================================================
// GET /api/trading/portfolio
// ================================================================
describe('broker construction blocking — portfolio GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    process.env.LIVE_TRADING_ENABLED = 'true';
  });
  afterEach(() => { process.env = ORIGINAL_ENV; });

  it('non-demo account → 403, decrypt/getAccountInfo never called', async () => {
    mockFindFirst.mockResolvedValue(LIVE_ACCOUNT);

    const { GET } = await import('@/app/api/trading/portfolio/route');
    const res = await GET(authedReq('http://localhost/api/trading/portfolio'));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('PHASE1_LIVE_TRADING_DISABLED');

    expect(decryptSpy).not.toHaveBeenCalled();
    expect(getAccountInfoSpy).not.toHaveBeenCalled();
    expect(getPositionsSpy).not.toHaveBeenCalled();
  });

  it('ambiguous account → 403, no decrypt', async () => {
    mockFindFirst.mockResolvedValue(AMBIGUOUS_ACCOUNT);

    const { GET } = await import('@/app/api/trading/portfolio/route');
    const res = await GET(authedReq('http://localhost/api/trading/portfolio'));

    expect(res.status).toBe(403);
    expect(decryptSpy).not.toHaveBeenCalled();
    expect(getAccountInfoSpy).not.toHaveBeenCalled();
  });

  it('POSITIVE CONTROL: demo account → getAccountInfo and getPositions ARE called', async () => {
    mockFindFirst.mockResolvedValue(DEMO_ACCOUNT);
    mockFindMany.mockResolvedValue([]);

    const { GET } = await import('@/app/api/trading/portfolio/route');
    const res = await GET(authedReq('http://localhost/api/trading/portfolio'));

    expect(res.status).toBe(200);
    expect(getAccountInfoSpy).toHaveBeenCalled();
    expect(getPositionsSpy).toHaveBeenCalled();
  });

  it('blocks with all env flags set to true — env vars cannot override', async () => {
    process.env.LIVE_TRADING_ENABLED = 'true';
    process.env.BROKER_CREDENTIAL_INTAKE_ENABLED = 'true';
    process.env.AUTOMATED_TRADING_ENABLED = 'true';
    mockFindFirst.mockResolvedValue(LIVE_ACCOUNT);

    const { GET } = await import('@/app/api/trading/portfolio/route');
    const res = await GET(authedReq('http://localhost/api/trading/portfolio'));

    expect(res.status).toBe(403);
    expect(decryptSpy).not.toHaveBeenCalled();
  });
});
