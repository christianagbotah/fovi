// ============================================================
// Fovi Bitget Broker Client - Spot Trading via Bitget V2 API
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

// Bitget API base URLs
const BITGET_REST = {
  live: 'https://api.bitget.com',
  testnet: 'https://api.bitget.com', // Bitget uses same URL with testnet API keys
};

// Our timeframe → Bitget kline interval
const INTERVAL_MAP: Record<string, string> = {
  '1m': '1min', '5m': '5min', '15m': '15min',
  '1h': '1h', '4h': '4h', '1d': '1day', '1w': '1week',
};

/**
 * BitgetBroker implements IBroker using Bitget Spot V2 API.
 * Supports both demo and live trading for crypto pairs.
 * Uses HMAC-SHA256 request signing via Web Crypto API.
 * API Docs: https://www.bitget.com/api-doc/spot/intro
 */
export class BitgetBroker implements IBroker {
  private baseUrl: string;
  private apiKey: string;
  private apiSecret: string;
  private passphrase: string;

  constructor(config: BrokerConfig) {
    if (!config.apiKey || !config.apiSecret) {
      throw new Error('Bitget broker requires apiKey and apiSecret');
    }
    this.baseUrl = config.isDemo ? BITGET_REST.testnet : BITGET_REST.live;
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
    this.passphrase = config.passphrase || '';
  }

  // ----------------------------------------------------------
  // Account
  // ----------------------------------------------------------

  async getAccountInfo(): Promise<BrokerAccountInfo> {
    await brokerRateLimit('bitget');
    const data = await this.signedRequest<{
      code: string;
      data: Array<{
        coin: string;
        available: string;
        frozen: string;
        locked: string;
      }>;
    }>('/v2/spot/account/assets', 'GET', {});

    let balance = 0;
    for (const a of data.data) {
      if (a.coin === 'USDT' || a.coin === 'USDC') {
        balance = parseFloat(a.available) + parseFloat(a.frozen);
        break;
      }
    }

    return {
      accountId: 'bitget-spot',
      balance,
      currency: 'USDT',
      buyingPower: balance * 3, // Bitget margin
      dayPnl: 0,
    };
  }

  // ----------------------------------------------------------
  // Positions (non-zero balances in spot)
  // ----------------------------------------------------------

  async getPositions(): Promise<BrokerPosition[]> {
    await brokerRateLimit('bitget');
    const data = await this.signedRequest<{
      code: string;
      data: Array<{
        coin: string;
        available: string;
        frozen: string;
      }>;
    }>('/v2/spot/account/assets', 'GET', {});

    const positions: BrokerPosition[] = [];
    for (const a of data.data) {
      const available = parseFloat(a.available);
      const frozen = parseFloat(a.frozen);
      const total = available + frozen;

      if (total <= 0) continue;
      if (['USDT', 'USDC', 'BUSD', 'DAI'].includes(a.coin)) continue;

      // Try to get price
      let currentPrice = 0;
      try {
        currentPrice = await this.getPrice(`${a.coin}USDT`);
      } catch {
        try {
          currentPrice = await this.getPrice(`${a.coin}USDC`);
        } catch {
          continue;
        }
      }

      positions.push({
        symbol: `${a.coin}USDT`,
        qty: total,
        avgEntryPrice: 0,
        currentPrice,
        unrealizedPnl: 0,
        side: 'long' as Side,
      });
    }

    return positions;
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
    await brokerRateLimit('bitget');

    const body: Record<string, string> = {
      symbol: params.symbol,
      side: this.mapSide(params.side),
      orderType: this.mapOrderType(params.type),
      size: params.qty.toString(),
      force: 'gtc',
    };

    if (params.type === 'limit' || params.type === 'stop_limit') {
      if (params.limitPrice !== undefined) {
        body.price = params.limitPrice.toString();
      }
    }

    if (params.type === 'market') {
      body.force = 'fok';
    }

    const data = await this.signedRequest<{
      code: string;
      data: string;
    }>('/v2/spot/trade/place-order', 'POST', body);

    return {
      orderId: data.data,
      symbol: params.symbol,
      side: params.side,
      type: params.type,
      qty: params.qty,
      filledQty: 0,
      filledPrice: null,
      status: 'pending',
      timestamp: new Date().toISOString(),
    };
  }

