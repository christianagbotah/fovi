// ============================================================
// Fovi Trading Store - Global state management with localStorage persistence
// ============================================================

import { create } from 'zustand';
import type {
  TradingAccount,
  Position,
  Order,
  TradingSignal,
  MarketSymbol,
  PortfolioSummary,
  CandleData,
  Timeframe,
  AssetType,
} from '../types';

export interface BotConfigState {
  id: string | null;
  enabled: boolean;
  allocationAmount: number;
  riskTolerance: string;
  maxPositions: number;
  maxPositionSize: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  strategy: string;
  status: string;
  totalTrades: number;
  winTrades: number;
  totalPnl: number;
  winRate: number;
  lastTradeAt: string | null;
  lastError: string | null;
  accountBalance: number;
  adminLevyPercent: number;
  adminLevyCollected: number;
}

export interface AutoTradeActivity {
  id: string;
  symbol: string;
  side: string;
  type: string;
  qty: number;
  filledPrice: number | null;
  filledQty: number;
  status: string;
  signalDirection: string | null;
  signalConfidence: number | null;
  signalType: string | null;
  createdAt: string;
  pnl?: number;
}

export interface AIOpenPosition {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  qty: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  signalType: string;
  openedAt: string;
}

export interface AIClosedTrade {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  qty: number;
  entryPrice: number;
  exitPrice: number;
  realizedPnl: number;
  grossPnl: number;
  adminLevy: number;
  signalType: string;
  openedAt: string;
  closedAt: string;
}

export interface PriceAlert {
  id: string;
  symbol: string;
  condition: 'above' | 'below';
  targetPrice: number;
  currentPrice: number;
  triggered: boolean;
}

// ============================================================
// localStorage helpers (safe for SSR)
// ============================================================
function loadFromLS<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

function saveToLS(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota */ }
}

// ============================================================
// Default alerts (shown only on first-ever visit)
// ============================================================
const DEFAULT_ALERTS: PriceAlert[] = [
  { id: '1', symbol: 'BTC', condition: 'above', targetPrice: 72000, currentPrice: 67842.5, triggered: false },
  { id: '2', symbol: 'AAPL', condition: 'below', targetPrice: 185, currentPrice: 198.32, triggered: false },
  { id: '3', symbol: 'ETH', condition: 'above', targetPrice: 4200, currentPrice: 3891.2, triggered: true },
  { id: '4', symbol: 'NVDA', condition: 'above', targetPrice: 145, currentPrice: 138.67, triggered: false },
];

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
}

interface TradingState {
  // Auth
  authUser: AuthUser | null;
  authToken: string | null;
  isAuthenticated: boolean;
  setAuth: (user: AuthUser, token: string) => void;
  clearAuth: () => void;

  // Accounts
  accounts: TradingAccount[];
  activeAccountId: string | null;
  setActiveAccount: (id: string) => void;
  setAccounts: (accounts: TradingAccount[]) => void;

  // Market
  watchlist: MarketSymbol[];
  allSymbols: MarketSymbol[];
  setWatchlist: (items: MarketSymbol[]) => void;
  setAllSymbols: (items: MarketSymbol[]) => void;
  selectedSymbol: string | null;
  setSelectedSymbol: (symbol: string | null) => void;
  selectedTimeframe: Timeframe;
  setSelectedTimeframe: (tf: Timeframe) => void;
  candles: CandleData[];
  setCandles: (candles: CandleData[]) => void;

  // Positions & Orders
  positions: Position[];
  setPositions: (positions: Position[]) => void;
  orders: Order[];
  setOrders: (orders: Order[]) => void;

  // Signals
  signals: TradingSignal[];
  setSignals: (signals: TradingSignal[]) => void;

  // Portfolio
  portfolio: PortfolioSummary | null;
  setPortfolio: (summary: PortfolioSummary) => void;

  // Live WebSocket prices
  livePrices: MarketSymbol[];
  setLivePrices: (prices: MarketSymbol[]) => void;
  wsConnected: boolean;
  setWsConnected: (connected: boolean) => void;

