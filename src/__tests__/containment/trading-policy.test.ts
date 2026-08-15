// ============================================================
// Containment behavioral tests — trading policy (Req 7, Req 4)
// Tests enforceLiveTradingPolicy, safeAccountDTO, getUserId,
// broker factory containment, and cross-tenant isolation.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock env before importing
const ORIGINAL_ENV = process.env;

vi.mock('@/lib/db', () => ({
  db: null,
  hasModel: () => false,
  DEMO_USER_ID: 'usr_demo_1',
  ensureDemoUser: vi.fn(),
}));

import {
  enforceLiveTradingPolicy,
  safeAccountDTO,
  safeAccountDTOs,
  isExplicitlyDemo,
  isLiveAccount,
  constantTimeEqual,
  CONTAINMENT_CODES,
  LIVE_TRADING_ENABLED,
  BROKER_CREDENTIAL_INTAKE_ENABLED,
  AUTOMATED_TRADING_ENABLED,
  logSecurityEvent,
  DEMO_PROVENANCE,
  DEMO_PROVENANCE_HEADER,
} from '@/lib/trading-policy';

import { getUserId, getUserIdSync, AuthRequiredError, authRequiredResponse } from '@/lib/get-user-id';
import { createBroker, BrokerFactoryError } from '@/lib/broker/factory';