  async closePosition(symbol: string): Promise<BrokerOrderResult> {
    await brokerRateLimit('bitget');
    const positions = await this.getPositions();
    const pos = positions.find((p) => p.symbol === symbol);
    if (!pos) {
      return {
        orderId: 'REJ_bitget',
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
    await brokerRateLimit('bitget');
    const interval = INTERVAL_MAP[timeframe] || '1h';
    const params = new URLSearchParams({
      symbol,
      granularity: interval,
      limit: Math.min(limit, 1000).toString(),
    });

    const url = `${this.baseUrl}/v2/spot/market/candles?${params.toString()}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new BitgetError(res.status, `Bitget klines error: ${res.status} ${body}`);
    }

    const data = (await res.json()) as {
      data: string[][];
    };

    // Bitget returns newest first, reverse for chronological
    // Format: [ts, open, high, low, close, volume, quoteVolume]
    return data.data.reverse().map((k) => ({
      timestamp: parseInt(k[0]),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));
  }

  async getPrice(symbol: string): Promise<number> {
    await brokerRateLimit('bitget');
    const url = `${this.baseUrl}/v2/spot/market/tickers?symbol=${encodeURIComponent(symbol)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new BitgetError(res.status, `Bitget price error: ${res.status} ${body}`);
    }

    const data = (await res.json()) as {
      data: Array<{ lastPr: string; symbol: string }>;
    };

    const ticker = data.data?.[0];
    if (!ticker) throw new BitgetError(404, `No ticker data for ${symbol}`);
    return parseFloat(ticker.lastPr);
  }

  async cancelOrder(symbol: string, orderId: string): Promise<void> {
    await brokerRateLimit('bitget');
    await this.signedRequest('/v2/spot/trade/cancel-order', 'POST', {
      symbol,
      orderId,
    });
  }

  // ----------------------------------------------------------
  // HMAC-SHA256 Signing (Web Crypto API)
  // Bitget signature = base64(HMAC-SHA256(timestamp + method + path + body, secret))
  // ----------------------------------------------------------

  private async sign(timestamp: string, method: string, path: string, body: string): Promise<string> {
    const preSign = timestamp + method.toUpperCase() + path + (body || '');
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(this.apiSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(preSign));
    return btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(sig))));
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
    const bodyStr = method === 'POST' ? JSON.stringify(params) : '';
    const queryString = method === 'GET'
      ? '?' + Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
      : '';
    const signPath = path + queryString;
    const signature = await this.sign(timestamp, method, signPath, bodyStr);

    const url = method === 'GET'
      ? `${this.baseUrl}${signPath}`
      : `${this.baseUrl}${path}`;

    const res = await fetch(url, {
      method,
      headers: {
        'ACCESS-KEY': this.apiKey,
        'ACCESS-SIGN': signature,
        'ACCESS-TIMESTAMP': timestamp,
        'ACCESS-PASSPHRASE': this.passphrase,
        'Content-Type': 'application/json',
      },
      body: method === 'POST' ? bodyStr : undefined,
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const respBody = await res.text().catch(() => '');
      throw new BitgetError(res.status, `Bitget API error: ${res.status} ${respBody}`, path);
    }

    return res.json() as Promise<T>;
  }

  // ----------------------------------------------------------
  // Mapping Helpers
  // ----------------------------------------------------------

  private mapSide(side: OrderSide): string {
    return side === 'buy' ? 'buy' : 'sell';
  }

  private mapOrderType(type: OrderType): string {
    switch (type) {
      case 'market': return 'market';
      case 'limit': return 'limit';
      case 'stop': return 'market';
      case 'stop_limit': return 'limit';
    }
  }
}

// ----------------------------------------------------------
// Custom Error
// ----------------------------------------------------------

export class BitgetError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public path?: string,
  ) {
    super(message);
    this.name = 'BitgetError';
  }
}
