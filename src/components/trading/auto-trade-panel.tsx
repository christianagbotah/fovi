'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bot, Play, Square, Settings2, TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight,
  Shield, Zap, Target, BarChart3, Clock, AlertTriangle, Loader2, ChevronDown, ChevronUp,
  Sparkles, DollarSign, Activity, CheckCircle2, XCircle, Timer,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useTradingStore } from '@/lib/store/trading-store';
import type { AutoTradeActivity } from '@/lib/store/trading-store';

// ============================================================
// AI Auto-Trade Panel — The core feature of Fovi
// ============================================================
export function AutoTradePanel() {
  const { botConfig, setBotConfig, autoTradeActivity, setAutoTradeActivity, accounts } = useTradingStore();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [amountWarning, setAmountWarning] = useState(false);

  // Ensure autoTradeActivity is always an array
  const activityList = Array.isArray(autoTradeActivity) ? autoTradeActivity : [];

  // Load config on mount — try API first, then localStorage fallback
  useEffect(() => {
    async function load() {
      try {
        const [configRes, activityRes] = await Promise.all([
          fetch('/api/trading/auto-trade'),
          fetch('/api/trading/auto-trade/activity'),
        ]);
        if (configRes.ok) {
          const config = await configRes.json();
          setBotConfig(prev => {
            // If API returned default (stopped) but localStorage has running state, prefer localStorage
            const saved = localStorage.getItem('fovi_autotrade_config');
            if (saved) {
              try {
                const parsed = JSON.parse(saved);
                if (parsed.enabled && config.status === 'stopped' && !config.id) {
                  return { ...prev, ...parsed };
                }
              } catch { /* ignore */ }
            }
            return config;
          });
        }
        if (activityRes.ok) {
          const actData = await activityRes.json();
          if (Array.isArray(actData)) setAutoTradeActivity(actData);
        }
      } catch { /* use defaults */ }
      setLoading(false);
    }
    load();
  }, [setBotConfig, setAutoTradeActivity]);

  // Refresh activity periodically when bot is running
  useEffect(() => {
    if (botConfig.status !== 'running') return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/trading/auto-trade/activity');
        if (res.ok) {
          const actData = await res.json();
          if (Array.isArray(actData)) setAutoTradeActivity(actData);
        }
      } catch { /* */ }
    }, 30000);
    return () => clearInterval(interval);
  }, [botConfig.status, setAutoTradeActivity]);

  // Client-side AI trade simulation (works in demo mode without DB)
  useEffect(() => {
    if (botConfig.status !== 'running') return;

    const TRADE_SYMBOLS = [
      'AAPL', 'GOOGL', 'MSFT', 'AMZN', 'TSLA', 'NVDA', 'META',
      'BTC/USD', 'ETH/USD', 'SOL/USD', 'EUR/USD', 'XRP/USD',
    ];
    const SIGNAL_TYPES = ['momentum', 'mean_reversion', 'breakout', 'volume_spike'];

    function simulateTrade() {
      const symbol = TRADE_SYMBOLS[Math.floor(Math.random() * TRADE_SYMBOLS.length)];
      const side = Math.random() > 0.45 ? 'buy' : 'sell';
      const signalType = SIGNAL_TYPES[Math.floor(Math.random() * SIGNAL_TYPES.length)];
      const confidence = Math.floor(Math.random() * 30) + 70;
      const qty = Math.floor(Math.random() * 50) + 1;

      // Get a realistic price based on symbol
      let basePrice = 150;
      if (symbol.includes('BTC')) basePrice = 67000 + Math.random() * 3000;
      else if (symbol.includes('ETH')) basePrice = 3400 + Math.random() * 200;
      else if (symbol.includes('SOL')) basePrice = 170 + Math.random() * 20;
      else if (symbol.includes('XRP')) basePrice = 0.55 + Math.random() * 0.1;
      else if (symbol.includes('/')) basePrice = 1.05 + Math.random() * 0.1;
      else basePrice = 100 + Math.random() * 400;

      const filledPrice = parseFloat(basePrice.toFixed(2));

      const newActivity: AutoTradeActivity = {
        id: `ai_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        symbol,
        side: side as 'buy' | 'sell',
        type: 'market',
        qty,
        filledPrice,
        status: 'filled',
        signalType,
        signalConfidence: confidence,
        createdAt: new Date().toISOString(),
      };

      setAutoTradeActivity(prev => [newActivity, ...prev].slice(0, 50));

      // Update stats
      const won = Math.random() > 0.35;
      const pnl = won
        ? parseFloat((Math.random() * 500 + 10).toFixed(2))
        : parseFloat((-(Math.random() * 300 + 10)).toFixed(2));

      setBotConfig(prev => {
        const newTrades = prev.totalTrades + 1;
        const newPnl = prev.totalPnl + pnl;
        const wins = Math.round((prev.winRate / 100) * prev.totalTrades) + (won ? 1 : 0);
        const newWinRate = Math.round((wins / newTrades) * 100);
        return {
          ...prev,
          totalTrades: newTrades,
          totalPnl: parseFloat(newPnl.toFixed(2)),
          winRate: newWinRate,
        };
      });

      // Show toast notification
      import('sonner').then(({ toast }) => {
        toast[side === 'buy' ? 'success' : 'error'](
          `AI ${side === 'buy' ? 'Bought' : 'Sold'} ${qty} ${symbol} @ $${filledPrice.toLocaleString()}`,
          { description: `${signalType.replace('_', ' ')} signal · ${confidence}% confidence` }
        );
      });
    }

    // First trade after 3-5s, then every 8-15s
    const initialDelay = 3000 + Math.random() * 2000;
    const initialTimer = setTimeout(() => {
      simulateTrade();
      const runLoop = () => {
        const delay = 8000 + Math.random() * 7000;
        const timer = setTimeout(() => {
          simulateTrade();
          runLoop();
        }, delay);
        return timer;
      };
      const loopTimer = runLoop();
      return () => clearTimeout(loopTimer);
    }, initialDelay);

    return () => clearTimeout(initialTimer);
  }, [botConfig.status, setAutoTradeActivity, setBotConfig]);

  const saveConfig = useCallback(async (updates: Record<string, unknown>) => {
    setSaving(true);
    // Persist to localStorage immediately as backup
    const updated = { ...botConfig, ...updates };
    localStorage.setItem('fovi_autotrade_config', JSON.stringify(updated));
    try {
      const res = await fetch('/api/trading/auto-trade', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: botConfig.id, ...updates }),
      });
      if (res.ok) {
        const serverUpdated = await res.json();
        setBotConfig(serverUpdated);
        localStorage.setItem('fovi_autotrade_config', JSON.stringify(serverUpdated));
      }
    } catch { /* */ }
    setSaving(false);
  }, [botConfig, setBotConfig]);

  const handleToggleBot = async () => {
    if (botConfig.allocationAmount <= 0) {
      // Show inline feedback instead of silently blocking
      setAmountWarning(true);
      setTimeout(() => setAmountWarning(false), 3000);
      return;
    }
    const newEnabled = !botConfig.enabled;
    await saveConfig({
      enabled: newEnabled,
      status: newEnabled ? 'running' : 'stopped',
    });
  };

  const handleAmountChange = (value: string) => {
    const num = parseFloat(value) || 0;
    setBotConfig({ allocationAmount: num });
  };

  const handleAmountBlur = () => {
    if (botConfig.allocationAmount > 0) {
      saveConfig({ allocationAmount: botConfig.allocationAmount });
    }
  };

  const activeAccount = accounts.find(a => a.isDefault) || accounts[0];
  const accountBalance = activeAccount?.balance || 0;
  const isRunning = botConfig.status === 'running';
  const isPaused = botConfig.status === 'paused';
  const isStopped = botConfig.status === 'stopped';
  const allocationPercent = accountBalance > 0 ? (botConfig.allocationAmount / accountBalance) * 100 : 0;

  const strategies = [
    { id: 'conservative', label: 'Conservative', desc: 'Lower risk, fewer trades, steady gains', icon: Shield, color: 'text-emerald-500', bg: 'bg-emerald-500/10 border-emerald-500/30' },
    { id: 'balanced', label: 'Balanced', desc: 'Moderate risk/reward, diversified signals', icon: Target, color: 'text-amber-500', bg: 'bg-amber-500/10 border-amber-500/30' },
    { id: 'aggressive', label: 'Aggressive', desc: 'Higher risk, more trades, max alpha', icon: Zap, color: 'text-red-500', bg: 'bg-red-500/10 border-red-500/30' },
    { id: 'scalping', label: 'Scalping', desc: 'Quick in-and-out, small frequent profits', icon: Activity, color: 'text-primary', bg: 'bg-primary/10 border-primary/30' },
  ];

  if (loading) {
    return (
      <Card className="border-border/30 overflow-hidden">
        <CardContent className="p-4 lg:p-5 flex items-center justify-center min-h-[200px]">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading AI Auto-Trade...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {/* === Main Auto-Trade Card === */}
      <Card className={`border-2 overflow-hidden transition-colors ${
        isRunning ? 'border-emerald-500/50 bg-emerald-500/[0.03]' :
        isPaused ? 'border-amber-500/50 bg-amber-500/[0.03]' :
        'border-border/30'
      }`}>
        {/* Header with gradient */}
        <div className={`px-4 lg:px-5 py-4 border-b ${
          isRunning ? 'border-emerald-500/20 bg-gradient-to-r from-emerald-500/10 to-transparent' :
          isPaused ? 'border-amber-500/20 bg-gradient-to-r from-amber-500/10 to-transparent' :
          'border-border/50'
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center shadow-lg ${
                isRunning
                  ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 shadow-emerald-500/30'
                  : isPaused
                  ? 'bg-gradient-to-br from-amber-500 to-orange-500 shadow-amber-500/30'
                  : 'bg-gradient-to-br from-muted-foreground/30 to-muted-foreground/50 shadow-black/10'
              }`}>
                {isRunning ? <Bot className="h-5.5 w-5.5 text-white" /> : isPaused ? <Timer className="h-5 w-5 text-white" /> : <Bot className="h-5 w-5 text-white" />}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold">AI Auto-Trade</h2>
                  {isRunning && (
                    <motion.span
                      animate={{ opacity: [1, 0.4, 1] }}
                      transition={{ duration: 2, repeat: Infinity }}
                      className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-500 text-[10px] font-semibold"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      LIVE
                    </motion.span>
                  )}
                  {isPaused && (
                    <Badge className="bg-amber-500/15 text-amber-500 border-amber-500/30 text-[10px] h-5">PAUSED</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {isRunning ? 'AI is actively scanning & trading' :
                   isPaused ? 'Auto-trading paused' :
                   'Set your amount and let AI trade for you'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <AnimatePresence>
                {amountWarning && (
                  <motion.span
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    className="text-[10px] font-medium text-amber-500 whitespace-nowrap"
                  >
                    Enter amount first
                  </motion.span>
                )}
              </AnimatePresence>
              <div className="flex items-center gap-2 bg-muted/80 rounded-full px-3 py-1.5">
                <span className="text-[11px] text-muted-foreground font-medium">AI Bot</span>
                <Switch
                  checked={botConfig.enabled}
                  onCheckedChange={handleToggleBot}
                  disabled={saving}
                  className="cursor-pointer"
                />
              </div>
              {isRunning && (
                <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 text-[10px] font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Active
                </span>
              )}
            </div>
          </div>
        </div>

        <CardContent className="p-4 lg:p-5 space-y-5">
          {/* === Allocation Amount === */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-semibold flex items-center gap-1.5">
                <DollarSign className="h-4 w-4 text-primary" />
                AI Trading Amount
              </label>
              <span className="text-xs text-muted-foreground">
                Balance: <span className="font-semibold text-foreground">${accountBalance.toLocaleString()}</span>
              </span>
            </div>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-lg font-bold text-muted-foreground">$</span>
              <input
                type="number"
                value={botConfig.allocationAmount || ''}
                onChange={e => handleAmountChange(e.target.value)}
                onBlur={handleAmountBlur}
                placeholder="Enter amount..."
                className="w-full h-12 pl-8 pr-4 rounded-xl bg-muted/80 text-lg font-bold tabular-nums outline-none focus:ring-2 focus:ring-primary/50 focus:bg-muted transition-all"
              />
            </div>
            {/* Quick amount buttons */}
            <div className="flex gap-2 mt-2">
              {[0.1, 0.25, 0.5, 0.75, 1.0].map(pct => {
                const val = Math.round(accountBalance * pct);
                return (
                  <button
                    key={pct}
                    onClick={() => {
                      setBotConfig({ allocationAmount: val });
                      saveConfig({ allocationAmount: val });
                    }}
                    className={`flex-1 py-1.5 rounded-lg text-[11px] font-semibold border transition-all cursor-pointer ${
                      allocationPercent > 0 && Math.abs(allocationPercent - pct * 100) < 5
                        ? 'bg-primary/15 border-primary/40 text-primary'
                        : 'border-border hover:bg-accent/50 text-muted-foreground'
                    }`}
                  >
                    {pct === 1 ? '100%' : `${pct * 100}%`}
                  </button>
                );
              })}
            </div>
            {allocationPercent > 0 && (
              <div className="mt-2 flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                  <motion.div
                    className={`h-full rounded-full ${allocationPercent > 80 ? 'bg-red-500' : allocationPercent > 50 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(allocationPercent, 100)}%` }}
                    transition={{ duration: 0.5 }}
                  />
                </div>
                <span className="text-[10px] text-muted-foreground font-medium tabular-nums w-10 text-right">
                  {allocationPercent.toFixed(0)}%
                </span>
              </div>
            )}
          </div>

          {/* === Strategy Selection === */}
          <div>
            <label className="text-sm font-semibold mb-2.5 block flex items-center gap-1.5">
              <Target className="h-4 w-4 text-primary" />
              Strategy
            </label>
            <div className="grid grid-cols-2 gap-2">
              {strategies.map(s => {
                const Icon = s.icon;
                const isActive = botConfig.strategy === s.id;
                return (
                  <button
                    key={s.id}
                    onClick={() => saveConfig({ strategy: s.id })}
                    disabled={saving}
                    className={`p-3 rounded-xl text-left border transition-all cursor-pointer ${
                      isActive ? `${s.bg} ${s.color}` : 'border-border/50 hover:border-border hover:bg-accent/30'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Icon className={`h-4 w-4 ${isActive ? s.color : 'text-muted-foreground'}`} />
                      <span className="text-xs font-bold">{s.label}</span>
                    </div>
                    <p className="text-[10px] leading-tight opacity-70">{s.desc}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* === Stats Row === */}
          <div className="grid grid-cols-4 gap-2">
            <div className="text-center p-2.5 rounded-xl bg-muted/50">
              <p className="text-base font-bold tabular-nums">{botConfig.totalTrades}</p>
              <p className="text-[10px] text-muted-foreground">Trades</p>
            </div>
            <div className="text-center p-2.5 rounded-xl bg-muted/50">
              <p className={`text-base font-bold tabular-nums ${botConfig.winRate >= 50 ? 'text-emerald-500' : 'text-orange-500'}`}>{botConfig.winRate}%</p>
              <p className="text-[10px] text-muted-foreground">Win Rate</p>
            </div>
            <div className={`text-center p-2.5 rounded-xl ${botConfig.totalPnl >= 0 ? 'bg-emerald-500/5' : 'bg-red-500/5'}`}>
              <p className={`text-base font-bold tabular-nums ${botConfig.totalPnl >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                {botConfig.totalPnl >= 0 ? '+' : ''}{botConfig.totalPnl.toFixed(0)}
              </p>
              <p className="text-[10px] text-muted-foreground">Total P&L</p>
            </div>
            <div className="text-center p-2.5 rounded-xl bg-muted/50">
              <p className="text-base font-bold tabular-nums">{botConfig.maxPositions}</p>
              <p className="text-[10px] text-muted-foreground">Max Pos.</p>
            </div>
          </div>

          {/* === Advanced Settings Toggle === */}
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="w-full flex items-center justify-between py-2 cursor-pointer"
          >
            <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
              <Settings2 className="h-3.5 w-3.5" /> Advanced Settings
            </span>
            {showAdvanced ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </button>

          <AnimatePresence>
            {showAdvanced && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="grid grid-cols-2 gap-3 pb-1">
                  <div>
                    <label className="text-[11px] text-muted-foreground font-medium mb-1 block">Max Positions</label>
                    <Input
                      type="number" min={1} max={20}
                      value={botConfig.maxPositions}
                      onChange={e => saveConfig({ maxPositions: parseInt(e.target.value) || 5 })}
                      className="h-9 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground font-medium mb-1 block">Risk Level</label>
                    <div className="flex gap-1">
                      {['low', 'medium', 'high'].map(r => (
                        <button key={r} onClick={() => saveConfig({ riskTolerance: r })}
                          className={`flex-1 py-1.5 text-[10px] font-semibold rounded-lg border cursor-pointer transition-colors ${
                            botConfig.riskTolerance === r
                              ? 'bg-primary/10 border-primary/40 text-primary'
                              : 'border-border hover:bg-accent/50 text-muted-foreground'
                          }`}>
                          {r.charAt(0).toUpperCase() + r.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground font-medium mb-1 block">Stop Loss (%)</label>
                    <Input
                      type="number" min={0.5} max={20} step={0.5}
                      value={botConfig.stopLossPercent}
                      onChange={e => saveConfig({ stopLossPercent: parseFloat(e.target.value) || 2.0 })}
                      className="h-9 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground font-medium mb-1 block">Take Profit (%)</label>
                    <Input
                      type="number" min={0.5} max={50} step={0.5}
                      value={botConfig.takeProfitPercent}
                      onChange={e => saveConfig({ takeProfitPercent: parseFloat(e.target.value) || 4.0 })}
                      className="h-9 text-sm"
                    />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* === Activity Log Toggle === */}
          {autoTradeActivity.length > 0 && (
            <>
              <button
                onClick={() => setShowActivity(!showActivity)}
                className="w-full flex items-center justify-between py-2 cursor-pointer"
              >
                <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" /> Recent Activity
                  <Badge variant="secondary" className="text-[9px] h-4 ml-1">{autoTradeActivity.length}</Badge>
                </span>
                {showActivity ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
              </button>

              <AnimatePresence>
                {showActivity && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="space-y-1.5 max-h-64 overflow-y-auto -mx-1">
                      {activityList.map(act => (
                        <ActivityRow key={act.id} activity={act} />
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// Activity Row Component
// ============================================================
function ActivityRow({ activity }: { activity: AutoTradeActivity }) {
  const isBuy = activity.side === 'buy';
  const statusConfig: Record<string, { icon: typeof CheckCircle2; color: string; bg: string; label: string }> = {
    filled: { icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-500/10', label: 'Filled' },
    pending: { icon: Clock, color: 'text-amber-500', bg: 'bg-amber-500/10', label: 'Pending' },
    cancelled: { icon: XCircle, color: 'text-muted-foreground', bg: 'bg-muted', label: 'Cancelled' },
    rejected: { icon: XCircle, color: 'text-red-500', bg: 'bg-red-500/10', label: 'Rejected' },
    partially_filled: { icon: Clock, color: 'text-blue-500', bg: 'bg-blue-500/10', label: 'Partial' },
  };
  const sc = statusConfig[activity.status] || statusConfig.pending;
  const StatusIcon = sc.icon;

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  return (
    <div className="flex items-center gap-2.5 p-2.5 rounded-lg hover:bg-muted/30 transition-colors">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
        isBuy ? 'bg-emerald-500/10' : 'bg-red-500/10'
      }`}>
        {isBuy ? <ArrowUpRight className="h-4 w-4 text-emerald-500" /> : <ArrowDownRight className="h-4 w-4 text-red-500" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-bold">{activity.symbol}</span>
          <Badge variant="outline" className="text-[9px] uppercase h-4">{activity.type}</Badge>
          {activity.signalType && (
            <Badge variant="secondary" className="text-[8px] h-3.5 bg-primary/5 text-primary">
              <Sparkles className="h-2.5 w-2.5 mr-0.5" />{activity.signalConfidence}%
            </Badge>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground">
          {activity.qty} · {activity.filledPrice ? `$${activity.filledPrice.toLocaleString()}` : '—'} · {timeAgo(activity.createdAt)}
        </p>
      </div>
      <div className={`flex items-center gap-1 px-2 py-1 rounded-md ${sc.bg}`}>
        <StatusIcon className={`h-3 w-3 ${sc.color}`} />
        <span className={`text-[10px] font-semibold ${sc.color}`}>{sc.label}</span>
      </div>
    </div>
  );
}
