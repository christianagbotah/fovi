// ============================================================
// Fovi AI Trading Platform - Shared Type Definitions
// ============================================================

export type BrokerProvider = 'alpaca' | 'binance' | 'okx' | 'deriv' | 'demo';
export type AccountType = 'live' | 'demo';
export type AssetType = 'stock' | 'crypto' | 'forex' | 'synthetic';
export type Side = 'long' | 'short';
export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit' | 'stop' | 'stop_limit';
export type OrderStatus = 'pending' | 'filled' | 'partially_filled' | 'cancelled' | 'rejected';
export type PositionStatus = 'open' | 'closed';
export type SignalDirection = 'bullish' | 'bearish' | 'neutral';
export type SignalType = 'rsi_divergence' | 'macd_crossover' | 'bollinger_squeeze' | 'breakout' | 'support_resistance' | 'trend_reversal' | 'momentum_shift' | 'ai_predicted';
export type SignalStatus = 'active' | 'executed' | 'expired' | 'cancelled';
export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w';
export type RiskTolerance = 'conservative' | 'medium' | 'aggressive';

export interface CandleData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TradingAccount {
  id: string;
  userId: string;
  broker: BrokerProvider;
  accountType: AccountType;
  accountId: string | null;
  apiKey?: string;
  apiSecret?: string;
  passphrase?: string;
  isDefault: boolean;
  balance: number;
  linkedBalance: number;
  totalAllocated: number;
  totalRealizedProfit: number;
  currency: string;
  isActive: boolean;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: {
    positions: number;
    orders: number;
    signals: number;
  };
}

export interface Position {
  id: string;
  accountId: string;
  symbol: string;
  name: string | null;
  assetType: AssetType;
  side: Side;
  qty: number;
  avgEntryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  realizedPnl: number;
  stopLoss: number | null;
  takeProfit: number | null;
  status: PositionStatus;
  openedAt: string;
  closedAt: string | null;
}

export interface Order {
  id: string;
  accountId: string;
  brokerOrderId: string | null;
  symbol: string;
  assetType: AssetType;
  side: OrderSide;
  type: OrderType;
  qty: number;
  limitPrice: number | null;
  stopPrice: number | null;
  filledQty: number;
  filledPrice: number | null;
  status: OrderStatus;
  aiGenerated: boolean;
  signalId: string | null;
  createdAt: string;
}

export interface TradingSignal {
  id: string;
  accountId: string;
  symbol: string;
  assetType: AssetType;
  direction: SignalDirection;
  confidence: number;
  signalType: SignalType;
  timeframe: Timeframe;
  entryPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  targetPnl: number | null;
  reasoning: string | null;
  status: SignalStatus;
  executedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface MarketSymbol {
  symbol: string;
  name: string;
  assetType: AssetType;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  high24h: number;
  low24h: number;
}

export interface PortfolioSummary {
  totalBalance: number;
  totalPnl: number;
  totalPnlPercent: number;
  dayPnl: number;
  dayPnlPercent: number;
  openPositions: number;
  activeSignals: number;
  winRate: number;
  totalTrades: number;
}

export interface PlaceOrderRequest {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  qty: number;
  limitPrice?: number;
  stopPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
}

export interface BrokerConfig {
  provider: BrokerProvider;
  accountId?: string;
  apiKey?: string;
  apiSecret?: string;
  /**
   * OKX requires an API passphrase in addition to key/secret.
   * Optional — only used by the OKX broker. If absent, OKX will
   * attempt to parse the passphrase from `apiSecret` (encoded as
   * `secret|passphrase`).
   */
  passphrase?: string;
  isDemo: boolean;
}

export interface BrokerOrderResult {
  orderId: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  qty: number;
  filledQty: number;
  filledPrice: number | null;
  status: OrderStatus;
  timestamp: string;
}

export interface BrokerPosition {
  symbol: string;
  qty: number;
  avgEntryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  side: Side;
}

export interface BrokerAccountInfo {
  accountId: string;
  balance: number;
  currency: string;
  buyingPower: number;
  dayPnl: number;
}
