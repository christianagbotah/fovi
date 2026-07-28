'use client';

import { useState, useEffect, useRef, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bot, TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight,
  Wallet, Activity, Clock, Target, Zap, Shield, AlertTriangle,
  ChevronDown, ChevronUp, Loader2, RotateCcw, Percent,
  CheckCircle2, XCircle, Settings2,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useTradingStore } from '@/lib/store/trading-store';
import type { AutoTradeActivity, AIOpenPosition, AIClosedTrade } from '@/lib/store/trading-store';
import { toast } from 'sonner';

// ============================================================
// Symbol reference prices for realistic simulation
// ============================================================
const SYMBOL_DATA: Record<string, { price: number; decimals: number }> = {
  'AAPL': { price: 198.50, decimals: 2 },
  'GOOGL': { price: 175.20, decimals: 2 },
  'MSFT': { price: 425.80, decimals: 2 },
  'AMZN': { price: 185.30, decimals: 2 },
  'TSLA': { price: 248.60, decimals: 2 },
  'NVDA': { price: 138.40, decimals: 2 },
  'META': { price: 505.70, decimals: 2 },
  'BTC/USD': { price: 68500, decimals: 2 },
  'ETH/USD': { price: 3550, decimals: 2 },
  'SOL/USD': { price: 175, decimals: 2 },
  'EUR/USD': { price: 1.085, decimals: 4 },
  'XRP/USD': { price: 0.58, decimals: 4 },
};

const SYMBOLS = Object.keys(SYMBOL_DATA);
const SIGNALS = ['momentum', 'mean_reversion', 'breakout', 'volume_spike'];

