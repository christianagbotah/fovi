// ============================================================
// GenericRESTBroker — No-code broker for any REST API exchange
// ============================================================
// Admin configures broker from UI: base URL, auth type, endpoints.
// This broker reads the BrokerProvider record from DB and uses
// the configuration to connect to any REST API broker.
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

// ----------------------------------------------------------
// Types
// ----------------------------------------------------------

export interface GenericBrokerProviderConfig {
  code: string;
  authType: 'none' | 'api_key_header' | 'api_key_query' | 'hmac_sha256' | 'hmac_sha256_base64' | 'bearer';
  apiKeyHeader: string;        // e.g. 'X-MBX-APIKEY'
  symbolFormat: 'pair' | 'slash' | 'dot' | 'underscore' | 'dash';
  liveBaseUrl: string;
  testnetBaseUrl: string;
  customEndpoints: GenericEndpoints;
}

export interface GenericEndpoints {
  account?: string;           // e.g. '/api/v3/account'
  positions?: string;         // e.g. '/api/v3/positionRisk'
  placeOrder?: string;        // e.g. '/api/v3/order'
  closePosition?: string;     // e.g. '/api/v3/order' (uses opposite side)
  candles?: string;           // e.g. '/api/v3/klines'
  price?: string;             // e.g. '/api/v3/ticker/price'
  cancelOrder?: string;       // e.g. '/api/v3/order'
  // Response path mappings (dot notation)
  responsePaths?: {
    account?: {
      accountId?: string;    // e.g. 'accountId' or 'data.accountId'
      balance?: string;      // e.g. 'totalWalletBalance' or 'data.balance'
      currency?: string;
      buyingPower?: string;
      dayPnl?: string;
    };
    positions?: {
      list?: string;          // e.g. 'data' or '' (root array)
      symbol?: string;        // e.g. 'symbol'
      qty?: string;          // e.g. 'positionAmt'
      avgEntryPrice?: string; // e.g. 'entryPrice'
      currentPrice?: string;  // e.g. 'markPrice'
      unrealizedPnl?: string; // e.g. 'unPnl'
      side?: string;         // e.g. '' (derive from qty sign)
    };
    price?: {
      value?: string;        // e.g. 'price' or 'data.price'
    };
    candles?: {
      list?: string;          // e.g. '' (root array)
      timestamp?: string;     // e.g. '0' (array index) or 'openTime'
      open?: string;          // e.g. '1' or 'open'
      high?: string;          // e.g. '2' or 'high'
      low?: string;           // e.g. '3' or 'low'
      close?: string;         // e.g. '4' or 'close'
      volume?: string;        // e.g. '5' or 'volume'
    };
    placeOrder?: {
      orderId?: string;
      filledQty?: string;
      filledPrice?: string;
      status?: string;
    };
  };
}

// ----------------------------------------------------------
// Default endpoint templates for common exchange patterns
// ----------------------------------------------------------

const DEFAULT_ENDPOINTS: GenericEndpoints = {
  account: '/api/v3/account',
  positions: '/api/v3/positionRisk',
  placeOrder: '/api/v3/order',
  candles: '/api/v3/klines',
  price: '/api/v3/ticker/price',
  cancelOrder: '/api/v3/order',
  responsePaths: {
    account: {
      accountId: 'accountId',
      balance: 'totalWalletBalance',
      currency: 'data.quoteAsset',
      buyingPower: 'availableBalance',
      dayPnl: '',
    },
    positions: {
      list: '',
      symbol: 'symbol',
      qty: 'positionAmt',
      avgEntryPrice: 'entryPrice',
      currentPrice: 'markPrice',
      unrealizedPnl: 'unPnl',
      side: '',
    },
    price: { value: 'price' },
    candles: {
      list: '',
      timestamp: '0',
      open: '1',
      high: '2',
      low: '3',
      close: '4',
      volume: '5',
    },
    placeOrder: {
      orderId: 'orderId',
      filledQty: 'filled',
      filledPrice: 'fills.0.price',
      status: 'status',
    },
  },
};

/** Cache for provider configs fetched from DB */
let providerConfigCache: Map<string, GenericBrokerProviderConfig> = new Map();
let providerConfigCacheTime: number = 0;
const CACHE_TTL = 60_000; // 1 minute

/**
 * Get provider config from DB, with caching.
 * Falls back to defaults if DB is unavailable.
 */
