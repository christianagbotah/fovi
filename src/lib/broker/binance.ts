// ============================================================
// Fovi Binance Broker Client - Spot Trading via Binance API v3
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
import { formatBinanceQty, formatBinancePrice } from './binance-exchange-info';
import { brokerRateLimit } from '../broker-rate-limit';

// Binance API base URLs
const BINANCE_REST = {
  live: 'https://api.binance.com',
  testnet: 'https://testnet.binance.vision',
};

const BINANCE_FUTURES = {
  live: 'https://fapi.binance.com',
  testnet: 'https://testnet.binancefuture.com',
};

// Our timeframe → Binance kline interval
const INTERVAL_MAP: Record<string, string> = {
  '1m': '1m', '5m': '5m', '15m': '15m',
  '1h': '1h', '4h': '4h', '1d': '1d', '1w': '1w',
};

/**
 * BinanceBroker implements IBroker using Binance Spot API v3.
 * Supports both testnet (demo) and live trading for crypto pairs.
 *
 * Uses HMAC-SHA256 request signing via Web Crypto API.
 * API Docs: https://binance-docs.github.io/apidocs/spot/en/
 */
export class BinanceBroker implements IBroker {
  private baseUrl: string;
  private apiKey: string;
  private apiSecret: string;
  private recvWindow: number;

  constructor(config: BrokerConfig) {
    if (!config.apiKey || !config.apiSecret) {
      throw new Error('Binance broker requires apiKey and apiSecret');
    }
    this.baseUrl = config.isDemo ? BINANCE_REST.testnet : BINANCE_REST.live;
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
    this.recvWindow = 5000; // 5 seconds
  }

  // ----------------------------------------------------------
  // Account
  // ----------------------------------------------------------

  async getAccountInfo(): Promise<BrokerAccountInfo> {
    await brokerRateLimit('binance');
    const data = await this.signedRequest<{
      accountType: string;
      balances: { asset: string; free: string; locked: string }[];
      canTrade: boolean;
    }>('/api/v3/account');

    // Calculate total USDT balance (or use USDC as fallback)
    let balance = 0;
    for (const b of data.balances) {
      if (b.asset === 'USDT') {
        balance = parseFloat(b.free) + parseFloat(b.locked);
        break;
      }
      if (b.asset === 'USDC' && balance === 0) {
        balance = parseFloat(b.free) + parseFloat(b.locked);
      }
    }

    return {
      accountId: 'binance-spot',
      balance,
      currency: 'USDT',
      buyingPower: balance, // Simplified - no margin in spot
      dayPnl: 0, // Binance spot account doesn't provide day PnL directly
    };
  }

  // ----------------------------------------------------------
  // Positions (inferred from non-zero balances)
  // ----------------------------------------------------------

