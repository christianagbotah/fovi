// ============================================================
// Fovi MetaTrader 5 Broker Client — via MetaAPI.cloud REST Bridge
// ============================================================
// MetaTrader 5 does not expose a public REST API natively.
// This implementation uses MetaAPI.cloud as a bridge service.
// Admin must set META_API_KEY env var. Users provide their
// MetaAPI account ID (from the MetaAPI dashboard) to connect.
// API Docs: https://metaapi.cloud/docs/client/
// ============================================================

import type {
  BrokerAccountInfo,
  BrokerConfig,
  BrokerOrderResult,
  BrokerPosition,
  CandleData,
  OrderSide,
  OrderType,
  Side,
} from '../types';
import type { IBroker } from './factory';
import { brokerRateLimit } from '../broker-rate-limit';

const META_API_BASE = 'https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.io';

const INTERVAL_MAP: Record<string, string> = {
  '1m': 'M1', '5m': 'M5', '15m': 'M15',
  '1h': 'H1', '4h': 'H4', '1d': 'D1', '1w': 'W1',
};

/**
 * MT5Broker implements IBroker via MetaAPI.cloud REST API.
 * Supports forex, CFD, stocks, and commodities via MT5.
 */
export class MT5Broker implements IBroker {
  private accountId: string;
  private apiKey: string;
  private isDemo: boolean;

  constructor(config: BrokerConfig) {
    if (!config.apiKey || !config.accountId) {
      throw new Error('MT5 broker requires apiKey (MetaAPI key) and accountId (MetaAPI account ID)');
    }
    this.apiKey = config.apiKey;
    this.accountId = config.accountId;
    this.isDemo = config.isDemo;
  }

  // ----------------------------------------------------------
  // Headers
  // ----------------------------------------------------------

  private headers(): Record<string, string> {
    return {
      'auth-token': this.apiKey,
      'Content-Type': 'application/json',
    };
  }

  // ----------------------------------------------------------
  // Account
  // ----------------------------------------------------------

  async getAccountInfo(): Promise<BrokerAccountInfo> {
    await brokerRateLimit('mt5');
    const res = await fetch(
      `${META_API_BASE}/users/current/accounts/${this.accountId}/account-information`,
      { headers: this.headers(), signal: AbortSignal.timeout(15_000) },
    );
    if (!res.ok) throw new MT5Error(res.status, `MT5 account info error: ${res.status}`);
    const data = await res.json() as any;

    return {
      accountId: this.accountId,
      balance: data.balance ?? 0,
      currency: data.currency ?? 'USD',
      buyingPower: data.equity ?? data.balance ?? 0,
      dayPnl: data.equity ? data.equity - data.balance : 0,
    };
  }

  // ----------------------------------------------------------
  // Positions
  // ----------------------------------------------------------

  async getPositions(): Promise<BrokerPosition[]> {
    await brokerRateLimit('mt5');
    const res = await fetch(
      `${META_API_BASE}/users/current/accounts/${this.accountId}/open-positions`,
      { headers: this.headers(), signal: AbortSignal.timeout(15_000) },
    );
    if (!res.ok) throw new MT5Error(res.status, `MT5 positions error: ${res.status}`);
    const data = (await res.json() as any[]);

    return data.map((p: any) => ({
      symbol: p.symbol,
      qty: Math.abs(p.currentVolume ?? p.volume ?? 0),
      avgEntryPrice: p.openPrice ?? 0,
      currentPrice: p.currentPrice ?? p.openPrice ?? 0,
      unrealizedPnl: p.unrealizedPnl ?? p.profit ?? 0,
      side: (p.currentVolume > 0 ? 'long' : 'short') as Side,
    }));
  }

  // ----------------------------------------------------------
  // Orders
  // ----------------------------------------------------------

