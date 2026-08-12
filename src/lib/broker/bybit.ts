// ============================================================
// Fovi Bybit Broker Client - Spot & Derivatives Trading via Bybit V5 API
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

// Bybit V5 API base URLs
const BYBIT_REST = {
  live: 'https://api.bybit.com',
  testnet: 'https://api-testnet.bybit.com',
};

// Our timeframe → Bybit kline interval
const INTERVAL_MAP: Record<string, string> = {
  '1m': '1', '5m': '5', '15m': '15',
  '1h': '60', '4h': '240', '1d': 'D', '1w': 'W',
};

/**
 * BybitBroker implements IBroker using Bybit V5 API.
 * Supports both testnet (demo) and live trading for crypto.
 * Uses HMAC-SHA256 request signing via Web Crypto API.
 * API Docs: https://bybit-exchange.github.io/docs/v5/intro
 */
export class BybitBroker implements IBroker {
  private baseUrl: string;
  private apiKey: string;
  private apiSecret: string;
  private recvWindow: string;

  constructor(config: BrokerConfig) {
    if (!config.apiKey || !config.apiSecret) {
      throw new Error('Bybit broker requires apiKey and apiSecret');
    }
    this.baseUrl = config.isDemo ? BYBIT_REST.testnet : BYBIT_REST.live;
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
    this.recvWindow = '5000';
  }

  // ----------------------------------------------------------
  // Account
  // ----------------------------------------------------------

  async getAccountInfo(): Promise<BrokerAccountInfo> {
    await brokerRateLimit('bybit');
    const data = await this.signedRequest<{
      result: {
        accountType: string;
        balance: Array<{
          coin: string;
          walletBalance: string;
          availableToWithdraw: string;
          equity: string;
        }>;
      };
    }>('/v5/account/wallet-balance', 'GET', { accountType: 'UNIFIED' });

    let balance = 0;
    for (const b of data.result.balance) {
      if (b.coin === 'USDT' || b.coin === 'USDC') {
        balance = parseFloat(b.walletBalance);
        break;
      }
    }

    return {
      accountId: 'bybit-unified',
      balance,
      currency: 'USDT',
      buyingPower: balance * 3, // Bybit unified margin
      dayPnl: 0,
    };
  }

  // ----------------------------------------------------------
  // Positions
  // ----------------------------------------------------------

