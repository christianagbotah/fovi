// ============================================================
// Phase 1 Unconditional Demo Tests (Req 3)
// Verify that setting all env vars to true does NOT
// bypass Phase 1 containment.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ORIGINAL_ENV = process.env;

vi.mock('@/lib/db', () => ({
  db: null,
  hasModel: () => false,
}));

vi.mock('@/lib/broker/factory', () => ({
  createBrokerFromAccount: vi.fn().mockResolvedValue({
    placeOrder: vi.fn(),
    cancelOrder: vi.fn(),
    closePosition: vi.fn(),
    getPositions: () => Promise.resolve([]),
    getAccountInfo: () => Promise.resolve({ accountId: 'x', balance: 10000, currency: 'USD', buyingPower: 10000, dayPnl: 0 }),
  }),
  BrokerFactoryError: class extends Error { code: string; constructor(c: string, m: string) { super(m); this.code = c; } },
}));

vi.mock('@/lib/subscription-guard', () => ({
  checkSubscriptionLimit: () => ({ allowed: true, current: 0, limit: 10 }),
  getLimitMessage: () => 'Limit exceeded',
}));

describe('Phase 1 unconditional containment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    // Set ALL flags to true
    process.env.LIVE_TRADING_ENABLED = 'true';
    process.env.BROKER_CREDENTIAL_INTAKE_ENABLED = 'true';
    process.env.AUTOMATED_TRADING_ENABLED = 'true';
  });

  afterEach(() => { process.env = ORIGINAL_ENV; });

  it('enforceLiveTradingPolicy blocks live even with all env vars true', async () => {
    const { enforceLiveTradingPolicy } = await import('@/lib/trading-policy');
    const result = enforceLiveTradingPolicy(
      { broker: 'okx', accountType: 'live' },
      'test operation',
    );
    expect(result.blocked).toBe(true);
    if (result.blocked) {
      expect(result.response.status).toBe(403);
      const body = await result.response.json();
      expect(body.code).toBe('PHASE1_LIVE_TRADING_DISABLED');
    }
  });

  it('enforcePhase1CredentialIntake blocks non-demo even with BROKER_CREDENTIAL_INTAKE_ENABLED=true', async () => {
    const { enforcePhase1CredentialIntake } = await import('@/lib/trading-policy');
    const result = enforcePhase1CredentialIntake('binance', 'live');
    expect(result.blocked).toBe(true);
    if (result.blocked) {
      expect(result.response.status).toBe(403);
    }
  });

  it('still allows explicitly demo accounts', async () => {
    const { enforceLiveTradingPolicy } = await import('@/lib/trading-policy');
    const result = enforceLiveTradingPolicy(
      { broker: 'demo', accountType: 'demo', isDemo: true },
      'test operation',
    );
    expect(result.blocked).toBe(false);
  });
});
