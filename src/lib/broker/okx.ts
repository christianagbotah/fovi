// ============================================================
// Fovi OKX Broker Client - Spot & Derivatives via OKX API v5
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

// OKX API v5 base URL (same for live and demo — demo is activated via header)
const OKX_BASE_URL = 'https://www.okx.com/api/v5';

// Our timeframe → OKX bar size
// OKX supports: 1m, 3m, 5m, 15m, 30m, 1H, 2H, 4H, 6H, 12H, 1D, 1W, 1M, ...
const INTERVAL_MAP: Record<string, string> = {
  '1m': '1m',
  '3m': '3m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1h': '1H',
  '4h': '4H',
  '1d': '1D',
  '1w': '1W',
};

/**
 * OkxBroker implements the IBroker interface using OKX REST API v5.
 * Supports both demo (simulated trading) and live trading for crypto.
 *
 * Authentication — HMAC-SHA256 signing via Web Crypto API:
 *   prehash = timestamp + METHOD + requestPath + body
 *   signature = base64(HMAC-SHA256(secret, prehash))
 *   Headers:
 *     OK-ACCESS-KEY, OK-ACCESS-SIGN, OK-ACCESS-TIMESTAMP, OK-ACCESS-PASSPHRASE
 *
 * Demo trading — activated via the `x-simulated-trading: 1` header on every
 * request, as documented by OKX. The base URL is unchanged.
 *
 * Passphrase — OKX requires an API passphrase in addition to key/secret.
 *   • Provide via `config.passphrase`, OR
 *   • Encode as `secret|passphrase` in the `apiSecret` field (so the existing
 *     DB schema that only stores apiKey + apiSecret can be reused).
 *
 * API Docs: https://www.okx.com/docs-v5/en/
 */
export class OkxBroker implements IBroker {
  private baseUrl: string;
  private apiKey: string;
  private apiSecret: string;
  private passphrase: string;
  private isDemo: boolean;

  constructor(config: BrokerConfig) {
    if (!config.apiKey || !config.apiSecret) {
      throw new Error('OKX broker requires apiKey and apiSecret');
    }
    this.baseUrl = OKX_BASE_URL;
    this.apiKey = config.apiKey;
    this.isDemo = config.isDemo;

    // OKX requires a passphrase. Accept it from config.passphrase,
    // or parse from apiSecret if it contains a `|` delimiter (secret|passphrase).
    if (config.passphrase) {
      this.apiSecret = config.apiSecret;
      this.passphrase = config.passphrase;
    } else if (config.apiSecret.includes('|')) {
      const idx = config.apiSecret.indexOf('|');
      this.apiSecret = config.apiSecret.slice(0, idx);
      this.passphrase = config.apiSecret.slice(idx + 1);
    } else {
      throw new Error(
        'OKX broker requires a passphrase. Provide it via config.passphrase, ' +
        'or encode as "secret|passphrase" in the apiSecret field.',
      );
    }
  }

  // ----------------------------------------------------------
  // Account
  // ----------------------------------------------------------

  async getAccountInfo(): Promise<BrokerAccountInfo> {
    await brokerRateLimit('okx');
    const data = await this.signedRequest<OkxResponse<OkxAccountBalance[]>>(
      'GET',
      '/account/balance',
    );

    const item = data.data?.[0];
    if (!item) {
      throw new OkxError(404, 'OKX returned no account balance data', '/account/balance');
    }

    // totalEq is the USD-equivalent total equity across all assets.
    const balance = parseFloat(item.totalEq) || 0;

    return {
      accountId: item.acctLv ? `okx-lv${item.acctLv}` : 'okx',
      balance,
      currency: 'USD',
      buyingPower: balance, // total equity is a safe upper bound for spot
      dayPnl: 0, // OKX doesn't expose "day PnL" directly on /account/balance
    };
  }

  // ----------------------------------------------------------
  // Positions (futures / swap positions; spot holdings have posSide=net)
  // ----------------------------------------------------------

  async getPositions(): Promise<BrokerPosition[]> {
    await brokerRateLimit('okx');
    const data = await this.signedRequest<OkxResponse<OkxPosition[]>>(
      'GET',
      '/account/positions',
    );

    const positions: BrokerPosition[] = [];
    for (const p of data.data || []) {
      const qty = parseFloat(p.pos);
      if (qty === 0) continue;

      // OKX position side semantics:
      //   • posSide === 'short' → short
      //   • posSide === 'long'  → long
      //   • posSide === 'net'   → derive from sign of `pos`
      const isShort =
        p.posSide === 'short' ||
        (p.posSide === 'net' && qty < 0);
      const side: Side = isShort ? 'short' : 'long';

      positions.push({
        symbol: this.fromOkxInstId(p.instId),
        qty: Math.abs(qty),
        avgEntryPrice: parseFloat(p.avgPx) || 0,
        currentPrice: parseFloat(p.last) || 0,
        unrealizedPnl: parseFloat(p.upl) || 0,
        side,
      });
    }

    return positions;
  }