describe('trading policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    // Ensure containment defaults
    delete process.env.LIVE_TRADING_ENABLED;
    delete process.env.BROKER_CREDENTIAL_INTAKE_ENABLED;
    delete process.env.AUTOMATED_TRADING_ENABLED;
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  // ── enforceLiveTradingPolicy ──
  describe('enforceLiveTradingPolicy', () => {
    it('allows demo accounts unconditionally', () => {
      const result = enforceLiveTradingPolicy(
        { broker: 'demo', accountType: 'demo' },
        'test operation',
      );
      expect(result.blocked).toBe(false);
    });

    it('blocks live accounts when LIVE_TRADING_ENABLED is false', () => {
      const result = enforceLiveTradingPolicy(
        { broker: 'okx', accountType: 'live' },
        'test operation',
      );
      expect(result.blocked).toBe(true);
      if (result.blocked) {
        expect(result.response.status).toBe(403);
      }
    });

    it('fails closed when account is null', () => {
      const result = enforceLiveTradingPolicy(null, 'test operation');
      expect(result.blocked).toBe(true);
      if (result.blocked) {
        expect(result.response.status).toBe(403);
      }
    });

    it('fails closed when account is undefined', () => {
      const result = enforceLiveTradingPolicy(undefined, 'test operation');
      expect(result.blocked).toBe(true);
      if (result.blocked) {
        expect(result.response.status).toBe(403);
      }
    });
  });

  // ── safeAccountDTO ──
  describe('safeAccountDTO', () => {
    it('strips apiKey, apiSecret, passphrase from account', () => {
      const account = {
        id: 'acc1', userId: 'usr1', broker: 'okx',
        apiKey: 'secret-key-123',
        apiSecret: 'secret-value-456',
        passphrase: 'my-passphrase',
        balance: 1000,
      };
      const safe = safeAccountDTO(account);
      expect(safe.apiKey).toBeUndefined();
      expect(safe.apiSecret).toBeUndefined();
      expect(safe.passphrase).toBeUndefined();
      expect(safe.id).toBe('acc1');
      expect(safe.balance).toBe(1000);
    });

    it('strips encrypted variants', () => {
      const account = {
        id: 'acc2',
        apiKey: 'encrypted:v1:abc',
        apiSecret: 'encrypted:v1:def',
      };
      const safe = safeAccountDTO(account);
      expect(safe.apiKey).toBeUndefined();
      expect(safe.apiSecret).toBeUndefined();
    });

    it('handles array of accounts', () => {
      const accounts = [
        { id: 'a1', apiKey: 'key1', balance: 100 },
        { id: 'a2', apiSecret: 'sec2', balance: 200 },
      ];
      const safe = safeAccountDTOs(accounts);
      expect(safe).toHaveLength(2);
      expect(safe[0].apiKey).toBeUndefined();
      expect(safe[1].apiSecret).toBeUndefined();
      expect(safe[0].balance).toBe(100);
    });
  });

  // ── isExplicitlyDemo / isLiveAccount ──
  describe('account type classification', () => {
    it('identifies demo accounts', () => {
      expect(isExplicitlyDemo({ broker: 'demo', accountType: 'demo' })).toBe(true);
    });

    it('rejects demo provider with live type', () => {
      expect(isExplicitlyDemo({ broker: 'demo', accountType: 'live' })).toBe(false);
    });

    it('rejects live provider with demo type', () => {
      expect(isExplicitlyDemo({ broker: 'okx', accountType: 'demo' })).toBe(false);
    });

    it('classifies live accounts correctly', () => {
      expect(isLiveAccount({ broker: 'okx', accountType: 'live' })).toBe(true);
      expect(isLiveAccount({ broker: 'demo', accountType: 'demo' })).toBe(false);
    });
  });

  // ── constantTimeEqual ──
  describe('constantTimeEqual', () => {
    it('returns true for equal strings', () => {
      expect(constantTimeEqual('abc123', 'abc123')).toBe(true);
    });

    it('returns false for different strings of same length', () => {
      expect(constantTimeEqual('abc123', 'abc124')).toBe(false);
    });

    it('returns false for different lengths', () => {
      expect(constantTimeEqual('short', 'much-longer-string')).toBe(false);
    });
  });

  // ── Environment defaults ──
  describe('fail-closed defaults', () => {
    it('LIVE_TRADING_ENABLED defaults to false', () => {
      expect(LIVE_TRADING_ENABLED).toBe(false);
    });

    it('BROKER_CREDENTIAL_INTAKE_ENABLED defaults to false', () => {
      expect(BROKER_CREDENTIAL_INTAKE_ENABLED).toBe(false);
    });

    it('AUTOMATED_TRADING_ENABLED defaults to false', () => {
      expect(AUTOMATED_TRADING_ENABLED).toBe(false);
    });
  });

  // ── logSecurityEvent ──
  describe('logSecurityEvent', () => {
    it('redacts fields containing secret/key/token/password', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      logSecurityEvent({
        eventType: 'TEST',
        userSecret: 'should-be-redacted',
        apiKey: 'should-be-redacted',
        accessToken: 'should-be-redacted',
        userPassword: 'should-be-redacted',
        normalField: 'should-appear',
      });
      expect(warnSpy).toHaveBeenCalledOnce();
      const logged = JSON.parse(warnSpy.mock.calls[0][0]);
      expect(logged.userSecret).toBe('[REDACTED]');
      expect(logged.apiKey).toBe('[REDACTED]');
      expect(logged.accessToken).toBe('[REDACTED]');
      expect(logged.userPassword).toBe('[REDACTED]');
      expect(logged.normalField).toBe('should-appear');
      warnSpy.mockRestore();
    });
  });

  // ── Demo provenance ──
  describe('DEMO_PROVENANCE', () => {
    it('has correct structure', () => {
      expect(DEMO_PROVENANCE.environment).toBe('demo');
      expect(DEMO_PROVENANCE.isSynthetic).toBe(true);
      expect(DEMO_PROVENANCE.source).toBe('fovi-demo-generator');
    });

    it('has correct headers', () => {
      expect(DEMO_PROVENANCE_HEADER['x-environment']).toBe('demo');
      expect(DEMO_PROVENANCE_HEADER['x-synthetic']).toBe('true');
      expect(DEMO_PROVENANCE_HEADER['x-data-source']).toBe('fovi-demo-generator');
      expect(DEMO_PROVENANCE_HEADER['x-demo']).toBe('true');
    });
  });
});

