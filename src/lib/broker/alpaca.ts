// ============================================================
// Fovi Alpaca Broker Client - Stocks & Crypto via Alpaca API v2
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

// Alpaca REST API base URLs
const ALPACA_REST = {
  live: 'https://api.alpaca.markets',
  paper: 'https://paper-api.alpaca.markets',
};

const ALPACA_DATA_URL = 'https://data.alpaca.markets';

// Alpaca timeframe → API bar timeframe mapping
const TIMEFRAME_MAP: Record<string, string> = {
  '1m': '1Min', '5m': '5Min', '15m': '15Min',
  '1h': '1Hour', '4h': '4Hour', '1d': '1Day', '1w': '1Week',
};

/**
 * AlpacaBroker implements the IBroker interface using Alpaca's REST API v2.
 * Supports both paper (demo) and live trading for US equities.
 *
 * API Docs: https://docs.alpaca.markets/docs/api-v2
 */
export class AlpacaBroker implements IBroker {
  private baseUrl: string;
  private dataUrl: string;
  private headers: { 'APCA-API-KEY-ID': string; 'APCA-API-SECRET-KEY': string };
  private accountIdOverride: string;

  constructor(config: BrokerConfig) {
    if (!config.apiKey || !config.apiSecret) {
      throw new Error('Alpaca broker requires apiKey and apiSecret');
    }
    this.baseUrl = config.isDemo ? ALPACA_REST.paper : ALPACA_REST.live;
    this.dataUrl = ALPACA_DATA_URL;
    this.headers = {
      'APCA-API-KEY-ID': config.apiKey,
      'APCA-API-SECRET-KEY': config.apiSecret,
    };
    this.accountIdOverride = config.accountId || '';
  }

  // ----------------------------------------------------------
  // Account
  // ----------------------------------------------------------

  async getAccountInfo(): Promise<BrokerAccountInfo> {
    const data = await this.request<{
      id: string;
      cash: string;
      currency: string;
      buying_power: string;
      equity: string;
      last_equity: string;
      status: string;
    }>('/v2/account');

    const equity = parseFloat(data.equity);
    const lastEquity = parseFloat(data.last_equity);
    const dayPnl = equity - lastEquity;

    return {
      accountId: this.accountIdOverride || data.id,
      balance: parseFloat(data.cash),
      currency: data.currency || 'USD',
      buyingPower: parseFloat(data.buying_power),
      dayPnl,
    };
  }

  // ----------------------------------------------------------
  // Positions
  // ----------------------------------------------------------

  async getPositions(): Promise<BrokerPosition[]> {
    const data = await this.request<{
      symbol: string;
      qty: string;
      side: string;
      avg_entry_price: string;
      current_price: string;
      unrealized_pl: string;
      market_value: string;
      cost_basis: string;
    }[]>('/v2/positions');

    return data.map((p) => {
      const qty = parseInt(p.qty, 10);
      const avgPrice = parseFloat(p.avg_entry_price);
      const currentPrice = parseFloat(p.current_price);
      const unrealizedPnl = parseFloat(p.unrealized_pl);

      return {
        symbol: p.symbol,
        qty,
        avgEntryPrice: avgPrice,
        currentPrice,
        unrealizedPnl,
        side: (p.side === 'long' ? 'long' : 'short') as Side,
      };
    });
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
    const alpacaOrder: Record<string, unknown> = {
      symbol: params.symbol,
      qty: params.qty.toString(),
      side: params.side,          // 'buy' | 'sell'
      type: this.mapOrderType(params.type),
      time_in_force: 'gtc',
    };

    if (params.type === 'limit' || params.type === 'stop_limit') {
      alpacaOrder.limit_price = params.limitPrice?.toString();
    }
    if (params.type === 'stop' || params.type === 'stop_limit') {
      alpacaOrder.stop_price = params.stopPrice?.toString();
    }

    const data = await this.postRequest<{
      id: string;
      symbol: string;
      side: string;
      type: string;
      qty: string;
      filled_qty: string;
      filled_avg_price: string | null;
      status: string;
      submitted_at: string;
    }>('/v2/orders', alpacaOrder);

    return {
      orderId: data.id,
      symbol: data.symbol,
      side: data.side as OrderSide,
      type: this.reverseMapOrderType(data.type),
      qty: parseInt(data.qty, 10),
      filledQty: parseInt(data.filled_qty, 10),
      filledPrice: data.filled_avg_price ? parseFloat(data.filled_avg_price) : null,
      status: this.mapOrderStatus(data.status),
      timestamp: data.submitted_at,
    };
  }