  // ----------------------------------------------------------
  // Orders (spot trading, tdMode=cash by default)
  // ----------------------------------------------------------

  async placeOrder(params: {
    symbol: string;
    side: OrderSide;
    type: OrderType;
    qty: number;
    limitPrice?: number;
    stopPrice?: number;
  }): Promise<BrokerOrderResult> {
    const instId = this.toOkxInstId(params.symbol);

    const body: Record<string, unknown> = {
      instId,
      tdMode: 'cash', // Spot trading
      side: params.side, // 'buy' | 'sell'
      ordType: this.mapOrderType(params.type),
      sz: String(params.qty),
    };

    if (params.type === 'limit' || params.type === 'stop_limit') {
      if (params.limitPrice !== undefined) {
        body.px = String(params.limitPrice);
      }
    }
    if (params.type === 'stop' || params.type === 'stop_limit') {
      if (params.stopPrice !== undefined) {
        // OKX stop-loss trigger price field
        body.slTriggerPx = String(params.stopPrice);
      }
    }

    await brokerRateLimit('okx');
    const data = await this.signedRequest<OkxResponse<OkxOrderResult[]>>(
      'POST',
      '/trade/order',
      JSON.stringify(body),
    );

    const result = data.data?.[0];
    if (!result || result.sCode !== '0') {
      throw new OkxError(
        400,
        `OKX order rejected: ${result?.sMsg || data.msg || 'unknown error'}`,
        '/trade/order',
      );
    }

    // OKX POST /trade/order returns the ordId only; fill details require a
    // follow-up GET /trade/order. For now we report pending; the order
    // engine will sync fill state on the next polling cycle.
    return {
      orderId: result.ordId || 'OKX_UNKNOWN',
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
    const positions = await this.getPositions();
    const pos = positions.find((p) => p.symbol === symbol);
    if (!pos || pos.qty <= 0) {
      return {
        orderId: 'REJ_okx',
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

    // To close a position, send an order on the opposite side.
    const closeSide: OrderSide = pos.side === 'long' ? 'sell' : 'buy';
    return this.placeOrder({
      symbol,
      side: closeSide,
      type: 'market',
      qty: pos.qty,
    });
  }

  async cancelOrder(symbol: string, orderId: string): Promise<void> {
    const instId = this.toOkxInstId(symbol);
    const body = JSON.stringify({ instId, ordId: orderId });
    await brokerRateLimit('okx');
    await this.signedRequest<OkxResponse<OkxOrderResult[]>>(
      'POST',
      '/trade/cancel-order',
      body,
    );
  }

  // ----------------------------------------------------------
  // Market Data (PUBLIC endpoint, no signing required)
  // ----------------------------------------------------------

  async getCandles(symbol: string, timeframe: string, limit: number = 100): Promise<CandleData[]> {
    await brokerRateLimit('okx');
    const interval = INTERVAL_MAP[timeframe] || '1H';
    const instId = this.toOkxInstId(symbol);
    const params = new URLSearchParams({
      instId,
      bar: interval,
      limit: Math.min(limit, 300).toString(), // OKX max is 300
    });

    const url = `${this.baseUrl}/market/candles?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new OkxError(res.status, `OKX candles error: ${res.status} ${body}`, '/market/candles');
    }

    const data = (await res.json()) as OkxResponse<string[][]>;
    if (data.code !== '0') {
      throw new OkxError(500, `OKX candles API error: ${data.msg}`, '/market/candles');
    }

    // OKX candle row: [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm]
    // Returned newest-first; reverse to oldest-first for charting.
    const candles = (data.data || [])
      .map((k) => ({
        timestamp: parseInt(k[0], 10),
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5] || '0'),
      }))
      .reverse();

    return candles;
  }

  // ----------------------------------------------------------
  // Latest Price (PUBLIC endpoint, no signing required)
  // ----------------------------------------------------------

  async getPrice(symbol: string): Promise<number> {
    await brokerRateLimit('okx');
    const instId = this.toOkxInstId(symbol);
    const url = `${this.baseUrl}/market/ticker?instId=${encodeURIComponent(instId)}`;
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new OkxError(res.status, `OKX ticker error: ${res.status} ${body}`, '/market/ticker');
    }

    const data = (await res.json()) as OkxResponse<{ last: string }[]>;
    if (data.code !== '0' || !data.data?.length) {
      throw new OkxError(404, `OKX ticker not found for ${symbol}`, '/market/ticker');
    }

    return parseFloat(data.data[0].last);
  }

  // ----------------------------------------------------------
  // HMAC-SHA256 Signing — Base64 output (OKX requirement)
  // ----------------------------------------------------------

  private async sign(prehash: string): Promise<string> {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(this.apiSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(prehash));
    // OKX expects Base64 (unlike Binance which uses hex).
    return this.base64Encode(new Uint8Array(signature));
  }

  private base64Encode(bytes: Uint8Array): string {
    // Prefer Node's Buffer when available (server runtime).
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(bytes).toString('base64');
    }
    // Browser / Edge fallback.
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  // ----------------------------------------------------------
  // Signed Request Helper
  // ----------------------------------------------------------

  private async signedRequest<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: string,
  ): Promise<T> {
    const timestamp = new Date().toISOString();
    // OKX prehash = timestamp + METHOD + requestPath + body
    // requestPath MUST include /api/v5 prefix (per OKX docs)
    const requestPath = `/api/v5${path}`;
    const prehash = `${timestamp}${method.toUpperCase()}${requestPath}${body || ''}`;
    const signature = await this.sign(prehash);

    const headers: Record<string, string> = {
      'OK-ACCESS-KEY': this.apiKey,
      'OK-ACCESS-SIGN': signature,
      'OK-ACCESS-TIMESTAMP': timestamp,
      'OK-ACCESS-PASSPHRASE': this.passphrase,
      'Content-Type': 'application/json',
    };

    // OKX demo trading is activated via the `x-simulated-trading: 1` header.
    // The base URL stays the same in demo mode.
    if (this.isDemo) {
      headers['x-simulated-trading'] = '1';
    }

    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method,
      headers,
      body: body || undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new OkxError(res.status, `OKX API error: ${res.status} ${text}`, path);
    }

    const json = (await res.json()) as OkxResponse<unknown>;
    if (json.code !== '0') {
      // Provide user-friendly messages for common OKX error codes
      let userMsg = `OKX API error: ${json.msg} (code ${json.code})`;
      if (json.code === '50101') {
        userMsg = 'API key does not match environment. If using a live API key, make sure "Live Trading" is selected (not "Demo / Paper"). If using a demo key, select "Demo / Paper".';
      } else if (json.code === '50113') {
        userMsg = 'Invalid API signature. Please double-check your API Secret and Passphrase are correct.';
      } else if (json.code === '50111') {
        userMsg = 'Invalid API key. Please check your API Key is correct.';
      } else if (json.code === '50102') {
        userMsg = 'API key passphrase is incorrect. Please verify your Passphrase.';
      }
      throw new OkxError(res.status, userMsg, path);
    }
    return json as T;
  }

  // ----------------------------------------------------------
  // Symbol & Order-Type Mapping
  // ----------------------------------------------------------

  /**
   * Convert our symbol format (BTCUSDT) to OKX instId (BTC-USDT).
   * OKX uses '-' as the separator between base and quote.
   * If the input already contains '-', assume it's already in OKX format.
   */
  private toOkxInstId(symbol: string): string {
    if (symbol.includes('-')) return symbol;
    // Try common quote currencies (longest first to avoid mismatch).
    const quotes = ['USDT', 'USDC', 'USD', 'BTC', 'ETH'];
    for (const q of quotes) {
      if (symbol.endsWith(q)) {
        return `${symbol.slice(0, -q.length)}-${q}`;
      }
    }
    return symbol;
  }

  /** Convert OKX instId (BTC-USDT) back to our format (BTCUSDT). */
  private fromOkxInstId(instId: string): string {
    return instId.replace(/-/g, '');
  }

  private mapOrderType(type: OrderType): string {
    switch (type) {
      case 'market': return 'market';
      case 'limit': return 'limit';
      case 'stop': return 'conditional';       // OKX stop-loss (market)
      case 'stop_limit': return 'conditional'; // OKX stop-loss (limit)
    }
  }
}

// ----------------------------------------------------------
// OKX Response Types
// ----------------------------------------------------------

interface OkxResponse<T> {
  code: string;   // "0" = success, anything else = error
  msg: string;
  data: T;
}

interface OkxAccountBalance {
  totalEq: string;     // Total USD-equivalent equity
  upl?: string;        // Unrealized PnL
  acctLv?: string;     // Account mode level (1=spot, 2=spot+futures, 3=cross, 4=portfolio)
  details?: Array<{
    ccy: string;
    cashBal: string;
    eq: string;
  }>;
}

interface OkxPosition {
  instId: string;
  pos: string;       // Quantity (negative for short in net mode)
  posSide: string;   // long | short | net
  avgPx: string;     // Average entry price
  last: string;      // Latest price
  upl: string;       // Unrealized PnL
}

interface OkxOrderResult {
  ordId: string;
  sCode: string;     // Sub-code ("0" = success)
  sMsg: string;      // Sub-message
}

// ----------------------------------------------------------
// Custom Error
// ----------------------------------------------------------

export class OkxError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public path: string,
  ) {
    super(message);
    this.name = 'OkxError';
  }
}
