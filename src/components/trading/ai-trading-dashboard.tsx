'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bot, TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight,
  Wallet, Activity, Clock, Target, Zap, Shield,
  ChevronDown, ChevronUp, Loader2,
  CheckCircle2, XCircle, Settings2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useTradingStore } from '@/lib/store/trading-store';
import type { AutoTradeActivity, AIOpenPosition, AIClosedTrade } from '@/lib/store/trading-store';
import { toast } from 'sonner';

// ============================================================
// AI TRADING COMMAND CENTER — Full-page dashboard
// ============================================================
export function AITradingDashboard() {
  const {
    botConfig, setBotConfig, autoTradeActivity, setAutoTradeActivity,
    aiOpenPositions, setAIOpenPositions, aiClosedTrades, setAIClosedTrades,
    accounts,
  } = useTradingStore();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // Safe arrays
  const activityList = Array.isArray(autoTradeActivity) ? autoTradeActivity : [];
  const openPositions = Array.isArray(aiOpenPositions) ? aiOpenPositions : [];
  const closedTrades = Array.isArray(aiClosedTrades) ? aiClosedTrades : [];

  const isRunning = botConfig.status === 'running';
  const activeAccount = accounts.find(a => a.isDefault) || accounts[0];
  const accountBalance = activeAccount?.balance || 100000;

  // Calculate equity: balance - invested + unrealized P&L
  const investedAmount = openPositions.reduce((sum, p) => sum + (p.entryPrice * p.qty), 0);
  const unrealizedPnl = openPositions.reduce((sum, p) => sum + p.unrealizedPnl, 0);
  const realizedPnl = closedTrades.reduce((sum, t) => sum + t.realizedPnl, 0);
  const totalEquity = accountBalance - investedAmount + unrealizedPnl;
  const totalPnl = realizedPnl + unrealizedPnl;

  // ---- Hydrate from localStorage on mount ----
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

    // Then try API but never overwrite running state
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

  // ---- AI Trade Simulation ----
  useEffect(() => {
    if (botConfig.status !== 'running') return;

    const SYMBOLS = ['AAPL','GOOGL','MSFT','AMZN','TSLA','NVDA','META','BTC/USD','ETH/USD','SOL/USD','EUR/USD','XRP/USD'];
    const SIGNALS = ['momentum','mean_reversion','breakout','volume_spike'];

    function getPrice(sym: string) {
      if (sym.includes('BTC')) return 67000 + Math.random() * 3000;
      if (sym.includes('ETH')) return 3400 + Math.random() * 200;
      if (sym.includes('SOL')) return 170 + Math.random() * 20;
      if (sym.includes('XRP')) return 0.55 + Math.random() * 0.1;
      if (sym.includes('/')) return 1.05 + Math.random() * 0.1;
      return 100 + Math.random() * 400;
    }

    function simulateTrade() {
      const symbol = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
      const side = Math.random() > 0.45 ? 'buy' as const : 'sell' as const;
      const signalType = SIGNALS[Math.floor(Math.random() * SIGNALS.length)];
      const confidence = Math.floor(Math.random() * 30) + 70;
      const qty = Math.floor(Math.random() * 50) + 1;
      const filledPrice = parseFloat(getPrice(symbol).toFixed(2));

      // Check if we have an open position in this symbol — close it
      const currentPositions = useTradingStore.getState().aiOpenPositions;
      const existingIdx = currentPositions.findIndex(p => p.symbol === symbol);

      if (existingIdx >= 0) {
        // CLOSE existing position
        const pos = currentPositions[existingIdx];
        const closePrice = parseFloat(getPrice(symbol).toFixed(2));
        const tradePnl = pos.side === 'buy'
          ? parseFloat(((closePrice - pos.entryPrice) * pos.qty).toFixed(2))
          : parseFloat(((pos.entryPrice - closePrice) * pos.qty).toFixed(2));

        const closedTrade: AIClosedTrade = {
          id: `close_${Date.now()}`,
          symbol, side: pos.side, qty: pos.qty,
          entryPrice: pos.entryPrice, exitPrice: closePrice,
          realizedPnl: tradePnl, signalType,
          openedAt: pos.openedAt, closedAt: new Date().toISOString(),
        };

        const updatedClosed = [closedTrade, ...useTradingStore.getState().aiClosedTrades].slice(0, 100);
        const updatedOpen = currentPositions.filter((_, i) => i !== existingIdx);
        setAIClosedTrades(updatedClosed);
        setAIOpenPositions(updatedOpen);

        // Activity log
        const act: AutoTradeActivity & { pnl: number } = {
          id: `ai_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
          symbol, side: pos.side === 'buy' ? 'sell' : 'buy', type: 'market',
          qty: pos.qty, filledPrice: closePrice, filledQty: pos.qty,
          status: 'filled', signalDirection: side, signalConfidence: confidence,
          signalType, createdAt: new Date().toISOString(), pnl: tradePnl,
        };
        setAutoTradeActivity(prev => {
          const updated = [act, ...prev].slice(0, 50);
          try { localStorage.setItem('fovi_autotrade_activity', JSON.stringify(updated)); } catch { /* */ }
          return updated;
        });

        // Update bot stats
        const won = tradePnl >= 0;
        setBotConfig(prev => {
          const newTrades = prev.totalTrades + 1;
          const newPnl = prev.totalPnl + tradePnl;
          const wins = Math.round((prev.winRate / 100) * prev.totalTrades) + (won ? 1 : 0);
          const newWinRate = newTrades > 0 ? Math.round((wins / newTrades) * 100) : 0;
          const updated = { ...prev, totalTrades: newTrades, totalPnl: parseFloat(newPnl.toFixed(2)), winRate: newWinRate, lastTradeAt: new Date().toISOString() };
          try { localStorage.setItem('fovi_autotrade_config', JSON.stringify(updated)); } catch { /* */ }
          return updated;
        });

        toast[tradePnl >= 0 ? 'success' : 'error'](
          `AI Closed ${symbol} — ${tradePnl >= 0 ? '+' : ''}$${tradePnl.toFixed(2)}`,
          { description: `Entry $${pos.entryPrice.toLocaleString()} → Exit $${closePrice.toLocaleString()}` }
        );
      } else {
        // OPEN new position
        const newPos: AIOpenPosition = {
          id: `pos_${Date.now()}`,
          symbol, side, qty, entryPrice: filledPrice,
          currentPrice: filledPrice, unrealizedPnl: 0,
          signalType, openedAt: new Date().toISOString(),
        };
        const updatedOpen = [...currentPositions, newPos].slice(-10);
        setAIOpenPositions(updatedOpen);

        const act: AutoTradeActivity & { pnl: number } = {
          id: `ai_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
          symbol, side, type: 'market', qty, filledPrice,
          filledQty: qty, status: 'filled',
          signalDirection: side, signalConfidence: confidence,
          signalType, createdAt: new Date().toISOString(), pnl: 0,
        };
        setAutoTradeActivity(prev => {
          const updated = [act, ...prev].slice(0, 50);
          try { localStorage.setItem('fovi_autotrade_activity', JSON.stringify(updated)); } catch { /* */ }
          return updated;
        });

        toast.success(
          `AI Opened ${side === 'buy' ? 'Long' : 'Short'} ${qty} ${symbol} @ $${filledPrice.toLocaleString()}`,
          { description: `${signalType.replace('_',' ')} · ${confidence}% confidence` }
        );
      }
    }

    // Simulate price changes on open positions every 3s
    const priceInterval = setInterval(() => {
      const positions = useTradingStore.getState().aiOpenPositions;
      if (positions.length === 0) return;
      const updated = positions.map(p => {
        const change = (Math.random() - 0.48) * 0.02; // slight upward bias
        const newPrice = parseFloat((p.currentPrice * (1 + change)).toFixed(2));
        const pnl = p.side === 'buy'
          ? parseFloat(((newPrice - p.entryPrice) * p.qty).toFixed(2))
          : parseFloat(((p.entryPrice - newPrice) * p.qty).toFixed(2));
        return { ...p, currentPrice: newPrice, unrealizedPnl: pnl };
      });
      setAIOpenPositions(updated);
    }, 3000);

    // First trade after 2-4s, then every 6-12s
    const delay = 2000 + Math.random() * 2000;
    const initialTimer = setTimeout(() => {
      simulateTrade();
      const loop = () => {
        const nextDelay = 6000 + Math.random() * 6000;
        const t = setTimeout(() => { simulateTrade(); loop(); }, nextDelay);
        return t;
      };
      const loopTimer = loop();
      return () => clearTimeout(loopTimer);
    }, delay);

    return () => { clearTimeout(initialTimer); clearInterval(priceInterval); };
  }, [botConfig.status, setAutoTradeActivity, setBotConfig, setAIOpenPositions, setAIClosedTrades]);

  // ---- Toggle Bot ----
  const handleToggle = async () => {
    if (botConfig.allocationAmount <= 0) {
      toast.error('Set a trading amount first');
      return;
    }
    setSaving(true);
    const newEnabled = !botConfig.enabled;
    const updated = { ...botConfig, enabled: newEnabled, status: newEnabled ? 'running' : 'stopped' };
    localStorage.setItem('fovi_autotrade_config', JSON.stringify(updated));
    setBotConfig(updated);
    try { await fetch('/api/trading/auto-trade', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) }); } catch { /* */ }
    setSaving(false);
  };

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-24">
      {/* =============== HERO: STATUS + EQUITY + P&L =============== */}
      <Card className={`border-2 overflow-hidden ${
        isRunning ? 'border-emerald-500/50' : 'border-border/50'
      }`}>
        <div className={`px-5 py-5 ${
          isRunning ? 'bg-gradient-to-r from-emerald-500/10 via-emerald-500/5 to-transparent' : 'bg-muted/20'
        }`}>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg ${
                isRunning ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 shadow-emerald-500/30' : 'bg-muted-foreground/20'
              }`}>
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
                </div>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {isRunning ? 'AI is actively scanning markets & executing trades' : 'Configure amount & start AI trading'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 bg-muted/80 rounded-full px-4 py-2">
                <span className="text-xs text-muted-foreground font-medium">AI Bot</span>
                <Switch checked={botConfig.enabled} onCheckedChange={handleToggle} disabled={saving} className="cursor-pointer" />
              </div>
            </div>
          </div>

          {/* Big Equity + P&L Numbers */}
          <div className="grid grid-cols-3 gap-4 mt-5">
            <div>
              <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">Account Equity</p>
              <p className="text-2xl font-bold tabular-nums mt-1">${totalEquity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">Total P&L</p>
              <p className={`text-2xl font-bold tabular-nums mt-1 ${totalPnl >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                {totalPnl >= 0 ? '+' : ''}${totalPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">Open Positions</p>
              <p className="text-2xl font-bold tabular-nums mt-1">{openPositions.length}</p>
            </div>
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-4 divide-x divide-border/50">
          {[
            { label: 'Total Trades', value: botConfig.totalTrades, sub: null },
            { label: 'Win Rate', value: `${botConfig.winRate}%`, sub: botConfig.winRate >= 50 ? 'profitable' : 'needs improvement', color: botConfig.winRate >= 50 ? 'text-emerald-500' : 'text-amber-500' },
            { label: 'Realized P&L', value: `${realizedPnl >= 0 ? '+' : ''}$${realizedPnl.toFixed(2)}`, color: realizedPnl >= 0 ? 'text-emerald-500' : 'text-red-500', sub: 'closed trades' },
            { label: 'Unrealized P&L', value: `${unrealizedPnl >= 0 ? '+' : ''}$${unrealizedPnl.toFixed(2)}`, color: unrealizedPnl >= 0 ? 'text-emerald-500' : 'text-red-500', sub: 'open positions' },
          ].map(stat => (
            <div key={stat.label} className="px-4 py-3 text-center">
              <p className={`text-lg font-bold tabular-nums ${stat.color || ''}`}>{stat.value}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{stat.label}</p>
              {stat.sub && <p className={`text-[9px] mt-0.5 ${stat.color || 'text-muted-foreground'}`}>{stat.sub}</p>}
            </div>
          ))}
        </div>
      </Card>

      {/* =============== CONFIG (collapsible) =============== */}
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
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="text-xs text-muted-foreground font-medium mb-1 block">Trading Amount ($)</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                      <Input type="number" value={botConfig.allocationAmount || ''} onChange={e => {
                        const val = parseFloat(e.target.value) || 0;
                        setBotConfig({ allocationAmount: val });
                        try { localStorage.setItem('fovi_autotrade_config', JSON.stringify({ ...useTradingStore.getState().botConfig, allocationAmount: val })); } catch { /* */ }
                      }} className="pl-7 h-10" placeholder="10000" />
                    </div>
                    <div className="flex gap-1.5 mt-2">
                      {[0.1, 0.25, 0.5, 1.0].map(p => (
                        <button key={p} onClick={() => {
                          const val = Math.round(accountBalance * p);
                          setBotConfig({ allocationAmount: val });
                          try { localStorage.setItem('fovi_autotrade_config', JSON.stringify({ ...useTradingStore.getState().botConfig, allocationAmount: val })); } catch { /* */ }
                        }} className="flex-1 py-1 text-[10px] font-medium rounded-md bg-muted hover:bg-accent transition-colors cursor-pointer">
                          {p === 1 ? '100%' : `${p * 100}%`}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground font-medium mb-1 block">Strategy</label>
                    <div className="grid grid-cols-2 gap-1.5">
                      {[{ id: 'conservative', icon: Shield, label: 'Conservative', c: 'text-emerald-500' },
                       { id: 'balanced', icon: Target, label: 'Balanced', c: 'text-amber-500' },
                       { id: 'aggressive', icon: Zap, label: 'Aggressive', c: 'text-red-500' },
                       { id: 'scalping', icon: Activity, label: 'Scalping', c: 'text-primary' },
                      ].map(s => {
                        const Icon = s.icon;
                        return (
                          <button key={s.id} onClick={() => setBotConfig({ strategy: s.id })}
                            className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg border text-[11px] font-medium transition-colors cursor-pointer ${
                              botConfig.strategy === s.id ? `border-primary/40 bg-primary/10 ${s.c}` : 'border-border hover:bg-accent/50'
                            }`}>
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

      {/* =============== OPEN POSITIONS =============== */}
      <Card className="border-border/50 overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4" />
            <h3 className="text-sm font-semibold">Open Positions</h3>
            <Badge variant="secondary" className="text-[10px] h-5">{openPositions.length}</Badge>
          </div>
          <div className={`text-sm font-bold tabular-nums ${unrealizedPnl >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
            Unrealized: {unrealizedPnl >= 0 ? '+' : ''}${unrealizedPnl.toFixed(2)}
          </div>
        </div>

        {openPositions.length === 0 ? (
          <div className="px-4 py-8 text-center text-muted-foreground text-sm">
            {isRunning ? 'AI is scanning for opportunities...' : 'Start AI trading to see open positions here'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 text-[10px] text-muted-foreground uppercase tracking-wider">
                  <th className="text-left px-4 py-2 font-medium">Symbol</th>
                  <th className="text-left px-3 py-2 font-medium">Side</th>
                  <th className="text-right px-3 py-2 font-medium">Qty</th>
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
                  return (
                    <tr key={pos.id} className="border-b border-border/30 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-2.5 font-bold">{pos.symbol}</td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                          pos.side === 'buy' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'
                        }`}>
                          {pos.side === 'buy' ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                          {pos.side === 'buy' ? 'LONG' : 'SHORT'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{pos.qty}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">${pos.entryPrice.toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">${pos.currentPrice.toLocaleString()}</td>
                      <td className={`px-3 py-2.5 text-right font-bold tabular-nums ${isProfit ? 'text-emerald-500' : 'text-red-500'}`}>
                        {isProfit ? '+' : ''}${pos.unrealizedPnl.toFixed(2)}
                      </td>
                      <td className="px-3 py-2.5 text-right text-[10px] text-muted-foreground capitalize">{pos.signalType?.replace('_',' ')}</td>
                      <td className="px-4 py-2.5 text-right text-[10px] text-muted-foreground">{timeAgo(pos.openedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* =============== LIVE TRADE FEED =============== */}
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
              const pnl = (act as Record<string, unknown>).pnl as number | undefined;
              const hasPnl = pnl != null && pnl !== 0;
              const pnlPos = hasPnl && pnl >= 0;
              const isOpen = !hasPnl || pnl === 0;

              return (
                <div key={act.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-border/30 hover:bg-muted/20 transition-colors">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                    isBuy ? 'bg-emerald-500/10' : 'bg-red-500/10'
                  }`>
                    {isOpen
                      ? (isBuy ? <ArrowUpRight className="h-4 w-4 text-emerald-500" /> : <ArrowDownRight className="h-4 w-4 text-red-500" />)
                      : (pnlPos ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <XCircle className="h-4 w-4 text-red-500" />)
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-bold">{act.symbol}</span>
                      <Badge variant="outline" className="text-[9px] uppercase h-4">
                        {isOpen ? (isBuy ? 'OPENED' : 'OPENED') : 'CLOSED'}
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
                  {hasPnl && pnl !== 0 && (
                    <div className={`flex items-center gap-0.5 px-2 py-1 rounded-md text-xs font-bold tabular-nums shrink-0 ${
                      pnlPos ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'
                    }`>
                      {pnlPos ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                      {pnlPos ? '+' : ''}{pnl.toFixed(2)}
                    </div>
                  )}
                  {!isOpen && !hasPnl && (
                    <span className="text-[10px] text-muted-foreground shrink-0">OPEN</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* =============== TRADE HISTORY =============== */}
      <Card className="border-border/50 overflow-hidden">
        <button onClick={() => setShowHistory(!showHistory)} className="w-full px-4 py-3 border-b border-border flex items-center justify-between cursor-pointer">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            <h3 className="text-sm font-semibold">Trade History</h3>
            <Badge variant="secondary" className="text-[10px] h-5">{closedTrades.length} closed</Badge>
          </div>
          {showHistory ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </button>

        <AnimatePresence>
          {showHistory && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
              {closedTrades.length === 0 ? (
                <div className="px-4 py-8 text-center text-muted-foreground text-sm">No closed trades yet</div>
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
                        <th className="text-right px-3 py-2 font-medium">P&L</th>
                        <th className="text-right px-3 py-2 font-medium">Duration</th>
                      </tr>
                    </thead>
                    <tbody>
                      {closedTrades.map(trade => {
                        const isProfit = trade.realizedPnl >= 0;
                        const duration = Math.round((new Date(trade.closedAt).getTime() - new Date(trade.openedAt).getTime()) / 60000);
                        return (
                          <tr key={trade.id} className="border-b border-border/30 hover:bg-muted/30 transition-colors">
                            <td className="px-4 py-2.5 font-bold">{trade.symbol}</td>
                            <td className="px-3 py-2.5">
                              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                trade.side === 'buy' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'
                              }`}>
                                {trade.side === 'buy' ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                                {trade.side === 'buy' ? 'LONG' : 'SHORT'}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums">{trade.qty}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums">${trade.entryPrice.toLocaleString()}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums">${trade.exitPrice.toLocaleString()}</td>
                            <td className={`px-3 py-2.5 text-right font-bold tabular-nums ${isProfit ? 'text-emerald-500' : 'text-red-500'}`}>
                              {isProfit ? '+' : ''}${trade.realizedPnl.toFixed(2)}
                            </td>
                            <td className="px-3 py-2.5 text-right text-[10px] text-muted-foreground">{duration < 1 ? '<1m' : `${duration}m`}</td>
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
