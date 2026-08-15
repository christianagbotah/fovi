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

const KNOWN_REAL_PROVIDERS = new Set(['alpaca', 'binance', 'okx', 'bybit', 'bitget', 'mt5']);

export async function createBrokerFromAccount(account: {
  broker: string;
  accountType: string;
  accountId: string | null;
  apiKey: string | null;
  apiSecret: string | null;
  passphrase?: string | null;
  isDemo?: boolean | null;
  id: string;
}): Promise<IBroker> {
  // Check if explicitly demo (ALL THREE conditions mandatory)
  const isExplicitlyDemoAccount = account.broker === 'demo'
    && account.accountType === 'demo'
    && account.isDemo === true;

  if (isExplicitlyDemoAccount) {
    return new DemoBroker({ provider: 'demo', isDemo: true });
  }

  // Phase 1: Block ALL non-demo broker construction before decrypting credentials
  // or making any network request
  throw new BrokerFactoryError(
    CONTAINMENT_CODES.PHASE1_LIVE_TRADING_DISABLED,
    'Phase 1 containment: live broker construction is not permitted. No credentials were decrypted.',
  );
}
