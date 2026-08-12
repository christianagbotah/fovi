// ============================================================
// Fovi Demo/Simulated Broker - Full Trading Simulation
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
import { randomWalkPrice } from '../market-sim';

// In-memory demo state per account
const demoAccounts = new Map<string, {
  balance: number;
  positions: Map<string, DemoPosition>;
  orderIdCounter: number;
}>();

interface DemoPosition {
  symbol: string;
  side: Side;
  qty: number;
  avgEntryPrice: number;
  realizedPnl: number;
}

function getAccount(accountId: string) {
  if (!demoAccounts.has(accountId)) {
    demoAccounts.set(accountId, {
      balance: 100000,
      positions: new Map(),
      orderIdCounter: 1000,
    });
  }
  return demoAccounts.get(accountId)!;
}

// ============================================================
// Master Symbol Registry
// ============================================================
// These are the DEFAULT demo/base prices. Real prices from
// CoinGecko, Finnhub, ExchangeRate-API, and metals.live override
// these at runtime. Add any symbol here and it will appear in
// the demo market overview and be tradeable in demo mode.
// For real brokers, ANY symbol the broker supports is tradeable
// — this list only controls the demo experience.
// ============================================================

const BASE_PRICES: Record<string, number> = {
  // ── US Stocks (20) ──
  AAPL: 195.5, GOOGL: 178.2, MSFT: 445.8, AMZN: 198.3, NVDA: 920.5,
  TSLA: 245.6, META: 530.2, NFLX: 720.1, AMD: 178.5, INTC: 32.4,
  CRM: 272.0, ORCL: 145.0, JPM: 205.0, V: 285.0, WMT: 168.0,
  DIS: 112.0, BA: 178.0, PYPL: 65.0, UBER: 78.0, COIN: 225.0,

  // ── Crypto (20) ──
  BTC: 67500, ETH: 3520, SOL: 172.5, BNB: 595, XRP: 0.58,
  DOGE: 0.165, ADA: 0.48, AVAX: 38.2, DOT: 7.35, LINK: 17.8,
  MATIC: 0.72, UNI: 11.5, ATOM: 9.2, NEAR: 7.8, APT: 9.5,
  ARB: 1.15, OP: 2.45, PEPE: 0.000012, SHIB: 0.000025, TON: 6.8,

  // ── Forex (10) ──
  EURUSD: 1.085, GBPUSD: 1.272, USDJPY: 154.5, AUDUSD: 0.665,
  USDCAD: 1.365, NZDUSD: 0.615, USDCHF: 0.875, EURGBP: 0.853,
  EURJPY: 167.8, GBPJPY: 196.5,

  // ── Commodities (5) ──
  XAUUSD: 2385, XAGUSD: 28.5, USOIL: 78.5, NATGAS: 2.85, XPTUSD: 980,

  // ── Indices (5) ──
  US30: 39500, NAS100: 18350, SPX500: 5350, FTSE100: 8200, DAX40: 18400,
};

const SYMBOL_NAMES: Record<string, string> = {
  // ── US Stocks ──
  AAPL: 'Apple Inc.', GOOGL: 'Alphabet Inc.', MSFT: 'Microsoft Corp.',
  AMZN: 'Amazon.com Inc.', NVDA: 'NVIDIA Corp.', TSLA: 'Tesla Inc.',
  META: 'Meta Platforms', NFLX: 'Netflix Inc.', AMD: 'Advanced Micro Devices',
  INTC: 'Intel Corp.', CRM: 'Salesforce Inc.', ORCL: 'Oracle Corp.',
  JPM: 'JPMorgan Chase', V: 'Visa Inc.', WMT: 'Walmart Inc.',
  DIS: 'Walt Disney Co.', BA: 'Boeing Co.', PYPL: 'PayPal Holdings',
  UBER: 'Uber Technologies', COIN: 'Coinbase Global',

  // ── Crypto ──
  BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana',
  BNB: 'BNB', XRP: 'XRP', DOGE: 'Dogecoin', ADA: 'Cardano',
  AVAX: 'Avalanche', DOT: 'Polkadot', LINK: 'Chainlink',
  MATIC: 'Polygon', UNI: 'Uniswap', ATOM: 'Cosmos',
  NEAR: 'NEAR Protocol', APT: 'Aptos', ARB: 'Arbitrum',
  OP: 'Optimism', PEPE: 'Pepe', SHIB: 'Shiba Inu', TON: 'Toncoin',

  // ── Forex ──
  EURUSD: 'EUR/USD', GBPUSD: 'GBP/USD', USDJPY: 'USD/JPY',
  AUDUSD: 'AUD/USD', USDCAD: 'USD/CAD', NZDUSD: 'NZD/USD',
  USDCHF: 'USD/CHF', EURGBP: 'EUR/GBP', EURJPY: 'EUR/JPY',
  GBPJPY: 'GBP/JPY',

  // ── Commodities ──
  XAUUSD: 'Gold', XAGUSD: 'Silver', USOIL: 'US Crude Oil',
  NATGAS: 'Natural Gas', XPTUSD: 'Platinum',

  // ── Indices ──
  US30: 'US 30 (Dow Jones)', NAS100: 'NASDAQ 100',
  SPX500: 'S&P 500', FTSE100: 'FTSE 100', DAX40: 'DAX 40',
};