  // UI State
  orderSheetOpen: boolean;
  setOrderSheetOpen: (open: boolean) => void;
  orderSymbol: string | null;
  setOrderSymbol: (symbol: string | null) => void;
  orderStopLoss: number | null;
  orderTakeProfit: number | null;
  orderEntryPrice: number | null;
  setOrderStopLoss: (val: number | null) => void;
  setOrderTakeProfit: (val: number | null) => void;
  setOrderEntryPrice: (val: number | null) => void;
  signalDetailId: string | null;
  setSignalDetailId: (id: string | null) => void;
  positionDetailId: string | null;
  setPositionDetailId: (id: string | null) => void;
  aiChatOpen: boolean;
  setAiChatOpen: (open: boolean) => void;
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  assetFilter: AssetType | 'all';
  setAssetFilter: (filter: AssetType | 'all') => void;

  // AI Auto-Trade
  botConfig: BotConfigState;
  setBotConfig: (config: Partial<BotConfigState>) => void;
  autoTradeActivity: AutoTradeActivity[];
  setAutoTradeActivity: (activity: AutoTradeActivity[]) => void;
  aiOpenPositions: AIOpenPosition[];
  setAIOpenPositions: (positions: AIOpenPosition[]) => void;
  aiClosedTrades: AIClosedTrade[];
  setAIClosedTrades: (trades: AIClosedTrade[]) => void;

  // Price Alerts (persisted in localStorage)
  alerts: PriceAlert[];
  addAlert: (alert: PriceAlert) => void;
  removeAlert: (id: string) => void;
  setAlerts: (alerts: PriceAlert[]) => void;
  alertCount: () => number;  // untriggered count for badges
}