export function AITradingDashboard() {
  const {
    botConfig, setBotConfig, autoTradeActivity, setAutoTradeActivity,
    aiOpenPositions, setAIOpenPositions, aiClosedTrades, setAIClosedTrades,
    setPortfolio,
  } = useTradingStore();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<string>('all');
  const [historySymbol, setHistorySymbol] = useState<string>('all');

  // Simulated market prices (persists across re-renders within session)
  const simPricesRef = useRef<Record<string, number>>({});

  // Initialize sim prices from symbol data
  useEffect(() => {
    for (const sym of SYMBOLS) {
      if (!simPricesRef.current[sym]) {
        simPricesRef.current[sym] = SYMBOL_DATA[sym].price;
      }
    }
  }, []);

  const activityList = Array.isArray(autoTradeActivity) ? autoTradeActivity : [];
  const openPositions = Array.isArray(aiOpenPositions) ? aiOpenPositions : [];
  const closedTrades = Array.isArray(aiClosedTrades) ? aiClosedTrades : [];

  const allocation = botConfig.allocationAmount || 0;
  const levyPercent = botConfig.adminLevyPercent || 10;

  // ---- Derived financial values ----
  const grossRealizedPnl = closedTrades.reduce((s, t) => {
    return s + (t.grossPnl ?? t.realizedPnl);
  }, 0);
  const totalAdminLevy = closedTrades.reduce((s, t) => {
    return s + (t.adminLevy || 0);
  }, 0);
  const netRealizedPnl = grossRealizedPnl - totalAdminLevy;
  const unrealizedPnl = openPositions.reduce((s, p) => s + p.unrealizedPnl, 0);
  const totalPnl = netRealizedPnl + unrealizedPnl;
  const accountEquity = Math.max(0, parseFloat((allocation + totalPnl).toFixed(2)));
  const investedAmount = openPositions.reduce((s, p) => s + (p.entryPrice * p.qty), 0);
  const availableBalance = Math.max(0, parseFloat((accountEquity - investedAmount).toFixed(2)));
  const isLiquidated = botConfig.status === 'liquidated';
  const isRunning = botConfig.status === 'running';
  const equityPercent = allocation > 0 ? parseFloat(((totalPnl / allocation) * 100).toFixed(2)) : 0;

  // Trade history filters
  const uniqueSymbols = Array.from(new Set(closedTrades.map(t => t.symbol)));
  const filteredTrades = closedTrades.filter(t => {
    if (historyFilter === 'profit' && t.realizedPnl < 0) return false;
    if (historyFilter === 'loss' && t.realizedPnl >= 0) return false;
    if (historySymbol !== 'all' && t.symbol !== historySymbol) return false;
    return true;
  });

  // ---- Load saved state on mount ----
  useEffect(() => {
    try {
      const savedConfig = localStorage.getItem('fovi_autotrade_config');
      if (savedConfig) {
        const parsed = JSON.parse(savedConfig);
        if (parsed.status === 'running' || parsed.enabled) {
          setBotConfig(parsed);
        }
      }
      const savedActivity = localStorage.getItem('fovi_autotrade_activity');
      if (savedActivity) {
        const parsed = JSON.parse(savedActivity);
        if (Array.isArray(parsed) && parsed.length > 0) setAutoTradeActivity(parsed);
      }
    } catch { /* */ }

    async function load() {
      try {
        const configRes = await fetch('/api/trading/auto-trade');
        const current = useTradingStore.getState().botConfig;
        if (configRes.ok && current.status !== 'running') {
          setBotConfig(await configRes.json());
        }
      } catch { /* */ }
      setLoading(false);
    }
    load();
  }, [setBotConfig, setAutoTradeActivity]);

  // ---- Sync portfolio state for dashboard tab ----
  useEffect(() => {
    if (allocation <= 0) return;
    setPortfolio({
      totalBalance: accountEquity,
      totalPnl: totalPnl,
      totalPnlPercent: equityPercent,
      dayPnl: unrealizedPnl,
      dayPnlPercent: allocation > 0 ? parseFloat(((unrealizedPnl / allocation) * 100).toFixed(2)) : 0,
      openPositions: openPositions.length,
      activeSignals: 0,
      winRate: botConfig.winRate,
      totalTrades: botConfig.totalTrades,
    });
  }, [accountEquity, totalPnl, equityPercent, unrealizedPnl, allocation, openPositions.length, botConfig.winRate, botConfig.totalTrades, setPortfolio]);

  // ---- Main trading simulation ----
  useEffect(() => {
    if (botConfig.status !== 'running') return;
    if (allocation <= 0) return;

    function getSimPrice(sym: string): number {
      const base = simPricesRef.current[sym] || SYMBOL_DATA[sym].price;
      const change = (Math.random() - 0.48) * 0.008; // slight upward bias, ±0.8%
      const newPrice = parseFloat((base * (1 + change)).toFixed(SYMBOL_DATA[sym].decimals));
      simPricesRef.current[sym] = newPrice;
      return newPrice;
    }

    function calcPositionQty(sym: string): number {
      const maxPos = botConfig.maxPositions || 5;
      const perPosition = allocation / maxPos;
      const price = simPricesRef.current[sym] || SYMBOL_DATA[sym].price;
      const decimals = SYMBOL_DATA[sym].decimals;
      const raw = perPosition / price;
      const qty = parseFloat(Math.max(raw, 0.00001).toFixed(decimals));
      return qty;
    }

    function checkLiquidation(): boolean {
      const trades = useTradingStore.getState().aiClosedTrades;
      const positions = useTradingStore.getState().aiOpenPositions;
      const gPnl = trades.reduce((s, t) => s + (t.grossPnl ?? t.realizedPnl), 0);
      const levy = trades.reduce((s, t) => s + (t.adminLevy || 0), 0);
      const uPnl = positions.reduce((s, p) => s + p.unrealizedPnl, 0);
      const equity = allocation + (gPnl - levy) + uPnl;
      return equity <= 0;
    }

    function forceLiquidate() {
      const positions = useTradingStore.getState().aiOpenPositions;
      const now = new Date().toISOString();
      const closedTradesList = useTradingStore.getState().aiClosedTrades;
      let totalNewLevy = 0;

      const newClosed: AIClosedTrade[] = positions.map(pos => {
        const closePrice = pos.currentPrice;
        const gross = pos.side === 'buy'
          ? parseFloat(((closePrice - pos.entryPrice) * pos.qty).toFixed(2))
          : parseFloat(((pos.entryPrice - closePrice) * pos.qty).toFixed(2));
        const levy = gross > 0 ? parseFloat((gross * levyPercent / 100).toFixed(2)) : 0;
        totalNewLevy += levy;
        return {
          id: 'liq_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
          symbol: pos.symbol, side: pos.side, qty: pos.qty,
          entryPrice: pos.entryPrice, exitPrice: closePrice,
          realizedPnl: parseFloat((gross - levy).toFixed(2)),
          grossPnl: gross, adminLevy: levy,
          signalType: 'liquidation', openedAt: pos.openedAt, closedAt: now,
        };
      });

      const allClosed = [...newClosed, ...closedTradesList].slice(0, 100);
      setAIClosedTrades(allClosed);
      setAIOpenPositions([]);

      const currentConfig = useTradingStore.getState().botConfig;
      const allTrades = allClosed;
      const wins = allTrades.filter(t => t.realizedPnl > 0).length;
      const totalLevy = allTrades.reduce((s, t) => s + (t.adminLevy || 0), 0);
      setBotConfig({
        status: 'liquidated',
        enabled: false,
        totalTrades: allTrades.length,
        winTrades: wins,
        winRate: allTrades.length > 0 ? Math.round((wins / allTrades.length) * 100) : 0,
        totalPnl: parseFloat(allTrades.reduce((s, t) => s + t.realizedPnl, 0).toFixed(2)),
        adminLevyCollected: totalLevy,
        lastTradeAt: now,
      });

      toast.error('Allocation Depleted — All positions liquidated', {
        description: 'Your trading allocation has been fully consumed. Set a new amount to trade again.',
        duration: 8000,
      });
    }

    function simulateTrade() {
      const currentPositions = useTradingStore.getState().aiOpenPositions;
      const currentConfig = useTradingStore.getState().botConfig;
      const currentAllocation = currentConfig.allocationAmount;

      if (currentAllocation <= 0) return;

      // Decide: open new or close existing (60% close, 40% open)
      const shouldClose = currentPositions.length > 0 && Math.random() < 0.6;

      if (shouldClose) {
        // Close a random open position
        const idx = Math.floor(Math.random() * currentPositions.length);
        const pos = currentPositions[idx];

        // Move price from current by a realistic amount
        const basePrice = simPricesRef.current[pos.symbol] || pos.currentPrice;
        const sl = currentConfig.stopLossPercent / 100;
        const tp = currentConfig.takeProfitPercent / 100;
        const moveRange = sl + tp;
        const movePercent = (Math.random() - 0.45) * moveRange; // slight profit bias
        const direction = pos.side === 'buy' ? 1 : -1;
        const closePrice = parseFloat((pos.entryPrice * (1 + direction * movePercent)).toFixed(SYMBOL_DATA[pos.symbol].decimals));

        // Update sim price
        simPricesRef.current[pos.symbol] = closePrice;

        const grossPnl = pos.side === 'buy'
          ? parseFloat(((closePrice - pos.entryPrice) * pos.qty).toFixed(2))
          : parseFloat(((pos.entryPrice - closePrice) * pos.qty).toFixed(2));
        const adminLevy = grossPnl > 0 ? parseFloat((grossPnl * levyPercent / 100).toFixed(2)) : 0;
        const netPnl = parseFloat((grossPnl - adminLevy).toFixed(2));

        const closedTrade: AIClosedTrade = {
          id: 'close_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
          symbol: pos.symbol, side: pos.side, qty: pos.qty,
          entryPrice: pos.entryPrice, exitPrice: closePrice,
          realizedPnl: netPnl, grossPnl, adminLevy,
          signalType: SIGNALS[Math.floor(Math.random() * SIGNALS.length)],
          openedAt: pos.openedAt, closedAt: new Date().toISOString(),
        };

        const updatedClosed = [closedTrade, ...useTradingStore.getState().aiClosedTrades].slice(0, 100);
        const updatedOpen = currentPositions.filter((_, i) => i !== idx);
        setAIClosedTrades(updatedClosed);
        setAIOpenPositions(updatedOpen);

        // Activity log
        const act: AutoTradeActivity & { pnl: number } = {
          id: 'ai_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
          symbol: pos.symbol, side: pos.side === 'buy' ? 'sell' : 'buy', type: 'market',
          qty: pos.qty, filledPrice: closePrice, filledQty: pos.qty,
          status: 'filled', signalDirection: pos.side, signalConfidence: Math.floor(Math.random() * 30) + 70,
          signalType: closedTrade.signalType, createdAt: new Date().toISOString(), pnl: netPnl,
        };
        const currentActivity = useTradingStore.getState().autoTradeActivity;
        const newActivity = [act, ...currentActivity].slice(0, 50);
        setAutoTradeActivity(newActivity);
        try { localStorage.setItem('fovi_autotrade_activity', JSON.stringify(newActivity)); } catch { /* */ }

        // Update bot stats (compute manually, NOT with function)
        const allClosedNow = updatedClosed;
        const wins = allClosedNow.filter(t => t.realizedPnl > 0).length;
        const totalLevy = allClosedNow.reduce((s, t) => s + (t.adminLevy || 0), 0);
        const totalNet = allClosedNow.reduce((s, t) => s + t.realizedPnl, 0);
        setBotConfig({
          totalTrades: allClosedNow.length,
          winTrades: wins,
          winRate: allClosedNow.length > 0 ? Math.round((wins / allClosedNow.length) * 100) : 0,
          totalPnl: parseFloat(totalNet.toFixed(2)),
          adminLevyCollected: parseFloat(totalLevy.toFixed(2)),
          lastTradeAt: new Date().toISOString(),
        });

        toast[netPnl >= 0 ? 'success' : 'error'](
          'AI Closed ' + pos.symbol + ' — ' + (netPnl >= 0 ? '+' : '') + '$' + netPnl.toFixed(2),
          {
            description: 'Entry $' + pos.entryPrice.toLocaleString() + ' → Exit $' + closePrice.toLocaleString()
              + (adminLevy > 0 ? ' | Levy: -$' + adminLevy.toFixed(2) : ''),
          }
        );

        // Check liquidation after closing
        if (checkLiquidation()) {
          setTimeout(() => forceLiquidate(), 500);
        }
      } else {
        // Open a new position
        if (currentPositions.length >= (currentConfig.maxPositions || 5)) return;

        // Pick a symbol not already in an open position
        const usedSymbols = new Set(currentPositions.map(p => p.symbol));
        const availableSymbols = SYMBOLS.filter(s => !usedSymbols.has(s));
        if (availableSymbols.length === 0) return;

        const symbol = availableSymbols[Math.floor(Math.random() * availableSymbols.length)];
        const side = Math.random() > 0.45 ? 'buy' as const : 'sell' as const;
        const signalType = SIGNALS[Math.floor(Math.random() * SIGNALS.length)];
        const confidence = Math.floor(Math.random() * 30) + 70;
        const entryPrice = getSimPrice(symbol);
        const qty = calcPositionQty(symbol);

        const newPos: AIOpenPosition = {
          id: 'pos_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
          symbol, side, qty, entryPrice,
          currentPrice: entryPrice, unrealizedPnl: 0,
          signalType, openedAt: new Date().toISOString(),
        };
        const updatedOpen = [...currentPositions, newPos].slice(-(currentConfig.maxPositions || 5));
        setAIOpenPositions(updatedOpen);

        const act: AutoTradeActivity & { pnl: number } = {
          id: 'ai_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
          symbol, side, type: 'market', qty, filledPrice: entryPrice,
          filledQty: qty, status: 'filled',
          signalDirection: side, signalConfidence: confidence,
          signalType, createdAt: new Date().toISOString(), pnl: 0,
        };
        const currentActivity = useTradingStore.getState().autoTradeActivity;
        const newActivity = [act, ...currentActivity].slice(0, 50);
        setAutoTradeActivity(newActivity);
        try { localStorage.setItem('fovi_autotrade_activity', JSON.stringify(newActivity)); } catch { /* */ }

        const posValue = parseFloat((entryPrice * qty).toFixed(2));
        toast.success(
          'AI Opened ' + (side === 'buy' ? 'Long' : 'Short') + ' ' + symbol + ' @ $' + entryPrice.toLocaleString(),
          { description: signalType.replace('_', ' ') + ' · ' + confidence + '% confidence · $' + posValue.toFixed(2) }
        );
      }
    }

    // Price update interval (every 3s)
    const priceInterval = setInterval(() => {
      const positions = useTradingStore.getState().aiOpenPositions;
      if (positions.length === 0) return;
      const updated = positions.map(p => {
        const symData = SYMBOL_DATA[p.symbol];
        const current = simPricesRef.current[p.symbol] || p.currentPrice;
        const change = (Math.random() - 0.48) * 0.012; // ±1.2% per tick
        const newPrice = parseFloat((current * (1 + change)).toFixed(symData.decimals));
        simPricesRef.current[p.symbol] = newPrice;
        const pnl = p.side === 'buy'
          ? parseFloat(((newPrice - p.entryPrice) * p.qty).toFixed(2))
          : parseFloat(((p.entryPrice - newPrice) * p.qty).toFixed(2));
        return { ...p, currentPrice: newPrice, unrealizedPnl: pnl };
      });
      setAIOpenPositions(updated);

      // Check if any position hit stop-loss and force close
      const config = useTradingStore.getState().botConfig;
      const slPercent = config.stopLossPercent / 100;
      const tpPercent = config.takeProfitPercent / 100;
      let forceClosed = false;

      for (const pos of updated) {
        const priceChange = pos.side === 'buy'
          ? (pos.currentPrice - pos.entryPrice) / pos.entryPrice
          : (pos.entryPrice - pos.currentPrice) / pos.entryPrice;
        if (priceChange <= -slPercent || priceChange >= tpPercent) {
          // Will be closed next simulateTrade cycle
        }
      }

      if (forceClosed) {
        simulateTrade();
      }
    }, 3000);

    // Trade simulation loop
    const delay = 2000 + Math.random() * 2000;
    const initialTimer = setTimeout(() => {
      simulateTrade();
      const loop = () => {
        if (useTradingStore.getState().botConfig.status !== 'running') return;
        const nextDelay = 6000 + Math.random() * 6000;
        const t = setTimeout(() => { simulateTrade(); loop(); }, nextDelay);
        return t;
      };
      loop();
    }, delay);

    return () => { clearTimeout(initialTimer); clearInterval(priceInterval); };
  }, [botConfig.status, botConfig.allocationAmount, botConfig.maxPositions, botConfig.stopLossPercent, botConfig.takeProfitPercent, levyPercent, allocation, setAutoTradeActivity, setBotConfig, setAIOpenPositions, setAIClosedTrades]);

  // ---- Handlers ----
  const handleToggle = async () => {
    if (allocation <= 0) {
      toast.error('Set a trading allocation first');
      return;
    }
    if (isLiquidated) {
      toast.error('Allocation depleted. Set a new amount and reset to trade again.');
      return;
    }
    setSaving(true);
    const newEnabled = !botConfig.enabled;
    const updated = { ...botConfig, enabled: newEnabled, status: newEnabled ? 'running' : 'stopped' };
    localStorage.setItem('fovi_autotrade_config', JSON.stringify(updated));
    setBotConfig(updated);
    try {
      await fetch('/api/trading/auto-trade', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
    } catch { /* */ }
    setSaving(false);
  };

  const handleReset = () => {
    if (isRunning) {
      toast.error('Stop the bot before resetting');
      return;
    }
    setAIOpenPositions([]);
    setAIClosedTrades([]);
    setAutoTradeActivity([]);
    setBotConfig({
      totalTrades: 0, winTrades: 0, totalPnl: 0, winRate: 0,
      adminLevyCollected: 0, lastTradeAt: null, status: 'stopped',
    });
    try { localStorage.removeItem('fovi_ai_positions'); } catch { /* */ }
    try { localStorage.removeItem('fovi_ai_closed_trades'); } catch { /* */ }
    try { localStorage.removeItem('fovi_autotrade_activity'); } catch { /* */ }
    toast.success('Trade history cleared. Ready for fresh start.');
  };

  function timeAgo(dateStr: string) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return mins + 'm ago';
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    return Math.floor(hrs / 24) + 'd ago';
  }

  // ---- Helper render functions (SWC safe) ----
  function renderStatusIcon(isOpen: boolean, isBuy: boolean, pnlPos: boolean): ReactNode {
    if (isOpen && isBuy) return <ArrowUpRight className="h-4 w-4 text-emerald-500" />;
    if (isOpen) return <ArrowDownRight className="h-4 w-4 text-red-500" />;
    if (pnlPos) return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
    return <XCircle className="h-4 w-4 text-red-500" />;
  }

  function renderSideIcon(side: string): ReactNode {
    if (side === 'buy') return <ArrowUpRight className="h-3 w-3" />;
    return <ArrowDownRight className="h-3 w-3" />;
  }

  function renderPnlBadge(hasPnl: boolean, pnlPos: boolean, pnl: number): ReactNode {
    if (!hasPnl) return null;
    const colorCls = pnlPos ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500';
    const Icon = pnlPos ? TrendingUp : TrendingDown;
    return (
      <div className={'flex items-center gap-0.5 px-2 py-1 rounded-md text-xs font-bold tabular-nums shrink-0 ' + colorCls}>
        <Icon className="h-3 w-3" />
        {pnlPos ? '+' : ''}{pnl.toFixed(2)}
      </div>
    );
  }

  function renderPnlText(value: number, bold: boolean): ReactNode {
    const colorCls = value >= 0 ? 'text-emerald-500' : 'text-red-500';
    const weightCls = bold ? 'font-bold' : 'font-semibold';
    return (
      <span className={colorCls + ' ' + weightCls + ' tabular-nums'}>
        {value >= 0 ? '+' : ''}${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ---- Render ----
  return (
    <div className="space-y-4 pb-24">
      {/* ===== HERO: STATUS + EQUITY + P&L ===== */}
      <Card className={isRunning ? 'border-2 border-emerald-500/50 overflow-hidden' : isLiquidated ? 'border-2 border-red-500/50 overflow-hidden' : 'border-2 border-border/50 overflow-hidden'}>
        <div className={isRunning ? 'px-5 py-5 bg-gradient-to-r from-emerald-500/10 via-emerald-500/5 to-transparent' : isLiquidated ? 'px-5 py-5 bg-gradient-to-r from-red-500/10 via-red-500/5 to-transparent' : 'px-5 py-5 bg-muted/20'}>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className={isRunning ? 'w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg bg-gradient-to-br from-emerald-500 to-emerald-600 shadow-emerald-500/30' : isLiquidated ? 'w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg bg-gradient-to-br from-red-500 to-red-600 shadow-red-500/30' : 'w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg bg-muted-foreground/20'}>
                <Bot className="h-6 w-6 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-bold">AI Auto-Trade</h1>
                  {isRunning && (
                    <motion.span animate={{ opacity: [1, 0.4, 1] }} transition={{ duration: 2, repeat: Infinity }}
                      className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-500 text-[10px] font-bold">
                      <span className="w-2 h-2 rounded-full bg-emerald-500" /> LIVE
                    </motion.span>
                  )}
                  {isLiquidated && (
                    <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-red-500/15 text-red-500 text-[10px] font-bold">
                      <AlertTriangle className="h-3 w-3" /> LIQUIDATED
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {isRunning ? 'AI is actively scanning markets & executing trades' : isLiquidated ? 'Trading allocation has been fully consumed' : 'Configure allocation & start AI trading'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {!isLiquidated && (
                <div className="flex items-center gap-2 bg-muted/80 rounded-full px-4 py-2">
                  <span className="text-xs text-muted-foreground font-medium">AI Bot</span>
                  <Switch checked={botConfig.enabled} onCheckedChange={handleToggle} disabled={saving} className="cursor-pointer" />
                </div>
              )}
              {!isRunning && (
                <button onClick={handleReset} className="p-2 rounded-lg hover:bg-muted transition-colors cursor-pointer" title="Reset trade data">
                  <RotateCcw className="h-4 w-4 text-muted-foreground" />
                </button>
              )}
            </div>
          </div>

          {/* Allocation — always visible & editable */}
          <div className={"mt-4 p-4 rounded-xl " + (allocation <= 0 ? 'bg-amber-500/10 border border-amber-500/30' : 'bg-muted/50 border border-border/30')}>
            <div className={"flex items-center gap-2 mb-2"}>
              <Wallet className={"h-4 w-4 " + (allocation <= 0 ? 'text-amber-500' : 'text-muted-foreground')} />
              <span className={"text-sm font-semibold " + (allocation <= 0 ? 'text-amber-700 dark:text-amber-400' : 'text-foreground')}>Trading Allocation</span>
              {allocation > 0 && <Badge variant="outline" className="text-[10px] h-5 ml-auto">{'$'}{allocation.toLocaleString()}</Badge>}
            </div>
            <p className="text-[11px] text-muted-foreground mb-3">Enter the amount you want the AI to trade with. This is the maximum you can lose.</p>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative w-36">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">{'$'}</span>
                <Input type="number" placeholder="200" value={botConfig.allocationAmount || ''} onChange={e => {
                  const val = parseFloat(e.target.value) || 0;
                  setBotConfig({ allocationAmount: val });
                  try { localStorage.setItem('fovi_autotrade_config', JSON.stringify({ ...useTradingStore.getState().botConfig, allocationAmount: val })); } catch { /* */ }
                }} className="pl-7 h-11 text-lg font-bold" />
              </div>
              {allocation <= 0 && (
                <div className="flex gap-1.5">
                  {[50, 100, 200, 500, 1000].map(amt => (
                    <button key={amt} onClick={() => {
                      setBotConfig({ allocationAmount: amt });
                      try { localStorage.setItem('fovi_autotrade_config', JSON.stringify({ ...useTradingStore.getState().botConfig, allocationAmount: amt })); } catch { /* */ }
                    }} className={"px-3 py-2 text-xs font-bold rounded-lg border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-400 transition-colors cursor-pointer"}>
                      {'$'}{amt}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 mt-5">
            <div>
              <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">Account Equity</p>
              <p className={'text-2xl font-bold tabular-nums mt-1 ' + (accountEquity >= allocation ? 'text-emerald-500' : 'text-red-500')}>
                {'$'}{accountEquity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">of {'$'}{allocation.toLocaleString()} allocated</p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">Total P&L</p>
              <p className={totalPnl >= 0 ? 'text-2xl font-bold tabular-nums mt-1 text-emerald-500' : 'text-2xl font-bold tabular-nums mt-1 text-red-500'}>
                {totalPnl >= 0 ? '+' : ''}{'$'}{totalPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
              <p className={equityPercent >= 0 ? 'text-[10px] mt-0.5 text-emerald-500' : 'text-[10px] mt-0.5 text-red-500'}>
                {equityPercent >= 0 ? '+' : ''}{equityPercent}%
              </p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">Open Positions</p>
              <p className="text-2xl font-bold tabular-nums mt-1">{openPositions.length}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">of {botConfig.maxPositions} max</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-4 divide-x divide-border/50">
          <div className="px-4 py-3 text-center">
            <p className="text-lg font-bold tabular-nums">{botConfig.totalTrades}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Total Trades</p>
          </div>
          <div className="px-4 py-3 text-center">
            <p className={botConfig.winRate >= 50 ? 'text-lg font-bold tabular-nums text-emerald-500' : 'text-lg font-bold tabular-nums text-amber-500'}>{botConfig.winRate}%</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Win Rate</p>
            <p className={botConfig.winRate >= 50 ? 'text-[9px] mt-0.5 text-emerald-500' : 'text-[9px] mt-0.5 text-amber-500'}>{botConfig.winRate >= 50 ? 'profitable' : 'needs improvement'}</p>
          </div>
          <div className="px-4 py-3 text-center">
            {renderPnlText(netRealizedPnl, false)}
            <p className="text-[10px] text-muted-foreground mt-0.5">Realized P&L</p>
            <p className="text-[9px] mt-0.5 text-muted-foreground">after {levyPercent}% levy</p>
          </div>
          <div className="px-4 py-3 text-center">
            {renderPnlText(unrealizedPnl, false)}
            <p className="text-[10px] text-muted-foreground mt-0.5">Unrealized P&L</p>
            <p className="text-[9px] mt-0.5 text-muted-foreground">open positions</p>
          </div>
        </div>

        {/* Admin Levy + Available Balance bar */}
        {allocation > 0 && (
          <div className="px-5 py-3 border-t border-border/50 bg-muted/10">
            <div className="flex items-center justify-between text-[10px]">
              <div className="flex items-center gap-3">
                <span className="text-muted-foreground">Available: <span className="font-semibold text-foreground">${availableBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></span>
                <span className="text-muted-foreground">Invested: <span className="font-semibold text-foreground">${investedAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></span>
              </div>
              <span className="text-muted-foreground">Admin Levy Collected: <span className="font-semibold text-amber-500">${totalAdminLevy.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></span>
            </div>
            {/* Equity bar */}
            <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className={accountEquity >= allocation ? 'h-full bg-emerald-500 rounded-full transition-all duration-500' : 'h-full bg-red-500 rounded-full transition-all duration-500'}
                style={{ width: Math.max(0, Math.min(100, (accountEquity / allocation) * 100)) + '%' }}
              />
            </div>
          </div>
        )}
      </Card>

      {/* ===== CONFIG (collapsible) ===== */}
      <button onClick={() => setShowConfig(!showConfig)} className="w-full flex items-center justify-between py-1 cursor-pointer">
        <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
          <Settings2 className="h-3.5 w-3.5" /> Trading Configuration
        </span>
        {showConfig ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>
      <AnimatePresence>
        {showConfig && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <Card className="border-border/50">
              <CardContent className="p-4 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div>
                    <label className="text-xs text-muted-foreground font-medium mb-1 flex items-center gap-1">
                      <Percent className="h-3 w-3" /> Admin Levy (%)
                    </label>
                    <Input type="number" min={0} max={50} step={0.5} value={botConfig.adminLevyPercent}
                      onChange={e => setBotConfig({ adminLevyPercent: parseFloat(e.target.value) || 10 })} className="h-10" />
                    <p className="text-[9px] text-muted-foreground mt-1">% of profit deducted per closed trade</p>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground font-medium mb-1 block">Strategy</label>
                    <div className="grid grid-cols-2 gap-1.5">
                      {[
                        { id: 'conservative', icon: Shield, label: 'Conservative', c: 'text-emerald-500' },
                        { id: 'balanced', icon: Target, label: 'Balanced', c: 'text-amber-500' },
                        { id: 'aggressive', icon: Zap, label: 'Aggressive', c: 'text-red-500' },
                        { id: 'scalping', icon: Activity, label: 'Scalping', c: 'text-primary' },
                      ].map(s => {
                        const Icon = s.icon;
                        const isActive = botConfig.strategy === s.id;
                        return (
                          <button key={s.id} onClick={() => setBotConfig({ strategy: s.id })}
                            className={isActive ? 'flex items-center gap-1.5 px-2 py-1.5 rounded-lg border text-[11px] font-medium transition-colors cursor-pointer border-primary/40 bg-primary/10 ' + s.c : 'flex items-center gap-1.5 px-2 py-1.5 rounded-lg border text-[11px] font-medium transition-colors cursor-pointer border-border hover:bg-accent/50'}>
                            <Icon className="h-3 w-3" />{s.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs text-muted-foreground font-medium mb-1 block">Max Positions</label>
                      <Input type="number" min={1} max={20} value={botConfig.maxPositions}
                        onChange={e => setBotConfig({ maxPositions: parseInt(e.target.value) || 5 })} className="h-10" />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-muted-foreground">Stop Loss %</label>
                        <Input type="number" step={0.5} value={botConfig.stopLossPercent}
                          onChange={e => setBotConfig({ stopLossPercent: parseFloat(e.target.value) || 2 })} className="h-9 text-sm" />
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground">Take Profit %</label>
                        <Input type="number" step={0.5} value={botConfig.takeProfitPercent}
                          onChange={e => setBotConfig({ takeProfitPercent: parseFloat(e.target.value) || 4 })} className="h-9 text-sm" />
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ===== OPEN POSITIONS ===== */}
      <Card className="border-border/50 overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4" />
            <h3 className="text-sm font-semibold">Open Positions</h3>
            <Badge variant="secondary" className="text-[10px] h-5">{openPositions.length}</Badge>
          </div>
          <div className={unrealizedPnl >= 0 ? 'text-sm font-bold tabular-nums text-emerald-500' : 'text-sm font-bold tabular-nums text-red-500'}>
            Unrealized: {unrealizedPnl >= 0 ? '+' : ''}${unrealizedPnl.toFixed(2)}
          </div>
        </div>

        {openPositions.length === 0 ? (
          <div className="px-4 py-8 text-center text-muted-foreground text-sm">
            {isRunning ? 'AI is scanning for opportunities...' : isLiquidated ? 'All positions were liquidated' : 'Start AI trading to see open positions here'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 text-[10px] text-muted-foreground uppercase tracking-wider">
                  <th className="text-left px-4 py-2 font-medium">Symbol</th>
                  <th className="text-left px-3 py-2 font-medium">Side</th>
                  <th className="text-right px-3 py-2 font-medium">Qty</th>
                  <th className="text-right px-3 py-2 font-medium">Value</th>
                  <th className="text-right px-3 py-2 font-medium">Entry</th>
                  <th className="text-right px-3 py-2 font-medium">Current</th>
                  <th className="text-right px-3 py-2 font-medium">P&L</th>
                  <th className="text-right px-3 py-2 font-medium">Signal</th>
                  <th className="text-right px-4 py-2 font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {openPositions.map(pos => {
                  const isProfit = pos.unrealizedPnl >= 0;
                  const sideLabel = pos.side === 'buy' ? 'LONG' : 'SHORT';
                  const sideColor = pos.side === 'buy' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500';
                  const pnlColor = isProfit ? 'text-emerald-500' : 'text-red-500';
                  const posValue = parseFloat((pos.currentPrice * pos.qty).toFixed(2));
                  return (
                    <tr key={pos.id} className="border-b border-border/30 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-2.5 font-bold">{pos.symbol}</td>
                      <td className="px-3 py-2.5">
                        <span className={'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ' + sideColor}>
                          {renderSideIcon(pos.side)}
                          {sideLabel}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{pos.qty}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">${posValue.toFixed(2)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">${pos.entryPrice.toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">${pos.currentPrice.toLocaleString()}</td>
                      <td className={'px-3 py-2.5 text-right font-bold tabular-nums ' + pnlColor}>
                        {isProfit ? '+' : ''}${pos.unrealizedPnl.toFixed(2)}
                      </td>
                      <td className="px-3 py-2.5 text-right text-[10px] text-muted-foreground capitalize">{pos.signalType ? pos.signalType.replace('_', ' ') : ''}</td>
                      <td className="px-4 py-2.5 text-right text-[10px] text-muted-foreground">{timeAgo(pos.openedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ===== LIVE TRADE FEED ===== */}
      <Card className="border-border/50 overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            <h3 className="text-sm font-semibold">Live Trade Feed</h3>
            {isRunning && (
              <motion.span animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.5, repeat: Infinity }}
                className="w-2 h-2 rounded-full bg-emerald-500" />
            )}
          </div>
          <Badge variant="secondary" className="text-[10px] h-5">{activityList.length} events</Badge>
        </div>

        {activityList.length === 0 ? (
          <div className="px-4 py-8 text-center text-muted-foreground text-sm">
            {isRunning ? 'Waiting for first trade...' : 'No trade activity yet'}
          </div>
        ) : (
          <div className="max-h-80 overflow-y-auto">
            {activityList.slice(0, 30).map(act => {
              const isBuy = act.side === 'buy';
              const pnl = act.pnl;
              const hasPnl = pnl != null && pnl !== 0;
              const pnlPos = hasPnl && pnl >= 0;
              const isOpen = !hasPnl || pnl === 0;
              const iconBg = isBuy ? 'bg-emerald-500/10' : 'bg-red-500/10';
              const statusBadge = isOpen ? 'OPENED' : 'CLOSED';

              return (
                <div key={act.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-border/30 hover:bg-muted/20 transition-colors">
                  <div className={'w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ' + iconBg}>
                    {renderStatusIcon(isOpen, isBuy, pnlPos)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-bold">{act.symbol}</span>
                      <Badge variant="outline" className="text-[9px] uppercase h-4">
                        {statusBadge}
                      </Badge>
                      {act.signalType && (
                        <Badge variant="secondary" className="text-[8px] h-3.5 bg-primary/5 text-primary">
                          {act.signalConfidence}%
                        </Badge>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {act.qty} @ ${act.filledPrice?.toLocaleString() || '—'} · {timeAgo(act.createdAt)}
                    </p>
                  </div>
                  {renderPnlBadge(hasPnl, pnlPos, pnl!)}
                  {!isOpen && !hasPnl && (
                    <span className="text-[10px] text-muted-foreground shrink-0">OPEN</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* ===== TRADE HISTORY ===== */}
      <Card className="border-border/50 overflow-hidden">
        <button onClick={() => setShowHistory(!showHistory)} className="w-full px-4 py-3 border-b border-border flex items-center justify-between cursor-pointer">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            <h3 className="text-sm font-semibold">Trade History</h3>
            <Badge variant="secondary" className="text-[10px] h-5">{filteredTrades.length} of {closedTrades.length}</Badge>
          </div>
          {showHistory ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </button>

        <AnimatePresence>
          {showHistory && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
              {/* Filters */}
              {closedTrades.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-border/50 bg-muted/20">
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-muted-foreground font-medium">P&L:</span>
                    {['all', 'profit', 'loss'].map(f => (
                      <button key={f} onClick={() => setHistoryFilter(f)}
                        className={'px-2 py-0.5 text-[10px] font-medium rounded-md transition-colors cursor-pointer ' + (historyFilter === f ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent')}>
                        {f.charAt(0).toUpperCase() + f.slice(1)}
                      </button>
                    ))}
                  </div>
                  {uniqueSymbols.length > 1 && (
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-muted-foreground font-medium">Symbol:</span>
                      <select value={historySymbol} onChange={e => setHistorySymbol(e.target.value)}
                        className="h-6 text-[10px] bg-muted border border-border rounded-md px-1.5 outline-none cursor-pointer">
                        <option value="all">All</option>
                        {uniqueSymbols.map(s => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}
              {filteredTrades.length === 0 ? (
                <div className="px-4 py-8 text-center text-muted-foreground text-sm">No trades match filters</div>
              ) : (
                <div className="overflow-x-auto max-h-96 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-card">
                      <tr className="border-b border-border/50 text-[10px] text-muted-foreground uppercase tracking-wider">
                        <th className="text-left px-4 py-2 font-medium">Symbol</th>
                        <th className="text-left px-3 py-2 font-medium">Side</th>
                        <th className="text-right px-3 py-2 font-medium">Qty</th>
                        <th className="text-right px-3 py-2 font-medium">Entry</th>
                        <th className="text-right px-3 py-2 font-medium">Exit</th>
                        <th className="text-right px-3 py-2 font-medium">Gross P&L</th>
                        <th className="text-right px-3 py-2 font-medium">Levy</th>
                        <th className="text-right px-3 py-2 font-medium">Net P&L</th>
                        <th className="text-right px-3 py-2 font-medium">Duration</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTrades.map(trade => {
                        const isProfit = trade.realizedPnl >= 0;
                        const gross = trade.grossPnl ?? trade.realizedPnl;
                        const levy = trade.adminLevy || 0;
                        const duration = Math.round((new Date(trade.closedAt).getTime() - new Date(trade.openedAt).getTime()) / 60000);
                        const sideLabel = trade.side === 'buy' ? 'LONG' : 'SHORT';
                        const sideColor = trade.side === 'buy' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500';
                        const netColor = isProfit ? 'text-emerald-500' : 'text-red-500';
                        const durLabel = duration < 1 ? '<1m' : duration + 'm';
                        return (
                          <tr key={trade.id} className="border-b border-border/30 hover:bg-muted/30 transition-colors">
                            <td className="px-4 py-2.5 font-bold">{trade.symbol}</td>
                            <td className="px-3 py-2.5">
                              <span className={'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ' + sideColor}>
                                {renderSideIcon(trade.side)}
                                {sideLabel}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums">{trade.qty}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums">${trade.entryPrice.toLocaleString()}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums">${trade.exitPrice.toLocaleString()}</td>
                            <td className={'px-3 py-2.5 text-right tabular-nums ' + (gross >= 0 ? 'text-emerald-500/70' : 'text-red-500/70')}>
                              {gross >= 0 ? '+' : ''}${gross.toFixed(2)}
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-amber-500">
                              {levy > 0 ? '-$' + levy.toFixed(2) : '—'}
                            </td>
                            <td className={'px-3 py-2.5 text-right font-bold tabular-nums ' + netColor}>
                              {isProfit ? '+' : ''}${trade.realizedPnl.toFixed(2)}
                            </td>
                            <td className="px-3 py-2.5 text-right text-[10px] text-muted-foreground">{durLabel}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
    </div>
  );
}