async function getProviderConfig(code: string): Promise<GenericBrokerProviderConfig | null> {
  try {
    const now = Date.now();
    if (now - providerConfigCacheTime > CACHE_TTL) {
      providerConfigCache.clear();
      providerConfigCacheTime = now;
    }
    const cached = providerConfigCache.get(code);
    if (cached) return cached;

    // Dynamic import to avoid circular dependency and keep it server-only
    const { db } = await import('@/lib/db');
    const provider = await db.brokerProvider.findUnique({ where: { code } });
    if (!provider) return null;

    const config: GenericBrokerProviderConfig = {
      code: provider.code,
      authType: (provider.authType as any) || 'none',
      apiKeyHeader: provider.apiKeyHeader || '',
      symbolFormat: (provider.symbolFormat as any) || 'pair',
      liveBaseUrl: provider.liveBaseUrl || '',
      testnetBaseUrl: provider.testnetBaseUrl || '',
      customEndpoints: provider.customEndpoints
        ? JSON.parse(provider.customEndpoints)
        : {},
    };

    providerConfigCache.set(code, config);
    return config;
  } catch {
    return null;
  }
}

// ----------------------------------------------------------
// Utility: resolve a value from a dot-notation path
// ----------------------------------------------------------

function resolvePath(obj: any, path: string): any {
  if (!path) return obj;
  // Handle array index paths like '0', '1'
  if (/^\d+$/.test(path)) {
    return Array.isArray(obj) ? obj[parseInt(path)] : undefined;
  }
  return path.split('.').reduce((acc: any, key: string) => {
    if (acc === null || acc === undefined) return undefined;
    // Handle array index in path like 'fills.0'
    if (/^\d+$/.test(key) && Array.isArray(acc)) {
      return acc[parseInt(key)];
    }
    return acc[key];
  }, obj);
}

