// ============================================================
// Broker Factory - Creates broker instances based on config
// Supports: Demo, Alpaca, Binance, OKX, Bybit, Bitget, MT5
// Phase 1: NO live-to-demo fallback. Decryption failure = error.
// Phase 1 CR1: P0-13 — DemoBroker ONLY when provider==='demo' AND isDemo===true.
//              Unknown non-builtin providers throw BrokerFactoryError.
// ============================================================

import type { BrokerConfig } from '../types';
import { DemoBroker } from './demo';
import { AlpacaBroker } from './alpaca';
import { BinanceBroker } from './binance';
import { OkxBroker } from './okx';
import { BybitBroker } from './bybit';
import { BitgetBroker } from './bitget';
import { MT5Broker } from './mt5';
import { GenericRESTBroker } from './generic-rest';
import { decrypt } from '@/lib/encryption';
import { CONTAINMENT_CODES } from '@/lib/trading-policy';

// Broker interface that all providers implement
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

/**
 * Built-in provider codes that have dedicated broker implementations.
 */
const BUILTIN_CODES = new Set([
  'demo', 'alpaca', 'binance', 'okx', 'bybit', 'bitget', 'mt5',
]);

export class BrokerFactoryError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'BrokerFactoryError';
    this.code = code;
  }
}

export function createBroker(config: BrokerConfig): IBroker {
  // ── P0-13: DemoBroker ONLY when provider==='demo' AND isDemo===true ──
  if (config.provider === 'demo') {
    if (config.isDemo !== true) {
      throw new BrokerFactoryError(
        CONTAINMENT_CODES.BROKER_CONFIG_INCOMPLETE,
        'DemoBroker requires both provider="demo" and isDemo=true.',
      );
    }
    return new DemoBroker(config);
  }

  // Built-in implementations
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
      break;
  }

  // For non-built-in providers, try GenericRESTBroker
  if (!BUILTIN_CODES.has(config.provider)) {
    return new GenericRESTBroker(config);
  }

  // Should not reach here for known providers
  throw new BrokerFactoryError(
    CONTAINMENT_CODES.BROKER_CONFIG_INCOMPLETE,
    `Unknown broker provider: ${config.provider}`,
  );
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
  const needsCredentials = account.broker !== 'demo';
  if (needsCredentials && (!account.apiKey || !account.apiSecret)) {
    throw new BrokerFactoryError(
      CONTAINMENT_CODES.BROKER_CONFIG_INCOMPLETE,
      `Broker ${account.broker} account ${account.id} has no stored credentials. Reconnect in Settings.`,
    );
  }

  // Decrypt credentials — failure is an error, NOT a fallback to DemoBroker
  let decryptedApiKey: string | undefined;
  let decryptedSecret: string | undefined;
  let decryptedPassphrase: string | undefined;

  if (account.apiKey) {
    const d = await decrypt(account.apiKey);
    if (!d) {
      throw new BrokerFactoryError(
        CONTAINMENT_CODES.BROKER_CONNECTION_FAILED,
        `Credential decryption failed for ${account.broker} account ${account.id}. Reconnect in Settings.`,
      );
    }
    decryptedApiKey = d;
  }
  if (account.apiSecret) {
    const d = await decrypt(account.apiSecret);
    if (!d) {
      throw new BrokerFactoryError(
        CONTAINMENT_CODES.BROKER_CONNECTION_FAILED,
        `Credential decryption failed for ${account.broker} account ${account.id}. Reconnect in Settings.`,
      );
    }
    decryptedSecret = d;
  }
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
