// ============================================================
// Broker Factory - Creates broker instances based on config
// Supports: Demo, Alpaca, Binance, OKX, Bybit, Bitget, MT5
// Falls back to GenericRESTBroker for admin-added custom brokers
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
 * Anything not in this list goes through GenericRESTBroker (if configured)
 * or falls back to DemoBroker.
 */
const BUILTIN_CODES = new Set([
  'demo', 'alpaca', 'binance', 'okx', 'bybit', 'bitget', 'mt5',
]);

export function createBroker(config: BrokerConfig): IBroker {
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
    case 'demo':
    default:
      break;
  }

  // For non-built-in providers, try GenericRESTBroker
  // This reads config from DB and connects to any REST API broker
  // that admin configured from the UI.
  if (!BUILTIN_CODES.has(config.provider)) {
    return new GenericRESTBroker(config);
  }

  // Final fallback to Demo
  return new DemoBroker(config);
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
  // Decrypt credentials — if decryption fails, fall back to demo broker
  // instead of passing garbage encrypted data as plaintext
  let decryptedApiKey: string | undefined;
  let decryptedSecret: string | undefined;
  let decryptedPassphrase: string | undefined;

  if (account.apiKey) {
    const d = await decrypt(account.apiKey);
    decryptedApiKey = d || undefined;
  }
  if (account.apiSecret) {
    const d = await decrypt(account.apiSecret);
    decryptedSecret = d || undefined;
  }
  if (account.passphrase) {
    const d = await decrypt(account.passphrase);
    decryptedPassphrase = d || undefined;
  }

  // If this is a linked broker but credentials couldn't be decrypted,
  // fall back to demo broker with the stored balance
  const needsCredentials = account.broker !== 'demo' && (account.apiKey || account.apiSecret);
  if (needsCredentials && (!decryptedApiKey || !decryptedSecret)) {
    console.warn(`[broker] Credentials could not be decrypted for ${account.broker} account ${account.id}. Reconnect in Settings.`);
    return new DemoBroker({ provider: 'demo', isDemo: true });
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