function safeNum(v: any): number {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

// ----------------------------------------------------------
// Symbol formatting
// ----------------------------------------------------------

function formatSymbol(symbol: string, format: string): string {
  // Try to split the symbol into base/quote
  // Common patterns: BTCUSDT, BTC/USDT, BTC.USDT, BTC_USDT
  let base = symbol;
  let quote = 'USDT';

  // Try to find quote currency in the symbol
  const quotes = ['USDT', 'USDC', 'BUSD', 'USD', 'EUR', 'GBP', 'BTC', 'ETH', 'BNB'];
  for (const q of quotes) {
    if (symbol.endsWith(q) && symbol.length > q.length) {
      base = symbol.slice(0, -q.length);
      quote = q;
      break;
    }
  }

  switch (format) {
    case 'slash': return `${base}/${quote}`;
    case 'dot': return `${base}.${quote}`;
    case 'underscore': return `${base}_${quote}`;
    case 'dash': return `${base}-${quote}`;
    default: return `${base}${quote}`; // 'pair' — concatenated
  }
}

// ----------------------------------------------------------
// HMAC-SHA256 signing
// ----------------------------------------------------------

async function hmacSign(message: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const msgData = encoder.encode(message);
  const key = await crypto.subtle.importKey(
    'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, msgData);
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmacSignBase64(message: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const msgData = encoder.encode(message);
  const key = await crypto.subtle.importKey(
    'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, msgData);
  return btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(sig))));
}

// ----------------------------------------------------------
// GenericRESTBroker
// ----------------------------------------------------------

export class GenericRESTBroker implements IBroker {
  private providerCode: string;
  private apiKey?: string;
  private apiSecret?: string;
  private passphrase?: string;
  private isDemo: boolean;
  private config: GenericBrokerProviderConfig | null = null;
  private configPromise: Promise<GenericBrokerProviderConfig | null>;

  constructor(config: BrokerConfig) {
    this.providerCode = config.provider;
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
    this.passphrase = config.passphrase;
    this.isDemo = config.isDemo;
    this.configPromise = getProviderConfig(config.provider);
  }

  private async ensureConfig(): Promise<GenericBrokerProviderConfig> {
    if (this.config) return this.config;
    const c = await this.configPromise;
    if (!c || !c.liveBaseUrl) {
      throw new Error(
        `Generic broker '${this.providerCode}' is not fully configured. ` +
        `Admin must set the Live Base URL and auth settings.`
      );
    }
    this.config = c;
    return c;
  }

  private get baseUrl(): string {
    if (!this.config) return '';
    return (this.isDemo && this.config.testnetBaseUrl)
      ? this.config.testnetBaseUrl
      : this.config.liveBaseUrl;
  }

  private get endpoints(): GenericEndpoints {
    if (!this.config) return DEFAULT_ENDPOINTS;
    return { ...DEFAULT_ENDPOINTS, ...this.config.customEndpoints };
  }

  // ----------------------------------------------------------
  // Auth
  // ----------------------------------------------------------

  private async buildAuthHeaders(
    method: string,
    path: string,
    queryParams?: Record<string, string>,
    body?: string,
  ): Promise<Record<string, string>> {
    const cfg = await this.ensureConfig();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    switch (cfg.authType) {
      case 'api_key_header':
        if (this.apiKey && cfg.apiKeyHeader) {
          headers[cfg.apiKeyHeader] = this.apiKey;
        }
        break;

      case 'api_key_query':
        if (this.apiKey) {
          queryParams = { ...queryParams, apiKey: this.apiKey };
        }
        break;

      case 'bearer':
        if (this.apiKey) {
          headers['Authorization'] = `Bearer ${this.apiKey}`;
        }
        break;

      case 'hmac_sha256': {
        if (this.apiKey && cfg.apiKeyHeader) {
          headers[cfg.apiKeyHeader] = this.apiKey;
        }
        if (this.apiSecret) {
          const qs = queryParams ? '?' + new URLSearchParams(queryParams).toString() : '';
          const payload = body || '';
          const message = `${method}\n${path}${qs}\n${payload}`;
          const ts = Date.now().toString();
          headers['X-TIMESTAMP'] = ts;
          if (this.passphrase) headers['X-PASSPHRASE'] = this.passphrase;
          const sig = await hmacSign(message, this.apiSecret);
          headers['X-SIGNATURE'] = sig;
        }
        break;
      }

      case 'hmac_sha256_base64': {
        if (this.apiKey && cfg.apiKeyHeader) {
          headers[cfg.apiKeyHeader] = this.apiKey;
        }
        if (this.apiSecret) {
          const ts = Date.now().toString();
          headers['OK-ACCESS-TIMESTAMP'] = ts;
          if (this.passphrase) headers['OK-PASSPHRASE'] = this.passphrase;
          const prehash = ts + method.toUpperCase() + path + (body || '');
          const sig = await hmacSignBase64(prehash, this.apiSecret);
          headers['OK-ACCESS-SIGN'] = sig;
        }
        break;
      }

      default:
        break;
    }

    return headers;
  }

  // ----------------------------------------------------------
  // HTTP helper
  // ----------------------------------------------------------

  private async request<T = any>(
    method: string,
    path: string,
    options?: {
      queryParams?: Record<string, string>;
      body?: any;
      timeout?: number;
    },
  ): Promise<T> {
    const cfg = await this.ensureConfig();
    const base = this.baseUrl;
    const qp = options?.queryParams;
    const bodyStr = options?.body ? JSON.stringify(options.body) : undefined;
    const headers = await this.buildAuthHeaders(method, path, qp, bodyStr);

    let url = `${base}${path}`;
    if (qp && Object.keys(qp).length > 0) {
      url += '?' + new URLSearchParams(qp).toString();
    }

    const res = await fetch(url, {
      method,
      headers,
      body: bodyStr,
      signal: AbortSignal.timeout(options?.timeout || 15_000),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(
        `GenericREST ${cfg.code} ${method} ${path} → ${res.status}: ${errBody.slice(0, 200)}`
      );
    }

    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return text as unknown as T;
    }
  }

  // ----------------------------------------------------------
  // IBroker implementation
  // ----------------------------------------------------------

  async getAccountInfo(): Promise<BrokerAccountInfo> {
    const cfg = await this.ensureConfig();
    const ep = this.endpoints;
    if (!ep.account) throw new Error(`Account endpoint not configured for ${cfg.code}`);

    await brokerRateLimit(cfg.code);
    const data = await this.request('GET', ep.account);
    const paths = ep.responsePaths?.account || {};

    // Try to find a USDT or USD balance
    let balance = safeNum(resolvePath(data, paths.balance || 'totalWalletBalance'));
    if (balance === 0) {
      // Try to find balance in balances array
      const balances = data.balances || data.data?.balances || [];
      for (const b of balances) {
        if (b.asset === 'USDT' || b.asset === 'USD' || b.asset === 'BUSD') {
          balance = safeNum(b.free) + safeNum(b.locked);
          break;
        }
      }
    }

    return {
      accountId: String(resolvePath(data, paths.accountId || 'accountId') || cfg.code),
      balance,
      currency: String(resolvePath(data, paths.currency || '') || 'USD'),
      buyingPower: safeNum(resolvePath(data, paths.buyingPower || 'availableBalance')) || balance,
      dayPnl: safeNum(resolvePath(data, paths.dayPnl || '')),
    };
  }

  async getPositions(): Promise<BrokerPosition[]> {
    const cfg = await this.ensureConfig();
    const ep = this.endpoints;
    if (!ep.positions) throw new Error(`Positions endpoint not configured for ${cfg.code}`);

    await brokerRateLimit(cfg.code);
    const data = await this.request('GET', ep.positions);
    const paths = ep.responsePaths?.positions || {};

    let list: any[];
    const listPath = paths.list || '';
    if (listPath) {
      list = resolvePath(data, listPath) || [];
    } else {
      list = Array.isArray(data) ? data : (data.data || []);
    }

    return list
      .map((p: any) => {
        const qty = safeNum(resolvePath(p, paths.qty || 'positionAmt'));
        if (Math.abs(qty) < 1e-10) return null; // skip zero positions
        return {
          symbol: String(resolvePath(p, paths.symbol || 'symbol')),
          qty: Math.abs(qty),
          avgEntryPrice: safeNum(resolvePath(p, paths.avgEntryPrice || 'entryPrice')),
          currentPrice: safeNum(resolvePath(p, paths.currentPrice || 'markPrice')) || safeNum(resolvePath(p, paths.avgEntryPrice || 'entryPrice')),
          unrealizedPnl: safeNum(resolvePath(p, paths.unrealizedPnl || 'unPnl')),
          side: (qty > 0 ? 'long' : 'short') as Side,
        };
      })
      .filter(Boolean) as BrokerPosition[];
  }

  async placeOrder(params: {
    symbol: string; side: OrderSide; type: OrderType;
    qty: number; limitPrice?: number; stopPrice?: number;
  }): Promise<BrokerOrderResult> {
    const cfg = await this.ensureConfig();
    const ep = this.endpoints;
    if (!ep.placeOrder) throw new Error(`Place order endpoint not configured for ${cfg.code}`);

    await brokerRateLimit(cfg.code);

    const sym = formatSymbol(params.symbol, cfg.symbolFormat);

    const body: Record<string, any> = {
      symbol: sym,
      side: params.side.toUpperCase(),
      type: params.type === 'market' ? 'MARKET'
        : params.type === 'limit' ? 'LIMIT'
        : params.type === 'stop' ? 'STOP_MARKET'
        : 'STOP_LIMIT',
      quantity: params.qty,
    };

    if (params.type === 'limit' || params.type === 'stop_limit') {
      body.price = params.limitPrice;
    }
    if (params.type === 'stop' || params.type === 'stop_limit') {
      body.stopPrice = params.stopPrice;
    }

    // For query-param auth, we need to pass as queryParams instead
    const data = await this.request('POST', ep.placeOrder, { body });
    const paths = ep.responsePaths?.placeOrder || {};

    return {
      orderId: String(resolvePath(data, paths.orderId || 'orderId') || 'GEN_' + Date.now()),
      symbol: params.symbol,
      side: params.side,
      type: params.type,
      qty: params.qty,
      filledQty: safeNum(resolvePath(data, paths.filledQty || 'filled')) || 0,
      filledPrice: resolvePath(data, paths.filledPrice || 'avgPrice')
        ? safeNum(resolvePath(data, paths.filledPrice || 'avgPrice'))
        : null,
      status: 'pending',
      timestamp: new Date().toISOString(),
    };
  }

  async closePosition(symbol: string): Promise<BrokerOrderResult> {
    const positions = await this.getPositions();
    const pos = positions.find(p => p.symbol === symbol);
    if (!pos) {
      return {
        orderId: 'REJ_generic',
        symbol,
        side: 'sell', type: 'market',
        qty: 0, filledQty: 0, filledPrice: null,
        status: 'rejected',
        timestamp: new Date().toISOString(),
      };
    }
    const closeSide: OrderSide = pos.side === 'long' ? 'sell' : 'buy';
    return this.placeOrder({
      symbol, side: closeSide, type: 'market', qty: pos.qty,
    });
  }

  async getCandles(symbol: string, timeframe: string, limit: number = 100): Promise<CandleData[]> {
    const cfg = await this.ensureConfig();
    const ep = this.endpoints;
    if (!ep.candles) throw new Error(`Candles endpoint not configured for ${cfg.code}`);

    await brokerRateLimit(cfg.code);

    const sym = formatSymbol(symbol, cfg.symbolFormat);
    const intervalMap: Record<string, string> = {
      '1m': '1m', '5m': '5m', '15m': '15m',
      '1h': '1h', '4h': '4h', '1d': '1d', '1w': '1w',
    };

    const data = await this.request('GET', ep.candles, {
      queryParams: {
        symbol: sym,
        interval: intervalMap[timeframe] || '1h',
        limit: String(limit),
      },
    });

    const paths = ep.responsePaths?.candles || {};
    let list: any[];
    const listPath = paths.list || '';
    if (listPath) {
      list = resolvePath(data, listPath) || [];
    } else {
      list = Array.isArray(data) ? data : [];
    }

    // Binance returns arrays like [ts, open, high, low, close, vol, ...]
    // Object-style responses use named keys
    return list.map((k: any) => {
      const isArr = Array.isArray(k);
      return {
        timestamp: isArr
          ? Number(k[parseInt(paths.timestamp || '0')] ?? 0)
          : Number(resolvePath(k, paths.timestamp || 'time') ?? 0),
        open: safeNum(isArr ? k[parseInt(paths.open || '1')] : resolvePath(k, paths.open || 'open')),
        high: safeNum(isArr ? k[parseInt(paths.high || '2')] : resolvePath(k, paths.high || 'high')),
        low: safeNum(isArr ? k[parseInt(paths.low || '3')] : resolvePath(k, paths.low || 'low')),
        close: safeNum(isArr ? k[parseInt(paths.close || '4')] : resolvePath(k, paths.close || 'close')),
        volume: safeNum(isArr ? k[parseInt(paths.volume || '5')] : resolvePath(k, paths.volume || 'volume')),
      };
    });
  }

  async getPrice(symbol: string): Promise<number> {
    const cfg = await this.ensureConfig();
    const ep = this.endpoints;
    if (!ep.price) throw new Error(`Price endpoint not configured for ${cfg.code}`);

    await brokerRateLimit(cfg.code);

    const sym = formatSymbol(symbol, cfg.symbolFormat);
    const data = await this.request('GET', ep.price, {
      queryParams: { symbol: sym },
    });

    const paths = ep.responsePaths?.price || {};
    const value = resolvePath(data, paths.value || 'price');
    return safeNum(value);
  }

  async cancelOrder(symbol: string, orderId: string): Promise<void> {
    const cfg = await this.ensureConfig();
    const ep = this.endpoints;
    if (!ep.cancelOrder) throw new Error(`Cancel order endpoint not configured for ${cfg.code}`);

    await brokerRateLimit(cfg.code);

    const sym = formatSymbol(symbol, cfg.symbolFormat);
    await this.request('DELETE', ep.cancelOrder, {
      queryParams: { symbol: sym, orderId },
    });
  }
}

// ----------------------------------------------------------
// Built-in provider codes that have dedicated implementations
// ----------------------------------------------------------

export const BUILTIN_PROVIDERS = new Set([
  'demo', 'alpaca', 'binance', 'okx', 'bybit', 'bitget', 'mt5',
]);

/**
 * Check if a provider code has a built-in broker implementation.
 */
export function isBuiltinProvider(code: string): boolean {
  return BUILTIN_PROVIDERS.has(code);
}

/**
 * Check if a provider code can work as a generic REST broker
 * (has a live base URL configured).
 */
export async function isGenericRESTProvider(code: string): Promise<boolean> {
  if (isBuiltinProvider(code)) return false;
  try {
    const { db } = await import('@/lib/db');
    const p = await db.brokerProvider.findUnique({ where: { code } });
    return !!(p && p.liveBaseUrl && p.authType && p.authType !== 'none');
  } catch {
    return false;
  }
}