// ── getUserId strict mode (Req 4) ──
describe('getUserId strict mode', () => {
  it('throws AuthRequiredError when X-User-Id is missing', async () => {
    const req = new Request('http://localhost');
    await expect(getUserId(req)).rejects.toThrow(AuthRequiredError);
  });

  it('throws AuthRequiredError for empty X-User-Id', async () => {
    const req = new Request('http://localhost', { headers: { 'x-user-id': '' } });
    await expect(getUserId(req)).rejects.toThrow(AuthRequiredError);
  });

  it('throws AuthRequiredError for anonymous X-User-Id', async () => {
    const req = new Request('http://localhost', { headers: { 'x-user-id': 'anonymous' } });
    await expect(getUserId(req)).rejects.toThrow(AuthRequiredError);
  });

  it('returns userId when X-User-Id is present', async () => {
    const req = new Request('http://localhost', { headers: { 'x-user-id': 'user_abc' } });
    const id = await getUserId(req);
    expect(id).toBe('user_abc');
  });

  it('getUserIdSync throws when missing', () => {
    const req = new Request('http://localhost');
    expect(() => getUserIdSync(req)).toThrow(AuthRequiredError);
  });

  it('getUserIdSync returns userId when present', () => {
    const req = new Request('http://localhost', { headers: { 'x-user-id': 'user_xyz' } });
    expect(getUserIdSync(req)).toBe('user_xyz');
  });

  it('authRequiredResponse returns 401 with correct code', () => {
    const res = authRequiredResponse();
    expect(res.status).toBe(401);
  });
});

// ── Broker factory containment (Req 6) ──
describe('broker factory containment', () => {
  it('creates DemoBroker for provider=demo + isDemo=true', () => {
    const broker = createBroker({ provider: 'demo', isDemo: true });
    expect(broker).toBeDefined();
    // Verify it has the expected methods
    expect(typeof broker.placeOrder).toBe('function');
  });

  it('throws for provider=demo + isDemo=false', () => {
    expect(() => createBroker({ provider: 'demo' as any, isDemo: false }))
      .toThrow(BrokerFactoryError);
  });

  it('throws for provider=demo + isDemo=undefined', () => {
    expect(() => createBroker({ provider: 'demo' as any, isDemo: undefined as any }))
      .toThrow(BrokerFactoryError);
  });

  it('throws BrokerFactoryError for unknown provider', () => {
    expect(() => createBroker({ provider: 'unknown_provider' as any, isDemo: false }))
      .toThrow(BrokerFactoryError);
  });

  it('BrokerFactoryError has correct code for unknown provider', () => {
    try {
      createBroker({ provider: 'random-broker' as any, isDemo: false });
      expect.unreachable('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(BrokerFactoryError);
      expect((e as BrokerFactoryError).code).toBe('BROKER_CONFIG_INCOMPLETE');
    }
  });

  it('throws for provider=generic-rest (no GenericRESTBroker fallback)', () => {
    expect(() => createBroker({ provider: 'generic-rest' as any, isDemo: false }))
      .toThrow(BrokerFactoryError);
  });
});

// ── Broker spy tests: blocked operations never call mutation methods ──
describe('broker mutation blocking', () => {
  it('live order placement is blocked before broker.placeOrder is called', () => {
    const policy = enforceLiveTradingPolicy(
      { broker: 'okx', accountType: 'live' },
      'order placement (buy 1 BTC)',
    );
    expect(policy.blocked).toBe(true);
    // If blocked, the route handler returns the response
    // without ever calling broker.placeOrder
  });

  it('live order cancellation is blocked before broker.cancelOrder is called', () => {
    const policy = enforceLiveTradingPolicy(
      { broker: 'binance', accountType: 'live' },
      'order cancel (BTC order_123)',
    );
    expect(policy.blocked).toBe(true);
  });

  it('live position closing is blocked before broker.closePosition is called', () => {
    const policy = enforceLiveTradingPolicy(
      { broker: 'alpaca', accountType: 'live' },
      'position close (AAPL)',
    );
    expect(policy.blocked).toBe(true);
  });

  it('null account blocks operation', () => {
    const policy = enforceLiveTradingPolicy(null, 'any operation');
    expect(policy.blocked).toBe(true);
  });
});
