// ============================================================
// Broker Factory - Creates broker instances based on config
// Phase 1 CR4.1:
//   createBroker() ONLY returns a broker for provider='demo' with isDemo=true.
//   ALL other providers throw PHASE1_LIVE_TRADING_DISABLED before
//   adapter construction, decryption, or network activity.
//   createBrokerFromAccount() enforces the same rule.
// ============================================================

import type { BrokerConfig } from '../types';
import { DemoBroker } from './demo';
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

/**
 * Phase 1: createBroker() ONLY returns a broker for provider='demo' with isDemo=true.
 * ALL other providers — alpaca, binance, okx, bybit, bitget, mt5, generic-rest,
 * unknown, and incomplete configurations — throw PHASE1_LIVE_TRADING_DISABLED
 * BEFORE adapter construction, decryption, or network activity.
 */
export function createBroker(config: BrokerConfig): IBroker {
  // DemoBroker ONLY when provider==='demo' AND isDemo===true
  if (config.provider === 'demo') {
    if (config.isDemo !== true) {
      throw new BrokerFactoryError(
        CONTAINMENT_CODES.PHASE1_LIVE_TRADING_DISABLED,
        'DemoBroker requires both provider="demo" and isDemo=true. No credentials were decrypted.',
      );
    }
    return new DemoBroker(config);
  }

  // Phase 1: ALL non-demo providers are unconditionally blocked.
  // This covers alpaca, binance, okx, bybit, bitget, mt5, generic-rest,
  // unknown, and incomplete configurations.
  throw new BrokerFactoryError(
    CONTAINMENT_CODES.PHASE1_LIVE_TRADING_DISABLED,
    `Phase 1 containment: broker construction for provider "${config.provider}" is not permitted. No credentials were decrypted.`,
  );
}

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
