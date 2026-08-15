import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  enforceLiveTradingPolicy,
  isExplicitlyDemo,
  timingSafeEqual,
  safeAccountDTO,
  safeAccountDTOs,
  CONTAINMENT_CODES,
  LIVE_TRADING_ENABLED,
  BROKER_CREDENTIAL_INTAKE_ENABLED,
} from '@/lib/trading-policy';

// ─────────────────────────────────────────────────────
// 1. Live manual orders are blocked
// ─────────────────────────────────────────────────────
describe('enforceLiveTradingPolicy', () => {
  const liveAccount = { broker: 'okx', accountType: 'live' };
  const demoAccount = { broker: 'demo', accountType: 'demo' };

  it('blocks live account order when LIVE_TRADING_ENABLED=false', async () => {
    // LIVE_TRADING_ENABLED is read from env at module load time;
    // in test env it defaults to false.
    const result = enforceLiveTradingPolicy(liveAccount, 'order placement');
    expect(result.blocked).toBe(true);
    if (result.blocked) {
      expect(result.response.status).toBe(403);
      // Clone the response to read its body
      const cloned = result.response.clone();
      const body = await cloned.json();
      expect(body.code).toBe(CONTAINMENT_CODES.LIVE_BLOCKED);
      expect(body.correlationId).toBeDefined();
      expect(body.remediationPhase).toBe('containment');
      // No secrets in response
      expect(JSON.stringify(body)).not.toContain('apiKey');
      expect(JSON.stringify(body)).not.toContain('apiSecret');
    }
  });

  it('allows demo account orders', () => {
    const result = enforceLiveTradingPolicy(demoAccount, 'order placement');
    expect(result.blocked).toBe(false);
  });

  it('allows null account (will fail downstream)', () => {
    const result = enforceLiveTradingPolicy(null, 'order placement');
    expect(result.blocked).toBe(false);
  });

  it('allows undefined account', () => {
    const result = enforceLiveTradingPolicy(undefined, 'order placement');
    expect(result.blocked).toBe(false);
  });
});

// ─────────────────────────────────────────────────────
// 5. Demo accounts operate only in explicit demo mode
// ─────────────────────────────────────────────────────
describe('isExplicitlyDemo', () => {
  it('returns true only when broker=demo AND accountType=demo', () => {
    expect(isExplicitlyDemo({ broker: 'demo', accountType: 'demo' })).toBe(true);
    expect(isExplicitlyDemo({ broker: 'okx', accountType: 'demo' })).toBe(false);
    expect(isExplicitlyDemo({ broker: 'demo', accountType: 'live' })).toBe(false);
    expect(isExplicitlyDemo({ broker: 'okx', accountType: 'live' })).toBe(false);
  });
});

// ─────────────────────────────────────────────────────
// timingSafeEqual
// ─────────────────────────────────────────────────────
describe('timingSafeEqual', () => {
  it('returns true for equal strings', async () => {
    const result = await timingSafeEqual('secret123', 'secret123');
    expect(result).toBe(true);
  });

  it('returns false for different strings', async () => {
    const result = await timingSafeEqual('secret123', 'secret124');
    expect(result).toBe(false);
  });

  it('returns false for different-length strings', async () => {
    const result = await timingSafeEqual('secret', 'secret123');
    expect(result).toBe(false);
  });

  it('returns true for empty strings', async () => {
    const result = await timingSafeEqual('', '');
    expect(result).toBe(true);
  });

  it('returns false for empty vs non-empty', async () => {
    const result = await timingSafeEqual('a', '');
    expect(result).toBe(false);
  });
});

// ─────────────────────────────────────────────────────
// 13. Credential fields never appear in account DTOs
// ─────────────────────────────────────────────────────
describe('safeAccountDTO', () => {
  it('strips apiKey, apiSecret, passphrase', () => {
    const account = {
      id: 'acc_1',
      broker: 'okx',
      apiKey: 'encrypted_key_abc',
      apiSecret: 'encrypted_secret_xyz',
      passphrase: 'encrypted_pass_123',
      balance: 1000,
    };
    const dto = safeAccountDTO(account);
    expect(dto.apiKey).toBeUndefined();
    expect(dto.apiSecret).toBeUndefined();
    expect(dto.passphrase).toBeUndefined();
    expect(dto.id).toBe('acc_1');
    expect(dto.broker).toBe('okx');
    expect(dto.balance).toBe(1000);
  });

  it('works on arrays', () => {
    const accounts = [
      { id: 'a1', apiKey: 'key1', apiSecret: 'sec1' },
      { id: 'a2', apiKey: 'key2', passphrase: 'pass2' },
    ];
    const dtos = safeAccountDTOs(accounts);
    expect(dtos).toHaveLength(2);
    for (const dto of dtos) {
      expect(dto.apiKey).toBeUndefined();
      expect(dto.apiSecret).toBeUndefined();
      expect(dto.passphrase).toBeUndefined();
    }
  });
});

// ─────────────────────────────────────────────────────
// Environment variable defaults
// ─────────────────────────────────────────────────────
describe('Environment defaults', () => {
  it('LIVE_TRADING_ENABLED defaults to false', () => {
    expect(LIVE_TRADING_ENABLED).toBe(false);
  });

  it('BROKER_CREDENTIAL_INTAKE_ENABLED defaults to false', () => {
    expect(BROKER_CREDENTIAL_INTAKE_ENABLED).toBe(false);
  });
});