  async placeOrder(params: {
    symbol: string;
    side: OrderSide;
    type: OrderType;
    qty: number;
    limitPrice?: number;
    stopPrice?: number;
  }): Promise<BrokerOrderResult> {
    await brokerRateLimit('mt5');

    const orderType = params.type === 'market' ? 'ORDER_TYPE_MARKET'
      : params.type === 'limit' ? 'ORDER_TYPE_LIMIT'
      : params.type === 'stop' ? 'ORDER_TYPE_STOP'
      : 'ORDER_TYPE_STOP_LIMIT';

    const body: Record<string, any> = {
      symbol: params.symbol,
      volume: params.qty,
      type: orderType,
      side: params.side === 'buy' ? 'BUY' : 'SELL',
    };

    if (params.type === 'limit' || params.type === 'stop_limit') {
      body.price = params.limitPrice;
    }
    if (params.type === 'stop' || params.type === 'stop_limit') {
      body.stopPrice = params.stopPrice;
    }

    const res = await fetch(
      `${META_API_BASE}/users/current/accounts/${this.accountId}/trade`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      },
    );

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new MT5Error(res.status, `MT5 trade error: ${res.status} ${errBody}`);
    }

    const data = await res.json() as any;
    return {
      orderId: data.orderId ?? data.dealId ?? 'MT5_' + Date.now(),
      symbol: params.symbol,
      side: params.side,
      type: params.type,
      qty: params.qty,
      filledQty: data.filledVolume ?? params.qty,
      filledPrice: data.executionPrice ?? params.limitPrice ?? null,
      status: 'filled',
      timestamp: new Date().toISOString(),
    };
  }

  async closePosition(symbol: string): Promise<BrokerOrderResult> {
    await brokerRateLimit('mt5');
    const positions = await this.getPositions();
    const pos = positions.find((p) => p.symbol === symbol);
    if (!pos) {
      return {
        orderId: 'REJ_mt5',
        symbol,
        side: 'sell',
        type: 'market',
        qty: 0,
        filledQty: 0,
        filledPrice: null,
        status: 'rejected',
        timestamp: new Date().toISOString(),
      };
    }

    const closeSide: OrderSide = pos.side === 'long' ? 'sell' : 'buy';
    return this.placeOrder({
      symbol,
      side: closeSide,
      type: 'market',
      qty: pos.qty,
    });
  }

  // ----------------------------------------------------------
  // Market Data
  // ----------------------------------------------------------

  async getCandles(symbol: string, timeframe: string, limit: number = 100): Promise<CandleData[]> {
    await brokerRateLimit('mt5');
    const mt5Interval = INTERVAL_MAP[timeframe] || 'H1';
    const startTime = new Date(Date.now() - limit * 3600_000).toISOString();

    const params = new URLSearchParams({
      startTime,
      timeFrame: mt5Interval,
    });

    const res = await fetch(
      `${META_API_BASE}/users/current/accounts/${this.accountId}/symbols/${encodeURIComponent(symbol)}/candles?${params}`,
      { headers: this.headers(), signal: AbortSignal.timeout(15_000) },
    );

    if (!res.ok) throw new MT5Error(res.status, `MT5 candles error: ${res.status}`);
    const data = (await res.json() as any[]);

    return data.slice(-limit).map((k: any) => ({
      timestamp: new Date(k.time).getTime(),
      open: k.open ?? k.openPrice ?? 0,
      high: k.high ?? k.highPrice ?? 0,
      low: k.low ?? k.lowPrice ?? 0,
      close: k.close ?? k.closePrice ?? 0,
      volume: k.tickVolume ?? k.volume ?? 0,
    }));
  }

  async getPrice(symbol: string): Promise<number> {
    await brokerRateLimit('mt5');
    const res = await fetch(
      `${META_API_BASE}/users/current/accounts/${this.accountId}/symbols/${encodeURIComponent(symbol)}/current-price`,
      { headers: this.headers(), signal: AbortSignal.timeout(15_000) },
    );

    if (!res.ok) throw new MT5Error(res.status, `MT5 price error: ${res.status}`);
    const data = (await res.json() as any);
    return data.bid ?? data.ask ?? 0;
  }

  async cancelOrder(_symbol: string, orderId: string): Promise<void> {
    await brokerRateLimit('mt5');
    const res = await fetch(
      `${META_API_BASE}/users/current/accounts/${this.accountId}/orders/${orderId}/cancel`,
      {
        method: 'PUT',
        headers: this.headers(),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!res.ok) throw new MT5Error(res.status, `MT5 cancel error: ${res.status}`);
  }
}

// ----------------------------------------------------------
// Custom Error
// ----------------------------------------------------------

export class MT5Error extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'MT5Error';
  }
}
