// ============================================================
// Broker Factory - Creates broker instances based on config
// ============================================================

import type { BrokerConfig } from '../types';
import { DemoBroker } from './demo';

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
}

export function createBroker(config: BrokerConfig): IBroker {
  switch (config.provider) {
    case 'demo':
    default:
      return new DemoBroker(config);
    // Future: alpaca, binance, deriv cases
  }
}

export function createBrokerFromAccount(account: {
  broker: string;
  accountType: string;
  accountId: string | null;
  apiKey: string | null;
  apiSecret: string | null;
  id: string;
}): IBroker {
  const config: BrokerConfig = {
    provider: (account.broker || 'demo') as BrokerConfig['provider'],
    accountId: account.id,
    apiKey: account.apiKey || undefined,
    apiSecret: account.apiSecret || undefined,
    isDemo: account.accountType === 'demo',
  };
  return createBroker(config);
}