  async closePosition(symbol: string): Promise<BrokerOrderResult> {
    // Alpaca has a dedicated close-position endpoint
    const data = await this.deleteRequest<{
      id: string;
      symbol: string;
      side: string;
      type: string;
      qty: string;
      filled_qty: string;
      filled_avg_price: string | null;
      status: string;
      submitted_at: string;
    }>(`/v2/positions/${symbol}`);

    return {
      orderId: data.id,
      symbol: data.symbol,
      side: data.side as OrderSide,
      type: this.reverseMapOrderType(data.type),
      qty: parseInt(data.qty, 10),
      filledQty: parseInt(data.filled_qty, 10),
      filledPrice: data.filled_avg_price ? parseFloat(data.filled_avg_price) : null,
      status: this.mapOrderStatus(data.status),
      timestamp: data.submitted_at,
    };
  }

  // ----------------------------------------------------------
  // Market Data (Bars / Candles)
  // ----------------------------------------------------------

  async getCandles(symbol: string, timeframe: string, limit: number = 100): Promise<CandleData[]> {
    const alpacaTimeframe = TIMEFRAME_MAP[timeframe] || '1Day';
    const end = new Date().toISOString();
    // Approximate start based on timeframe and limit
    const intervalMs: Record<string, number> = {
      '1m': 60000, '5m': 300000, '15m': 900000,
      '1h': 3600000, '4h': 14400000, '1d': 86400000, '1w': 604800000,
    };
    const interval = intervalMs[timeframe] || 86400000;
    const startMs = Date.now() - interval * limit * 1.5; // extra buffer
    const start = new Date(startMs).toISOString();

    const data = await this.dataRequest<{
      bars: {
        t: string;  // timestamp
        o: number;  // open
        h: number;  // high
        l: number;  // low
        c: number;  // close
        v: number;  // volume
        n: number;  // trade count
        vw: number; // vwap
      }[];
      next_page_token: string | null;
    }>(`/v2/stocks/${symbol}/bars?timeframe=${alpacaTimeframe}&start=${start}&end=${end}&limit=${limit}&adjustment=raw`);

    return (data.bars || []).map((bar) => ({
      timestamp: new Date(bar.t).getTime(),
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
      volume: bar.v,
    }));
  }

  // ----------------------------------------------------------
  // Latest Price
  // ----------------------------------------------------------

  async getPrice(symbol: string): Promise<number> {
    const data = await this.dataRequest<{
      symbol: string;
      bid_price: number;
      ask_price: number;
      last_trade_price: number;
    }>(`/v2/stocks/${symbol}/quotes/latest`);

    // Use mid-price of bid/ask, fallback to last trade
    if (data.bid_price && data.ask_price) {
      return (data.bid_price + data.ask_price) / 2;
    }
    return data.last_trade_price;
  }

  // ----------------------------------------------------------
  // Internal helpers
  // ----------------------------------------------------------

  private async request<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        ...this.headers,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new AlpacaError(res.status, `Alpaca API error: ${res.status} ${body}`, path);
    }
    return res.json() as Promise<T>;
  }

  private async postRequest<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        ...this.headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new AlpacaError(res.status, `Alpaca API error: ${res.status} ${text}`, path);
    }
    return res.json() as Promise<T>;
  }

  private async deleteRequest<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: {
        ...this.headers,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new AlpacaError(res.status, `Alpaca API error: ${res.status} ${text}`, path);
    }
    return res.json() as Promise<T>;
  }

  private async dataRequest<T>(path: string): Promise<T> {
    const url = `${this.dataUrl}${path}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        ...this.headers,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new AlpacaError(res.status, `Alpaca Data API error: ${res.status} ${body}`, path);
    }
    return res.json() as Promise<T>;
  }

  // Map our order types to Alpaca's order types
  private mapOrderType(type: OrderType): string {
    switch (type) {
      case 'market': return 'market';
      case 'limit': return 'limit';
      case 'stop': return 'stop';
      case 'stop_limit': return 'stop_limit';
    }
  }

  private reverseMapOrderType(type: string): OrderType {
    switch (type) {
      case 'market': return 'market';
      case 'limit': return 'limit';
      case 'stop': return 'stop';
      case 'stop_limit': return 'stop_limit';
      default: return 'market';
    }
  }

  private mapOrderStatus(status: string): BrokerOrderResult['status'] {
    switch (status) {
      case 'new':
      case 'accepted':
        return 'pending';
      case 'filled':
      case 'partially_filled':
        return status as 'filled' | 'partially_filled';
      case 'canceled':
      case 'cancelled':
        return 'cancelled';
      case 'rejected':
        return 'rejected';
      default:
        return 'pending';
    }
  }
}

// ----------------------------------------------------------
// Custom Error
// ----------------------------------------------------------

export class AlpacaError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public path: string,
  ) {
    super(message);
    this.name = 'AlpacaError';
  }
}
