import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createBroker, createBrokerFromAccount, BrokerFactoryError } from '@/lib/broker/factory';
import { CONTAINMENT_CODES } from '@/lib/trading-policy';

// ─────────────────────────────────────────────────────
// 6. Broker failure never produces DemoBroker
// ─────────────────────────────────────────────────────
describe('createBrokerFromAccount — live-to-demo containment', () => {
  it('creates DemoBroker for explicitly demo accounts', async () => {
    const broker = await createBrokerFromAccount({
      broker: 'demo',
      accountType: 'demo',
      accountId: 'demo_1',
      apiKey: null,
      apiSecret: null,
      id: 'acc_demo',
    });
    // DemoBroker has getAccountInfo that returns 100000 balance
    const info = await broker.getAccountInfo();
    expect(info.balance).toBe(100000);
  });

  it('throws BrokerFactoryError for live account with missing credentials', async () => {
    await expect(
      createBrokerFromAccount({
        broker: 'okx',
        accountType: 'live',
        accountId: null,
        apiKey: null,
        apiSecret: null,
        id: 'acc_live',
      })
    ).rejects.toThrow(BrokerFactoryError);
  });

  it('throws BrokerFactoryError when decryption returns null', async () => {
    // Mock decrypt to return null (simulates decryption failure)
    vi.mock('@/lib/encryption', () => ({
      decrypt: vi.fn().mockResolvedValue(null),
    }));

    // Re-import to get the mocked version
    const { createBrokerFromAccount: createFromAccount } = await import('@/lib/broker/factory');

    await expect(
      createFromAccount({
        broker: 'okx',
        accountType: 'live',
        accountId: null,
        apiKey: 'encrypted_garbage',
        apiSecret: 'encrypted_garbage',
        id: 'acc_live_2',
      })
    ).rejects.toThrow(BrokerFactoryError);
  });

  it('throws for live account with only apiKey (no secret)', async () => {
    await expect(
      createBrokerFromAccount({
        broker: 'okx',
        accountType: 'live',
        accountId: null,
        apiKey: 'some_key',
        apiSecret: null,
        id: 'acc_live_3',
      })
    ).rejects.toThrow(BrokerFactoryError);
  });
});

// ─────────────────────────────────────────────────────
// 7. Credential decryption failure never produces DemoBroker
// ─────────────────────────────────────────────────────
describe('BrokerFactoryError', () => {
  it('has correct code for connection failure', () => {
    const err = new BrokerFactoryError(
      CONTAINMENT_CODES.BROKER_CONNECTION_FAILED,
      'Decryption failed'
    );
    expect(err.code).toBe(CONTAINMENT_CODES.BROKER_CONNECTION_FAILED);
    expect(err.message).toBe('Decryption failed');
    expect(err.name).toBe('BrokerFactoryError');
  });

  it('has correct code for incomplete config', () => {
    const err = new BrokerFactoryError(
      CONTAINMENT_CODES.BROKER_CONFIG_INCOMPLETE,
      'No credentials'
    );
    expect(err.code).toBe(CONTAINMENT_CODES.BROKER_CONFIG_INCOMPLETE);
  });
});