export function getDemoPrice(symbol: string): number {
  const base = BASE_PRICES[symbol] || 100;
  return randomWalkPrice(base, 0.002);
}

export function getDemoSymbolName(symbol: string): string {
  return SYMBOL_NAMES[symbol] || symbol;
}

export function getAllDemoSymbols() {
  return Object.entries(BASE_PRICES).map(([symbol, base]) => {
    const price = randomWalkPrice(base, 0.002);
    const prevPrice = randomWalkPrice(base, 0.003);
    const change = price - prevPrice;
    return {
      symbol,
      name: SYMBOL_NAMES[symbol] || symbol,
      assetType: getAssetType(symbol) as 'stock' | 'crypto' | 'forex' | 'synthetic',
      price,
      change,
      changePercent: (change / prevPrice) * 100,
      volume: Math.floor(Math.random() * 10000000),
      high24h: price * 1.02,
      low24h: price * 0.98,
    };
  });
}

// Asset type classification — used for UI filtering and display
const FOREX_PAIRS = new Set(['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'NZDUSD', 'USDCHF', 'EURGBP', 'EURJPY', 'GBPJPY']);
const CRYPTO_SET = new Set(['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'AVAX', 'DOT', 'LINK', 'MATIC', 'UNI', 'ATOM', 'NEAR', 'APT', 'ARB', 'OP', 'PEPE', 'SHIB', 'TON']);
const INDEX_SET = new Set(['US30', 'NAS100', 'SPX500', 'FTSE100', 'DAX40']);
const COMMODITY_SET = new Set(['XAUUSD', 'XAGUSD', 'USOIL', 'NATGAS', 'XPTUSD']);

function getAssetType(symbol: string): string {
  if (FOREX_PAIRS.has(symbol)) return 'forex';
  if (CRYPTO_SET.has(symbol)) return 'crypto';
  if (INDEX_SET.has(symbol)) return 'index';
  if (COMMODITY_SET.has(symbol)) return 'commodity';
  return 'stock';
}

// Public getters for market-data.ts to use
export { FOREX_PAIRS as FOREX_SYMBOLS, CRYPTO_SET as CRYPTO_SYMBOL_SET, COMMODITY_SET as COMMODITY_SYMBOLS, INDEX_SET as INDEX_SYMBOLS };

export function getDemoCandles(symbol: string, timeframe: string, limit: number = 100): CandleData[] {
  const base = BASE_PRICES[symbol] || 100;
  const candles: CandleData[] = [];
  const now = Date.now();
  const intervalMs: Record<string, number> = {
    '1m': 60000, '5m': 300000, '15m': 900000,
    '1h': 3600000, '4h': 14400000, '1d': 86400000, '1w': 604800000,
  };
  const interval = intervalMs[timeframe] || 86400000;

  let price = base * (0.92 + Math.random() * 0.16);
  for (let i = limit - 1; i >= 0; i--) {
    const ts = now - i * interval;
    const volatility = base * 0.008;
    const drift = (Math.random() - 0.48) * volatility;
    const open = price;
    const close = price + drift;
    const high = Math.max(open, close) + Math.random() * volatility * 0.5;
    const low = Math.min(open, close) - Math.random() * volatility * 0.5;
    const volume = Math.floor(Math.random() * 5000000) + 500000;
    candles.push({ timestamp: ts, open, high, low, close, volume });
    price = close;
  }
  return candles;
}

// ============================================================
// Demo Broker Class - Implements full broker interface
// ============================================================

export class DemoBroker {
  private config: BrokerConfig;

  constructor(config: BrokerConfig) {
    this.config = config;
  }

  async getAccountInfo(): Promise<BrokerAccountInfo> {
    const acc = getAccount(this.config.accountId || 'demo');
    const positions = Array.from(acc.positions.values());
    const unrealizedPnl = positions.reduce((sum, p) => {
    const currentPrice = getDemoPrice(p.symbol);
    const pnl = p.side === 'long'
      ? (currentPrice - p.avgEntryPrice) * p.qty
      : (p.avgEntryPrice - currentPrice) * p.qty;
    return sum + pnl;
  }, 0);

    return {
      accountId: this.config.accountId || 'demo',
      balance: acc.balance,
      currency: 'USD',
      buyingPower: acc.balance * 4,
      dayPnl: unrealizedPnl,
    };
  }

  async getPositions(): Promise<BrokerPosition[]> {
    const acc = getAccount(this.config.accountId || 'demo');
    return Array.from(acc.positions.entries()).map(([symbol, p]) => {
      const currentPrice = getDemoPrice(symbol);
      const unrealizedPnl = p.side === 'long'
        ? (currentPrice - p.avgEntryPrice) * p.qty
        : (p.avgEntryPrice - currentPrice) * p.qty;
      return {
        symbol,
        qty: p.qty,
        avgEntryPrice: p.avgEntryPrice,
        currentPrice,
        unrealizedPnl,
        side: p.side,
      };
    });
  }

  async placeOrder(params: {
    symbol: string;
    side: OrderSide;
    type: OrderType;
    qty: number;
    limitPrice?: number;
    stopPrice?: number;
  }): Promise<BrokerOrderResult> {
    const acc = getAccount(this.config.accountId || 'demo');
    const price = getDemoPrice(params.symbol);
    const cost = price * params.qty;

    if (params.side === 'buy' && cost > acc.balance) {
      return {
        orderId: `REJ_${++acc.orderIdCounter}`,
        symbol: params.symbol,
        side: params.side,
        type: params.type,
        qty: params.qty,
        filledQty: 0,
        filledPrice: null,
        status: 'rejected',
        timestamp: new Date().toISOString(),
      };
    }

    // Simulate fill
    const filledPrice = params.type === 'limit' && params.limitPrice
      ? params.limitPrice
      : price;

    // Update or create position
    const existing = acc.positions.get(params.symbol);
    const positionSide: Side = params.side === 'buy' ? 'long' : 'short';

    if (existing && existing.side === positionSide) {
      const totalQty = existing.qty + params.qty;
      existing.avgEntryPrice = (existing.avgEntryPrice * existing.qty + filledPrice * params.qty) / totalQty;
      existing.qty = totalQty;
    } else if (existing && existing.side !== positionSide) {
      // Close or reduce opposite position
      const closeQty = Math.min(existing.qty, params.qty);
      const closePnl = positionSide === 'long'
        ? (filledPrice - existing.avgEntryPrice) * closeQty
        : (existing.avgEntryPrice - filledPrice) * closeQty;
      acc.balance += closePnl;
      existing.realizedPnl += closePnl;
      existing.qty -= closeQty;
      if (existing.qty <= 0) {
        acc.positions.delete(params.symbol);
      }
      // Open new position with remaining qty
      const remainingQty = params.qty - closeQty;
      if (remainingQty > 0) {
        acc.positions.set(params.symbol, {
          symbol: params.symbol,
          side: positionSide,
          qty: remainingQty,
          avgEntryPrice: filledPrice,
          realizedPnl: 0,
        });
      }
    } else {
      acc.positions.set(params.symbol, {
        symbol: params.symbol,
        side: positionSide,
        qty: params.qty,
        avgEntryPrice: filledPrice,
        realizedPnl: 0,
      });
    }

    if (params.side === 'buy') {
      acc.balance -= cost;
    } else {
      acc.balance += cost;
    }

    const id = `DMO_${++acc.orderIdCounter}`;
    return {
      orderId: id,
      symbol: params.symbol,
      side: params.side,
      type: params.type,
      qty: params.qty,
      filledQty: params.qty,
      filledPrice,
      status: 'filled',
      timestamp: new Date().toISOString(),
    };
  }

  async closePosition(symbol: string): Promise<BrokerOrderResult> {
    const acc = getAccount(this.config.accountId || 'demo');
    const pos = acc.positions.get(symbol);
    if (!pos) {
      return {
        orderId: `REJ_${++acc.orderIdCounter}`,
        symbol, side: 'sell', type: 'market', qty: 0,
        filledQty: 0, filledPrice: null,
        status: 'rejected', timestamp: new Date().toISOString(),
      };
    }
    const closeSide: OrderSide = pos.side === 'long' ? 'sell' : 'buy';
    const result = await this.placeOrder({
      symbol, side: closeSide, type: 'market', qty: pos.qty,
    });
    return result;
  }

  async getCandles(symbol: string, timeframe: string, limit: number = 100): Promise<CandleData[]> {
    return getDemoCandles(symbol, timeframe, limit);
  }

  async getPrice(symbol: string): Promise<number> {
    return getDemoPrice(symbol);
  }

  async cancelOrder(_symbol: string, _orderId: string): Promise<void> {
    // Demo orders fill immediately — nothing to cancel
  }
}

export { getAssetType, BASE_PRICES, SYMBOL_NAMES };