  async getPositions(): Promise<BrokerPosition[]> {
    await brokerRateLimit('binance');
    const data = await this.signedRequest<{
      balances: { asset: string; free: string; locked: string }[];
    }>('/api/v3/account');

    const positions: BrokerPosition[] = [];

    for (const b of data.balances) {
      const free = parseFloat(b.free);
      const locked = parseFloat(b.locked);
      const totalQty = free + locked;

      // Skip stablecoins and zero balances
      if (totalQty <= 0) continue;
      if (['USDT', 'USDC', 'BUSD', 'DAI', 'TUSD'].includes(b.asset)) continue;

      // Get current price for the pair
      const symbol = `${b.asset}USDT`;
      let currentPrice: number;
      try {
        currentPrice = await this.getPrice(symbol);
      } catch {
        // Try USDC pair if USDT not available
        try {
          currentPrice = await this.getPrice(`${b.asset}USDC`);
        } catch {
          continue; // Skip if no price available
        }
      }

      // Spot positions are always long
      positions.push({
        symbol,
        qty: totalQty,
        avgEntryPrice: 0, // Binance spot doesn't track avg entry price per asset
        currentPrice,
        unrealizedPnl: 0, // Can't compute without cost basis
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
    await brokerRateLimit('binance');
    const binanceParams: Record<string, string> = {
      symbol: params.symbol,
      side: params.side.toUpperCase(),
      type: this.mapOrderType(params.type),
      quantity: await this.formatQty(params.qty, params.symbol),
    };

    if (params.type === 'limit' || params.type === 'stop_limit') {
      if (params.limitPrice !== undefined) {
        binanceParams.price = await this.formatPrice(params.limitPrice, params.symbol);
      }
      binanceParams.timeInForce = 'GTC';
    }

    if (params.type === 'stop') {
      if (params.stopPrice !== undefined) {
        binanceParams.stopPrice = await this.formatPrice(params.stopPrice, params.symbol);
      }
    }

    if (params.type === 'stop_limit') {
      if (params.stopPrice !== undefined) {
        binanceParams.stopPrice = await this.formatPrice(params.stopPrice, params.symbol);
      }
    }

    const data = await this.signedPostRequest<{
      orderId: number;
      symbol: string;
      status: string;
      origQty: string;
      executedQty: string;
      fills: { price: string; qty: string; commission: string }[];
      type: string;
      side: string;
      transactTime: number;
    }>('/api/v3/order', binanceParams);

    // Calculate average fill price from fills
    let filledPrice: number | null = null;
    if (data.fills && data.fills.length > 0) {
      const totalCost = data.fills.reduce((s, f) => s + parseFloat(f.price) * parseFloat(f.qty), 0);
      const totalQty = data.fills.reduce((s, f) => s + parseFloat(f.qty), 0);
      filledPrice = totalCost / totalQty;
    }

    return {
      orderId: data.orderId.toString(),
      symbol: data.symbol,
      side: data.side.toLowerCase() as OrderSide,
      type: this.reverseMapOrderType(data.type),
      qty: parseFloat(data.origQty),
      filledQty: parseFloat(data.executedQty),
      filledPrice,
      status: this.mapOrderStatus(data.status),
      timestamp: new Date(data.transactTime).toISOString(),
    };
  }

  async closePosition(symbol: string): Promise<BrokerOrderResult> {
    await brokerRateLimit('binance');
    // For spot, we need to sell all of the base asset
    // Get the balance first
    const data = await this.signedRequest<{
      balances: { asset: string; free: string; locked: string }[];
    }>('/api/v3/account');

    // Extract base asset from symbol (e.g. BTC from BTCUSDT)
    const quoteAssets = ['USDT', 'USDC', 'BUSD', 'DAI', 'TUSD', 'BTC', 'ETH', 'BNB'];
    let baseAsset = symbol;
    for (const q of quoteAssets) {
      if (symbol.endsWith(q)) {
        baseAsset = symbol.slice(0, -q.length);
        break;
      }
    }

    const balance = data.balances.find((b) => b.asset === baseAsset);
    if (!balance) {
      return {
        orderId: 'REJ_binance',
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

    const totalQty = parseFloat(balance.free) + parseFloat(balance.locked);
    if (totalQty <= 0) {
      return {
        orderId: 'REJ_binance',
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

    return this.placeOrder({
      symbol,
      side: 'sell',
      type: 'market',
      qty: totalQty,
    });
  }

  // ----------------------------------------------------------
  // Market Data (Klines / Candles)
  // ----------------------------------------------------------

  async getCandles(symbol: string, timeframe: string, limit: number = 100): Promise<CandleData[]> {
    await brokerRateLimit('binance');
    const interval = INTERVAL_MAP[timeframe] || '1h';
    const params = new URLSearchParams({
      symbol,
      interval,
      limit: Math.min(limit, 1000).toString(), // Binance max is 1000
    });

    const url = `${this.baseUrl}/api/v3/klines?${params.toString()}`;
    const res = await fetch(url);

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new BinanceError(res.status, `Binance klines error: ${res.status} ${body}`, '/api/v3/klines');
    }

    // Binance klines format: [[openTime, open, high, low, close, volume, closeTime, ...], ...]
    const klines = (await res.json()) as unknown[][];

    return klines.map((k) => ({
      timestamp: k[0] as number,
      open: parseFloat(k[1] as string),
      high: parseFloat(k[2] as string),
      low: parseFloat(k[3] as string),
      close: parseFloat(k[4] as string),
      volume: parseFloat(k[5] as string),
    }));
  }

  // ----------------------------------------------------------
  // Latest Price
  // ----------------------------------------------------------

  async getPrice(symbol: string): Promise<number> {
    await brokerRateLimit('binance');
    const url = `${this.baseUrl}/api/v3/ticker/price?symbol=${encodeURIComponent(symbol)}`;
    const res = await fetch(url);

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new BinanceError(res.status, `Binance price error: ${res.status} ${body}`, '/api/v3/ticker/price');
    }

    const data = (await res.json()) as { symbol: string; price: string };
    return parseFloat(data.price);
  }

  // ----------------------------------------------------------
  // HMAC-SHA256 Signing (Web Crypto API)
  // ----------------------------------------------------------

  private async sign(queryString: string): Promise<string> {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(this.apiSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(queryString));
    return Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // ----------------------------------------------------------
  // Request Helpers
  // ----------------------------------------------------------

  private async signedRequest<T>(path: string): Promise<T> {
    const queryString = `timestamp=${Date.now()}&recvWindow=${this.recvWindow}`;
    const signature = await this.sign(queryString);
    const url = `${this.baseUrl}${path}?${queryString}&signature=${signature}`;

    const res = await fetch(url, {
      method: 'GET',
      headers: { 'X-MBX-APIKEY': this.apiKey },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new BinanceError(res.status, `Binance API error: ${res.status} ${body}`, path);
    }
    return res.json() as Promise<T>;
  }

  private async signedPostRequest<T>(
    path: string,
    params: Record<string, string>,
  ): Promise<T> {
    params.timestamp = Date.now().toString();
    params.recvWindow = this.recvWindow.toString();

    const queryString = Object.entries(params)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&');

    const signature = await this.sign(queryString);
    const url = `${this.baseUrl}${path}?${queryString}&signature=${signature}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'X-MBX-APIKEY': this.apiKey,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new BinanceError(res.status, `Binance API error: ${res.status} ${body}`, path);
    }
    return res.json() as Promise<T>;
  }

  // ----------------------------------------------------------
  // Order Type Mapping
  // ----------------------------------------------------------

  private mapOrderType(type: OrderType): string {
    switch (type) {
      case 'market': return 'MARKET';
      case 'limit': return 'LIMIT';
      case 'stop': return 'STOP_LOSS';
      case 'stop_limit': return 'STOP_LOSS_LIMIT';
    }
  }

  private reverseMapOrderType(type: string): OrderType {
    switch (type) {
      case 'MARKET': return 'market';
      case 'LIMIT': return 'limit';
      case 'STOP_LOSS': return 'stop';
      case 'STOP_LOSS_LIMIT': return 'stop_limit';
      default: return 'market';
    }
  }

  private mapOrderStatus(status: string): BrokerOrderResult['status'] {
    switch (status) {
      case 'NEW':
      case 'PARTIALLY_FILLED':
        return status === 'NEW' ? 'pending' : 'partially_filled';
      case 'FILLED':
        return 'filled';
      case 'CANCELED':
      case 'EXPIRED':
        return 'cancelled';
      case 'REJECTED':
        return 'rejected';
      default:
        return 'pending';
    }
  }

  /**
   * Format quantity using Binance exchange info (step size).
   * Falls back to 8-decimal trim if exchange info is unavailable.
   */
  private async formatQty(qty: number, symbol: string): Promise<string> {
    try {
      return await formatBinanceQty(symbol, qty);
    } catch {
      return qty.toFixed(8).replace(/\.?0+$/, '');
    }
  }

  /**
   * Format price using Binance exchange info (tick size).
   * Falls back to 8-decimal trim if exchange info is unavailable.
   */
  private async formatPrice(price: number, symbol: string): Promise<string> {
    try {
      return await formatBinancePrice(symbol, price);
    } catch {
      return price.toFixed(8).replace(/\.?0+$/, '');
    }
  }
}

// ----------------------------------------------------------
// Custom Error
// ----------------------------------------------------------

export class BinanceError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public path: string,
  ) {
    super(message);
    this.name = 'BinanceError';
  }
}