  async getPositions(): Promise<BrokerPosition[]> {
    await brokerRateLimit('bybit');
    const data = await this.signedRequest<{
      result: {
        list: Array<{
          symbol: string;
          side: string;
          size: string;
          avgPrice: string;
          markPrice: string;
          unrealisedPnl: string;
        }>;
      };
    }>('/v5/position/list', 'GET', { category: 'linear' });

    return data.result.list
      .filter((p) => parseFloat(p.size) > 0)
      .map((p) => ({
        symbol: p.symbol,
        qty: Math.abs(parseFloat(p.size)),
        avgEntryPrice: parseFloat(p.avgPrice),
        currentPrice: parseFloat(p.markPrice),
        unrealizedPnl: parseFloat(p.unrealisedPnl),
        side: (p.side === 'Buy' ? 'long' : 'short') as Side,
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
    await brokerRateLimit('bybit');

    // Bybit V5 uses USDT-margined linear contracts by default
    const bybitParams: Record<string, string> = {
      category: 'spot',
      symbol: params.symbol,
      side: this.mapSide(params.side),
      orderType: this.mapOrderType(params.type),
      qty: params.qty.toString(),
    };

    if (params.type === 'limit' || params.type === 'stop_limit') {
      bybitParams.price = (params.limitPrice ?? 0).toString();
      bybitParams.timeInForce = 'GTC';
    }

    if (params.type === 'stop' || params.type === 'stop_limit') {
      bybitParams.triggerPrice = (params.stopPrice ?? 0).toString();
    }

    if (params.type === 'market') {
      bybitParams.timeInForce = 'IOC';
    }

    const data = await this.signedRequest<{
      result: {
        orderId: string;
        symbol: string;
        orderStatus: string;
        qty: string;
        cumExecQty: string;
        avgPrice: string;
        orderType: string;
        side: string;
        createdTime: string;
      };
    }>('/v5/order/create', 'POST', bybitParams);

    const result = data.result;
    const filledQty = parseFloat(result.cumExecQty);

    return {
      orderId: result.orderId,
      symbol: result.symbol,
      side: result.side.toLowerCase() as OrderSide,
      type: params.type,
      qty: parseFloat(result.qty),
      filledQty,
      filledPrice: filledQty > 0 ? parseFloat(result.avgPrice) : null,
      status: this.mapOrderStatus(result.orderStatus),
      timestamp: new Date(parseInt(result.createdTime)).toISOString(),
    };
  }

  async closePosition(symbol: string): Promise<BrokerOrderResult> {
    await brokerRateLimit('bybit');
    const positions = await this.getPositions();
    const pos = positions.find((p) => p.symbol === symbol);
    if (!pos) {
      return {
        orderId: 'REJ_bybit',
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

  async getCandles(symbol: string, timeframe: string, limit: number = 200): Promise<CandleData[]> {
    await brokerRateLimit('bybit');
    const interval = INTERVAL_MAP[timeframe] || '60';
    const params = new URLSearchParams({
      category: 'spot',
      symbol,
      interval,
      limit: Math.min(limit, 200).toString(),
    });

    const url = `${this.baseUrl}/v5/market/kline?${params.toString()}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new BybitError(res.status, `Bybit klines error: ${res.status} ${body}`);
    }

    // Bybit klines: [[startTime, open, high, low, close, volume, turnover], ...]
    const data = (await res.json()) as { result: { list: string[][] } };

    // Bybit returns newest first, reverse for chronological order
    return data.result.list.reverse().map((k) => ({
      timestamp: parseInt(k[0]),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));
  }

  async getPrice(symbol: string): Promise<number> {
    await brokerRateLimit('bybit');
    const url = `${this.baseUrl}/v5/market/tickers?category=spot&symbol=${encodeURIComponent(symbol)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new BybitError(res.status, `Bybit price error: ${res.status} ${body}`);
    }

    const data = (await res.json()) as {
      result: { list: Array<{ lastPrice: string }> };
    };

    const ticker = data.result.list[0];
    if (!ticker) throw new BybitError(404, `No ticker data for ${symbol}`);
    return parseFloat(ticker.lastPrice);
  }

  async cancelOrder(symbol: string, orderId: string): Promise<void> {
    await brokerRateLimit('bybit');
    await this.signedRequest('/v5/order/cancel', 'POST', {
      category: 'spot',
      symbol,
      orderId,
    });
  }

  // ----------------------------------------------------------
  // HMAC-SHA256 Signing (Web Crypto API)
  // ----------------------------------------------------------

  private async sign(payload: string, timestamp: string): Promise<string> {
    const preSign = timestamp + this.apiKey + payload + this.recvWindow;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(this.apiSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(preSign));
    return Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // ----------------------------------------------------------
  // Request Helpers
  // ----------------------------------------------------------

  private async signedRequest<T>(
    path: string,
    method: 'GET' | 'POST',
    params: Record<string, string> = {},
  ): Promise<T> {
    const timestamp = Date.now().toString();
    const queryString = Object.entries(params)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&');
    const signature = await this.sign(queryString, timestamp);

    const url = method === 'GET'
      ? `${this.baseUrl}${path}?${queryString}`
      : `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      'X-BAPI-API-KEY': this.apiKey,
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-SIGN': signature,
      'X-BAPI-RECV-WINDOW': this.recvWindow,
      'Content-Type': 'application/json',
    };

    const res = await fetch(url, {
      method,
      headers,
      body: method === 'POST' ? JSON.stringify(params) : undefined,
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new BybitError(res.status, `Bybit API error: ${res.status} ${body}`, path);
    }

    return res.json() as Promise<T>;
  }

  // ----------------------------------------------------------
  // Mapping Helpers
  // ----------------------------------------------------------

  private mapSide(side: OrderSide): string {
    return side === 'buy' ? 'Buy' : 'Sell';
  }

  private mapOrderType(type: OrderType): string {
    switch (type) {
      case 'market': return 'Market';
      case 'limit': return 'Limit';
      case 'stop': return 'Market'; // Bybit uses conditional orders
      case 'stop_limit': return 'Limit';
    }
  }

  private mapOrderStatus(status: string): BrokerOrderResult['status'] {
    switch (status) {
      case 'New':
      case 'Created':
        return 'pending';
      case 'PartiallyFilled':
        return 'partially_filled';
      case 'Filled':
        return 'filled';
      case 'Cancelled':
      case 'Canceled':
        return 'cancelled';
      case 'Rejected':
        return 'rejected';
      default:
        return 'pending';
    }
  }
}

// ----------------------------------------------------------
// Custom Error
// ----------------------------------------------------------

export class BybitError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public path?: string,
  ) {
    super(message);
    this.name = 'BybitError';
  }
}
