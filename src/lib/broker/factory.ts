// ============================================================
// Broker Factory - Creates broker instances based on config
// Phase 1 CR2: Unknown/unapproved providers ALWAYS throw.
//   DemoBroker ONLY when provider==='demo' AND isDemo===true.
//   No GenericRESTBroker fallback for any provider.
// ============================================================

import type { BrokerConfig } from '../types';
import { DemoBroker } from './demo';
import { AlpacaBroker } from './alpaca';
import { BinanceBroker } from './binance';
import { OkxBroker } from './okx';
import { BybitBroker } from './bybit';
import { BitgetBroker } from './bitget';
import { MT5Broker } from './mt5';
import { decrypt } from '@/lib/encryption';
import { CONTAINMENT_CODES } from '@/lib/trading-policy';

export interface IBroker {
  getAccountInfo(): Promise<{
    accountId: string;
    balance: number;
    currency: string;
    buyingPower: number;
    dayPnl: number;
  }>;
  getPositions(): Promise<{
    symbol: string;
    qty: number;
    avgEntryPrice: number;
    currentPrice: number;
    unrealizedPnl: number;
    side: 'long' | 'short';
  }[]>;
  placeOrder(params: {
    symbol: string;
    side: 'buy' | 'sell';
    type: 'market' | 'limit' | 'stop' | 'stop_limit';
    qty: number;
    limitPrice?: number;
    stopPrice?: number;
  }): Promise<{
    orderId: string;
    symbol: string;
    side: 'buy' | 'sell';
    type: 'market' | 'limit' | 'stop' | 'stop_limit';
    qty: number;
    filledQty: number;
    filledPrice: number | null;
    status: 'pending' | 'filled' | 'partially_filled' | 'cancelled' | 'rejected';
    timestamp: string;
  }>;
  closePosition(symbol: string): Promise<{
    orderId: string;
    symbol: string;
    side: 'buy' | 'sell';
    type: 'market' | 'limit' | 'stop' | 'stop_limit';
    qty: number;
    filledQty: number;
    filledPrice: number | null;
    status: 'pending' | 'filled' | 'partially_filled' | 'cancelled' | 'rejected';
    timestamp: string;
  }>;
  getCandles(symbol: string, timeframe: string, limit?: number): Promise<{
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }[]>;
  getPrice(symbol: string): Promise<number>;
  cancelOrder(symbol: string, orderId: string): Promise<void>;
}

export class BrokerFactoryError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'BrokerFactoryError';
    this.code = code;
  }
}

export function createBroker(config: BrokerConfig): IBroker {
  // DemoBroker ONLY when provider==='demo' AND isDemo===true
  if (config.provider === 'demo') {
    if (config.isDemo !== true) {
      throw new BrokerFactoryError(
        CONTAINMENT_CODES.BROKER_CONFIG_INCOMPLETE,
        'DemoBroker requires both provider="demo" and isDemo=true.',
      );
    }
    return new DemoBroker(config);
  }

  // Built-in implementations — switch, no fallback
  switch (config.provider) {
    case 'alpaca':
      return new AlpacaBroker(config);
    case 'binance':
      return new BinanceBroker(config);
    case 'okx':
      return new OkxBroker(config);
    case 'bybit':
      return new BybitBroker(config);
    case 'bitget':
      return new BitgetBroker(config);
    case 'mt5':
      return new MT5Broker(config);
    default:
      // CR2: Unknown/unapproved providers ALWAYS throw.
      // No GenericRESTBroker fallback.
      throw new BrokerFactoryError(
        CONTAINMENT_CODES.BROKER_CONFIG_INCOMPLETE,
        `Unknown or unapproved broker provider: "${config.provider}". Reconnect in Settings.`,
      );
  }
}

export async function createBrokerFromAccount(account: {
  broker: string;
  accountType: string;
  accountId: string | null;
  apiKey: string | null;
  apiSecret: string | null;
  passphrase?: string | null;
  id: string;
}): Promise<IBroker> {
  // DemoBroker ONLY for explicitly demo accounts
  const isExplicitlyDemo = account.broker === 'demo' && account.accountType === 'demo';
  if (isExplicitlyDemo) {
    return new DemoBroker({ provider: 'demo', isDemo: true });
  }

  // For non-demo accounts, credentials are required
  if (!account.apiKey || !account.apiSecret) {
    throw new BrokerFactoryError(
      CONTAINMENT_CODES.BROKER_CONFIG_INCOMPLETE,
      `Broker ${account.broker} account ${account.id} has no stored credentials. Reconnect in Settings.`,
    );
  }

  // Decrypt credentials — failure is an error, NOT a fallback
  const decryptedApiKey = await decrypt(account.apiKey);
  if (!decryptedApiKey) {
    throw new BrokerFactoryError(
      CONTAINMENT_CODES.BROKER_CONNECTION_FAILED,
      `Credential decryption failed for ${account.broker} account ${account.id}. Reconnect in Settings.`,
    );
  }

  const decryptedSecret = await decrypt(account.apiSecret);
  if (!decryptedSecret) {
    throw new BrokerFactoryError(
      CONTAINMENT_CODES.BROKER_CONNECTION_FAILED,
      `Credential decryption failed for ${account.broker} account ${account.id}. Reconnect in Settings.`,
    );
  }

  let decryptedPassphrase: string | undefined;
  if (account.passphrase) {
    const d = await decrypt(account.passphrase);
    decryptedPassphrase = d || undefined;
  }

  const config: BrokerConfig = {
    provider: (account.broker || 'demo') as BrokerConfig['provider'],
    accountId: account.id,
    apiKey: decryptedApiKey,
    apiSecret: decryptedSecret,
    passphrase: decryptedPassphrase,
    isDemo: account.accountType === 'demo',
  };
  return createBroker(config);
}