export const useTradingStore = create<TradingState>((set, get) => ({
  // Auth
  authUser: null,
  authToken: null,
  isAuthenticated: false,
  setAuth: (user, token) => {
    set({ authUser: user, authToken: token, isAuthenticated: true });
    localStorage.setItem('fovi_token', token);
    localStorage.setItem('fovi_user', JSON.stringify(user));
  },
  clearAuth: () => {
    set({ authUser: null, authToken: null, isAuthenticated: false });
    localStorage.removeItem('fovi_token');
    localStorage.removeItem('fovi_user');
  },

  // Accounts
  accounts: [],
  activeAccountId: null,
  setActiveAccount: (id) => {
    set({ activeAccountId: id });
    saveToLS('fovi_active_account', id);
  },
  setAccounts: (accounts) => {
    // Merge with any locally-added accounts from localStorage
    const lsAccounts = loadFromLS<TradingAccount[] | null>('fovi_accounts', null);
    let merged = accounts;
    if (lsAccounts && lsAccounts.length > accounts.length) {
      // User added accounts locally that aren't in API response
      const apiIds = new Set(accounts.map(a => a.id));
      const localOnly = lsAccounts.filter(a => !apiIds.has(a.id));
      if (localOnly.length > 0) {
        merged = [...accounts, ...localOnly];
      }
    }
    const savedActiveId = loadFromLS<string | null>('fovi_active_account', null);
    const activeId = savedActiveId && merged.find(a => a.id === savedActiveId)
      ? savedActiveId
      : merged.find(a => a.isDefault)?.id || merged[0]?.id || null;
    set({ accounts: merged, activeAccountId: activeId });
  },

  // Market
  watchlist: [],
  allSymbols: [],
  setWatchlist: (items) => set({ watchlist: items }),
  setAllSymbols: (items) => set({ allSymbols: items }),
  selectedSymbol: 'AAPL',
  setSelectedSymbol: (symbol) => set({ selectedSymbol: symbol }),
  selectedTimeframe: '1d',
  setSelectedTimeframe: (tf) => set({ selectedTimeframe: tf }),
  candles: [],
  setCandles: (candles) => set({ candles }),

  // Positions & Orders
  positions: [],
  setPositions: (positions) => set({ positions }),
  orders: [],
  setOrders: (orders) => set({ orders }),

  // Signals
  signals: [],
  setSignals: (signals) => set({ signals }),

  // Portfolio
  portfolio: null,
  setPortfolio: (summary) => set({ portfolio: summary }),

  // Live WebSocket prices
  livePrices: [],
  setLivePrices: (prices) => set({ livePrices: prices }),
  wsConnected: false,
  setWsConnected: (connected) => set({ wsConnected: connected }),

  // UI
  orderSheetOpen: false,
  setOrderSheetOpen: (open) => set({
    orderSheetOpen: open,
    // Only clear SL/TP/entry when CLOSING the sheet, not when opening
    // (signals panel sets these BEFORE opening the sheet)
    ...(open ? {} : { orderStopLoss: null, orderTakeProfit: null, orderEntryPrice: null }),
  }),
  orderSymbol: null,
  setOrderSymbol: (symbol) => set({ orderSymbol: symbol }),
  orderStopLoss: null,
  orderTakeProfit: null,
  orderEntryPrice: null,
  setOrderStopLoss: (val) => set({ orderStopLoss: val }),
  setOrderTakeProfit: (val) => set({ orderTakeProfit: val }),
  setOrderEntryPrice: (val) => set({ orderEntryPrice: val }),
  signalDetailId: null,
  setSignalDetailId: (id) => set({ signalDetailId: id }),
  positionDetailId: null,
  setPositionDetailId: (id) => set({ positionDetailId: id }),
  aiChatOpen: false,
  setAiChatOpen: (open) => set({ aiChatOpen: open }),
  isLoading: false,
  setIsLoading: (loading) => set({ isLoading: loading }),
  activeTab: 'autotrade',
  setActiveTab: (tab) => set({ activeTab: tab }),
  assetFilter: 'all',
  setAssetFilter: (filter) => set({ assetFilter: filter }),

  // AI Auto-Trade — DB is source of truth for botConfig.
  // We still load from localStorage for instant UI on mount, but the
  // init useEffect in ai-trading-dashboard always reconciles with the API.
  botConfig: loadFromLS<BotConfigState>('fovi_autotrade_config', {
    id: null, enabled: false, allocationAmount: 0, riskTolerance: 'medium',
    maxPositions: 5, maxPositionSize: 0, stopLossPercent: 2.0, takeProfitPercent: 4.0,
    strategy: 'balanced', status: 'stopped', totalTrades: 0, winTrades: 0,
    totalPnl: 0, winRate: 0, lastTradeAt: null, lastError: null, accountBalance: 0,
    adminLevyPercent: 10, adminLevyCollected: 0,
  }),
  setBotConfig: (config) => {
    const updated = { ...get().botConfig, ...config };
    // Admin levy is NON-REMOVABLE — minimum 1%
    if (updated.adminLevyPercent !== undefined) {
      updated.adminLevyPercent = Math.max(1, updated.adminLevyPercent);
    }
    set({ botConfig: updated });
    // Cache to localStorage for instant UI on next mount.
    // The init useEffect will reconcile with the DB anyway.
    saveToLS('fovi_autotrade_config', updated);
  },
  autoTradeActivity: [],
  setAutoTradeActivity: (activity) => set({ autoTradeActivity: activity }),
  // AI positions/trades are transient simulation data.
  // Stored in localStorage for session persistence until DB persistence is added.
  aiOpenPositions: loadFromLS<AIOpenPosition[]>('fovi_ai_positions', []),
  setAIOpenPositions: (positions) => { set({ aiOpenPositions: positions }); saveToLS('fovi_ai_positions', positions); },
  aiClosedTrades: loadFromLS<AIClosedTrade[]>('fovi_ai_closed_trades', []),
  setAIClosedTrades: (trades) => { set({ aiClosedTrades: trades }); saveToLS('fovi_ai_closed_trades', trades); },

  // Price Alerts — persisted in localStorage
  alerts: [],
  addAlert: (alert) => {
    const updated = [...get().alerts, alert];
    set({ alerts: updated });
    saveToLS('fovi_price_alerts', updated);
  },
  removeAlert: (id) => {
    const updated = get().alerts.filter(a => a.id !== id);
    set({ alerts: updated });
    saveToLS('fovi_price_alerts', updated);
  },
  setAlerts: (alerts) => {
    set({ alerts });
    saveToLS('fovi_price_alerts', alerts);
  },
  alertCount: () => get().alerts.filter(a => !a.triggered).length,
}));

// ============================================================
// Hydrate alerts from localStorage on client side
// Call this once in the root layout or page on mount.
// ============================================================
export function hydrateAlertsFromStorage() {
  const stored = loadFromLS<PriceAlert[] | null>('fovi_price_alerts', null);
  if (stored) {
    useTradingStore.getState().setAlerts(stored);
  } else {
    // First visit — seed with defaults
    useTradingStore.getState().setAlerts(DEFAULT_ALERTS);
  }
}
