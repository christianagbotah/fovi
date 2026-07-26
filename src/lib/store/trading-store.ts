// ============================================================
// Fovi Trading Store - Global state management
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

interface TradingState {
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

  // UI State
  orderSheetOpen: boolean;
  setOrderSheetOpen: (open: boolean) => void;
  orderSymbol: string | null;
  setOrderSymbol: (symbol: string | null) => void;
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
}

export const useTradingStore = create<TradingState>((set) => ({
  // Accounts
  accounts: [],
  activeAccountId: null,
  setActiveAccount: (id) => set({ activeAccountId: id }),
  setAccounts: (accounts) => set({
    accounts,
    activeAccountId: accounts.find(a => a.isDefault)?.id || accounts[0]?.id || null,
  }),

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

  // UI
  orderSheetOpen: false,
  setOrderSheetOpen: (open) => set({ orderSheetOpen: open }),
  orderSymbol: null,
  setOrderSymbol: (symbol) => set({ orderSymbol: symbol }),
  signalDetailId: null,
  setSignalDetailId: (id) => set({ signalDetailId: id }),
  positionDetailId: null,
  setPositionDetailId: (id) => set({ positionDetailId: id }),
  aiChatOpen: false,
  setAiChatOpen: (open) => set({ aiChatOpen: open }),
  isLoading: false,
  setIsLoading: (loading) => set({ isLoading: loading }),
  activeTab: 'dashboard',
  setActiveTab: (tab) => set({ activeTab: tab }),
  assetFilter: 'all',
  setAssetFilter: (filter) => set({ assetFilter: filter }),
}));
