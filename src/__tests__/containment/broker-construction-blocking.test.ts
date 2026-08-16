// ============================================================
// broker-construction-blocking.test.ts — CR4.1
// Tests the REAL createBroker() and createBrokerFromAccount() from factory.ts.
// These are pure synchronous functions — no mocking of the factory itself.
// We invoke the real factory and assert it either returns a DemoBroker
// or throws BrokerFactoryError with PHASE1_LIVE_TRADING_DISABLED.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { BrokerConfig } from '@/lib/types';
import {
  createBroker,
  createBrokerFromAccount,
  BrokerFactoryError,
} from '@/lib/broker/factory';
import { DemoBroker } from '@/lib/broker/demo';
import { CONTAINMENT_CODES } from '@/lib/trading-policy';

describe('createBroker — Phase 1 containment', () => {
  const PHASE1_CODE = CONTAINMENT_CODES.PHASE1_LIVE_TRADING_DISABLED;

  // ── Positive control: demo+isDemo=true → returns DemoBroker ──
  it('provider=demo, isDemo=true → returns DemoBroker instance', () => {
    const broker = createBroker({ provider: 'demo', isDemo: true });
    expect(broker).toBeInstanceOf(DemoBroker);
  });

  // ── Fail closed: demo with isDemo=false ──
  it('provider=demo, isDemo=false → throws PHASE1_LIVE_TRADING_DISABLED', () => {
    expect(() => createBroker({ provider: 'demo', isDemo: false }))
      .toThrow(BrokerFactoryError);
    try {
      createBroker({ provider: 'demo', isDemo: false });
    } catch (e) {
      expect(e).toBeInstanceOf(BrokerFactoryError);
      expect((e as BrokerFactoryError).code).toBe(PHASE1_CODE);
    }
  });

  // ── Fail closed: demo with isDemo=undefined ──
  it('provider=demo, isDemo=undefined → throws PHASE1_LIVE_TRADING_DISABLED', () => {
    // @ts-expect-error — intentionally missing required isDemo to test fail-closed behavior
    expect(() => createBroker({ provider: 'demo' }))
      .toThrow(BrokerFactoryError);
    try {
      // @ts-expect-error — intentionally missing required isDemo to test fail-closed behavior
      createBroker({ provider: 'demo' });
    } catch (e) {
      expect((e as BrokerFactoryError).code).toBe(PHASE1_CODE);
    }
  });

  // ── Fail closed: all non-demo providers ──
  const blockedProviders = ['alpaca', 'binance', 'okx', 'bybit', 'bitget', 'mt5', 'generic-rest', 'unknown'];
  for (const provider of blockedProviders) {
    it(`provider=${provider} → throws PHASE1_LIVE_TRADING_DISABLED (no adapter constructed)`, () => {
      const cfg = { provider } as unknown as BrokerConfig;
      expect(() => createBroker(cfg))
        .toThrow(BrokerFactoryError);
      try {
        createBroker(cfg);
      } catch (e) {
        expect(e).toBeInstanceOf(BrokerFactoryError);
        expect((e as BrokerFactoryError).code).toBe(PHASE1_CODE);
      }
    });
  }

  // ── Fail closed: non-demo provider even with isDemo=true ──
  it('provider=alpaca, isDemo=true → throws PHASE1_LIVE_TRADING_DISABLED', () => {
    expect(() => createBroker({ provider: 'alpaca', isDemo: true }))
      .toThrow(BrokerFactoryError);
    try {
      createBroker({ provider: 'alpaca', isDemo: true });
    } catch (e) {
      expect((e as BrokerFactoryError).code).toBe(PHASE1_CODE);
    }
  });
});

describe('createBrokerFromAccount — Phase 1 containment', () => {
  const PHASE1_CODE = CONTAINMENT_CODES.PHASE1_LIVE_TRADING_DISABLED;

  const demoAccount = {
    broker: 'demo',
    accountType: 'demo',
    accountId: null,
    apiKey: null,
    apiSecret: null,
    isDemo: true,
    id: 'acc_demo_1',
  };

  // ── Positive control: fully demo account → returns DemoBroker ──
  it('broker=demo, accountType=demo, isDemo=true → returns DemoBroker instance', async () => {
    const broker = await createBrokerFromAccount(demoAccount);
    expect(broker).toBeInstanceOf(DemoBroker);
  });

  // ── Fail closed: demo broker with isDemo=false ──
  it('broker=demo, accountType=demo, isDemo=false → throws PHASE1_LIVE_TRADING_DISABLED', async () => {
    try {
      await createBrokerFromAccount({ ...demoAccount, isDemo: false });
      expect.unreachable('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(BrokerFactoryError);
      expect((e as BrokerFactoryError).code).toBe(PHASE1_CODE);
    }
  });

  // ── Fail closed: alpaca broker ──
  it('broker=alpaca → throws PHASE1_LIVE_TRADING_DISABLED', async () => {
    try {
      await createBrokerFromAccount({
        ...demoAccount,
        broker: 'alpaca',
        accountType: 'live',
        isDemo: false,
      });
      expect.unreachable('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(BrokerFactoryError);
      expect((e as BrokerFactoryError).code).toBe(PHASE1_CODE);
    }
  });

  // ── Fail closed: demo broker with live accountType ──
  it('broker=demo, accountType=live → throws PHASE1_LIVE_TRADING_DISABLED', async () => {
    try {
      await createBrokerFromAccount({
        ...demoAccount,
        accountType: 'live',
        isDemo: false,
      });
      expect.unreachable('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(BrokerFactoryError);
      expect((e as BrokerFactoryError).code).toBe(PHASE1_CODE);
    }
  });

  // ── Fail closed: null isDemo ──
  it('broker=demo, accountType=demo, isDemo=null → throws PHASE1_LIVE_TRADING_DISABLED', async () => {
    try {
      await createBrokerFromAccount({
        ...demoAccount,
        isDemo: null,
      });
      expect.unreachable('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(BrokerFactoryError);
      expect((e as BrokerFactoryError).code).toBe(PHASE1_CODE);
    }
  });
});
