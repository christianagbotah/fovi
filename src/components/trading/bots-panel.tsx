'use client';

// ============================================================
// BotsPanel — Manage multiple AI trading bots
// ============================================================
// Fetches bots from /api/trading/bots, supports creating, toggling
// (start/stop) and deleting bots. Each bot renders as a rich card
// with strategy + status badges, key performance stats and an
// expandable advanced-settings panel. Demo bots returned by the API
// (in environments without a live DB) are rendered with a "Demo"
// marker so users always see a fully populated experience.
//
// Engine Integration:
//   - Shows auto-trade engine status (connected/disconnected)
//   - Displays engine cycle count, last cycle time, and activity log
//   - Supports triggering manual engine cycles
//   - Engine executes trades for running bots via technical analysis
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bot,
  Play,
  Square,
  Plus,
  Trash2,
  Settings2,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Zap,
  Target,
  Clock,
  ChevronDown,
  ChevronUp,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  DollarSign,
  Activity,
  RefreshCw,
  Radio,
  WifiOff,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTradingStore } from '@/lib/store/trading-store';
import type { BrokerProvider } from '@/lib/types';

// ------------------------------------------------------------
// Engine types
// ------------------------------------------------------------
interface EngineStatus {
  status: string;
  service: string;
  port: number;
  uptime: number;
  dbAvailable: boolean;
  cycleCount: number;
  lastCycleTime: string | null;
  lastCycleError: string | null;
  pollIntervalMs: number;
}

interface EngineActivityEntry {
  id: string;
  timestamp: string;
  type: 'trade_opened' | 'trade_closed' | 'signal_generated' | 'cycle_start' | 'cycle_end' | 'error' | 'sl_hit' | 'tp_hit';
  botId: string;
  botName: string;
  symbol: string;
  side?: string;
  qty?: number;
  price?: number;
  pnl?: number;
  reason?: string;
  confidence?: number;
  error?: string;
}

// ------------------------------------------------------------
// Types
// ------------------------------------------------------------
export interface TradingBot {
  id: string;
  userId?: string;
  accountId?: string;
  name: string;
  strategy: string;
  symbols: string;
  timeframe: string;
  allocationAmount: number;
  enabled: boolean;
  status: string;
  config?: string | null;
  positionSizing?: string;
  riskPerTrade?: number;
  maxPositions?: number;
  stopLossPercent?: number;
  takeProfitPercent?: number;
  trailingStopPct?: number;
  tradingSessions?: string;
  customSessionStart?: string | null;
  customSessionEnd?: string | null;
  totalTrades?: number;
  winTrades?: number;
  lossTrades?: number;
  totalPnl?: number;
  bestTrade?: number;
  worstTrade?: number;
  currentStreak?: number;
  lastTradeAt?: string | null;
  lastError?: string | null;
  createdAt?: string;
  updatedAt?: string;
  broker?: BrokerProvider;
}

interface BotFormState {
  name: string;
  strategy: string;
  symbols: string;
  timeframe: string;
  allocationAmount: string;
  positionSizing: string;
  riskPerTrade: string;
  maxPositions: string;
  stopLossPercent: string;
  takeProfitPercent: string;
  trailingStopPct: string;
  tradingSessions: string;
}

// ------------------------------------------------------------
// Strategy configuration (label / icon / color)
// ------------------------------------------------------------
type StrategyConfig = {
  label: string;
  icon: typeof Target;
  color: string;
  bg: string;
  border: string;
  dot: string;
  gradient: string;
};

const STRATEGIES: Record<string, StrategyConfig> = {
  signal_based: {
    label: 'Signal Based',
    icon: Target,
    color: 'text-amber-500',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    dot: 'bg-amber-500',
    gradient: 'from-amber-500 to-orange-500',
  },
  dca: {
    label: 'DCA (Dollar Cost Avg)',
    icon: BarChart3,
    color: 'text-blue-500',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/30',
    dot: 'bg-blue-500',
    gradient: 'from-blue-500 to-cyan-500',
  },
  grid: {
    label: 'Grid Trading',
    icon: Zap,
    color: 'text-purple-500',
    bg: 'bg-purple-500/10',
    border: 'border-purple-500/30',
    dot: 'bg-purple-500',
    gradient: 'from-purple-500 to-fuchsia-500',
  },
  scalping: {
    label: 'Scalping',
    icon: Clock,
    color: 'text-emerald-500',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    dot: 'bg-emerald-500',
    gradient: 'from-emerald-500 to-teal-500',
  },
  momentum: {
    label: 'Momentum',
    icon: TrendingUp,
    color: 'text-red-500',
    bg: 'bg-red-500/10',
    border: 'border-red-500/30',
    dot: 'bg-red-500',
    gradient: 'from-red-500 to-rose-500',
  },
};

type StatusConfig = {
  label: string;
  icon: typeof Play;
  color: string;
  bg: string;
  border: string;
  dot: string;
};

const STATUS_CONFIG: Record<string, StatusConfig> = {
  running: {
    label: 'Running',
    icon: Play,
    color: 'text-emerald-500',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    dot: 'bg-emerald-500',
  },
  paused: {
    label: 'Paused',
    icon: Clock,
    color: 'text-amber-500',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    dot: 'bg-amber-500',
  },
  stopped: {
    label: 'Stopped',
    icon: Square,
    color: 'text-muted-foreground',
    bg: 'bg-muted/60',
    border: 'border-border',
    dot: 'bg-muted-foreground',
  },
};

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d', '1w'] as const;

const POSITION_SIZING: Record<string, string> = {
  kelly: 'Kelly Criterion',
  fixed_fractional: 'Fixed Fractional',
  volatility: 'Volatility Based',
  fixed: 'Fixed Size',
};

const TRADING_SESSIONS: Record<string, string> = {
  all: 'All Sessions',
  london: 'London',
  newyork: 'New York',
  asia: 'Asia',
};

// Brokers supported by the platform (typed via BrokerProvider).
const SUPPORTED_BROKERS: BrokerProvider[] = [
  'alpaca',
  'binance',
  'okx',
  'deriv',
  'demo',
];

const DEFAULT_FORM: BotFormState = {
  name: '',
  strategy: 'signal_based',
  symbols: 'BTC,ETH',
  timeframe: '1h',
  allocationAmount: '10000',
  positionSizing: 'fixed_fractional',
  riskPerTrade: '2',
  maxPositions: '3',
  stopLossPercent: '2',
  takeProfitPercent: '4',
  trailingStopPct: '1.5',
  tradingSessions: 'all',
};

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
function getStrategy(key: string): StrategyConfig {
  return STRATEGIES[key] ?? STRATEGIES.signal_based;
}

function getStatus(key: string): StatusConfig {
  return STATUS_CONFIG[key] ?? STATUS_CONFIG.stopped;
}

function formatCurrency(n: number | undefined | null): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '$0.00';
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatCompactCurrency(n: number | undefined | null): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '$0';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function formatNumber(n: number | undefined | null): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '0';
  return n.toLocaleString('en-US');
}

function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  if (Number.isNaN(diff)) return '—';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function isDemoBot(bot: TradingBot): boolean {
  return typeof bot.id === 'string' && bot.id.startsWith('bot_demo_');
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m ${seconds % 60}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

function parseSymbols(symbols: string | undefined | null): string[] {
  if (!symbols) return [];
  return symbols
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function winRateOf(bot: TradingBot): number {
  const total = bot.totalTrades ?? 0;
  const wins = bot.winTrades ?? 0;
  if (total <= 0) return 0;
  return Math.round((wins / total) * 100);
}

// ============================================================
// Main component
// ============================================================
export function BotsPanel() {
  const { accounts } = useTradingStore();

  const [bots, setBots] = useState<TradingBot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [form, setForm] = useState<BotFormState>(DEFAULT_FORM);
  const [creating, setCreating] = useState(false);

  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // ---- Engine state ----
  const [engineStatus, setEngineStatus] = useState<EngineStatus | null>(null);
  const [engineLoading, setEngineLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [engineActivity, setEngineActivity] = useState<EngineActivityEntry[]>([]);
  const [showEngineLog, setShowEngineLog] = useState(false);

  // ---- Fetch engine status ----
  const fetchEngineStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/trading/bots/engine/status');
      if (res.ok) {
        const data = await res.json();
        setEngineStatus(data);
      } else {
        setEngineStatus(null);
      }
    } catch {
      setEngineStatus(null);
    } finally {
      setEngineLoading(false);
    }
  }, []);

  const fetchEngineActivity = useCallback(async () => {
    try {
      const res = await fetch('/api/trading/bots/engine/activity');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) setEngineActivity(data);
      }
    } catch { /* ignore */ }
  }, []);

  // ---- Trigger manual cycle ----
  const handleTriggerCycle = async () => {
    setTriggering(true);
    try {
      const res = await fetch('/api/trading/bots/engine/trigger', { method: 'POST' });
      if (res.ok) {
        setNotice('Engine cycle triggered successfully.');
        // Refresh after a short delay to see results
        setTimeout(() => {
          fetchEngineStatus();
          fetchEngineActivity();
        }, 3000);
      } else {
        setError('Failed to trigger engine cycle.');
      }
    } catch {
      setError('Engine unreachable — cannot trigger cycle.');
    } finally {
      setTriggering(false);
    }
  };

  // ---- Fetch bots on mount ----
  const fetchBots = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/trading/bots', { cache: 'no-store' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Failed to load bots (HTTP ${res.status})`);
      }
      const data = await res.json();
      if (Array.isArray(data)) {
        setBots(data);
      } else if (data && typeof data === 'object' && typeof data.error === 'string') {
        throw new Error(data.error);
      } else {
        setBots([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load bots');
      setBots([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBots();
    fetchEngineStatus();
    fetchEngineActivity();
  }, [fetchBots, fetchEngineStatus, fetchEngineActivity]);

  // Refresh engine status periodically
  useEffect(() => {
    const interval = setInterval(() => {
      fetchEngineStatus();
      fetchEngineActivity();
    }, 15000);
    return () => clearInterval(interval);
  }, [fetchEngineStatus, fetchEngineActivity]);

  // ---- Create bot ----
  const handleCreate = async () => {
    if (!form.name.trim()) {
      setError('Please enter a bot name.');
      return;
    }
    if (!form.symbols.trim()) {
      setError('Please enter at least one trading symbol.');
      return;
    }
    const allocation = parseFloat(form.allocationAmount);
    if (!Number.isFinite(allocation) || allocation <= 0) {
      setError('Allocation amount must be greater than zero.');
      return;
    }

    setCreating(true);
    setError(null);
    try {
      const payload = {
        name: form.name.trim(),
        strategy: form.strategy,
        symbols: form.symbols.trim(),
        timeframe: form.timeframe,
        allocationAmount: allocation,
        positionSizing: form.positionSizing,
        riskPerTrade: parseFloat(form.riskPerTrade) || 0,
        maxPositions: parseInt(form.maxPositions, 10) || 1,
        stopLossPercent: parseFloat(form.stopLossPercent) || 0,
        takeProfitPercent: parseFloat(form.takeProfitPercent) || 0,
        trailingStopPct: parseFloat(form.trailingStopPct) || 0,
        tradingSessions: form.tradingSessions,
      };
      const res = await fetch('/api/trading/bots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Failed to create bot (HTTP ${res.status})`);
      }
      const created: TradingBot = await res.json();
      setBots((prev) => [created, ...prev]);
      setForm(DEFAULT_FORM);
      setShowCreateForm(false);
      setNotice(`Bot "${created.name}" created successfully.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create bot');
    } finally {
      setCreating(false);
    }
  };

  // ---- Toggle bot (start / stop) ----
  const handleToggle = async (bot: TradingBot) => {
    const newEnabled = !bot.enabled;
    const newStatus = newEnabled ? 'running' : 'stopped';
    setTogglingId(bot.id);
    // Optimistic update — matches the server's behaviour for persisted bots
    // and gives demo bots a snappy local toggle (the demo toggle endpoint
    // always returns "running", so we rely on optimistic state).
    setBots((prev) =>
      prev.map((b) =>
        b.id === bot.id ? { ...b, enabled: newEnabled, status: newStatus } : b,
      ),
    );
    setError(null);
    try {
      const res = await fetch(
        `/api/trading/bots/${encodeURIComponent(bot.id)}/toggle`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: newEnabled }),
        },
      );
      if (!res.ok) {
        // revert on failure
        setBots((prev) =>
          prev.map((b) =>
            b.id === bot.id ? { ...b, enabled: bot.enabled, status: bot.status } : b,
          ),
        );
        const body = await res.json().catch(() => ({}));
        setError(body?.error || `Failed to ${newEnabled ? 'start' : 'stop'} bot`);
      } else {
        setNotice(
          `"${bot.name}" ${newEnabled ? 'started — engine will pick it up on next cycle' : 'stopped'}.`,
        );
        // Refresh engine activity after toggle
        setTimeout(() => { fetchEngineActivity(); fetchEngineStatus(); }, 2000);
      }
    } catch {
      setBots((prev) =>
        prev.map((b) =>
          b.id === bot.id ? { ...b, enabled: bot.enabled, status: bot.status } : b,
        ),
      );
      setError(`Failed to ${newEnabled ? 'start' : 'stop'} bot — network error.`);
    } finally {
      setTogglingId(null);
    }
  };

  // ---- Delete bot ----
  const handleDelete = async (bot: TradingBot) => {
    setDeletingId(bot.id);
    const snapshot = bots;
    setBots((prev) => prev.filter((b) => b.id !== bot.id));
    setError(null);
    try {
      const res = await fetch(
        `/api/trading/bots/${encodeURIComponent(bot.id)}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        setBots(snapshot);
        const body = await res.json().catch(() => ({}));
        setError(body?.error || 'Failed to delete bot');
      } else {
        setNotice(`Bot "${bot.name}" deleted.`);
        if (expandedId === bot.id) setExpandedId(null);
      }
    } catch {
      setBots(snapshot);
      setError('Failed to delete bot — network error.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleField = <K extends keyof BotFormState>(key: K, value: BotFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  // ---- Derived summary stats ----
  const totalBots = bots.length;
  const runningCount = bots.filter((b) => b.status === 'running').length;
  const totalAllocation = bots.reduce((sum, b) => sum + (b.allocationAmount || 0), 0);
  const totalPnl = bots.reduce((sum, b) => sum + (b.totalPnl || 0), 0);
  const totalTrades = bots.reduce((sum, b) => sum + (b.totalTrades || 0), 0);
  const activeAccount = accounts.find((a) => a.isDefault) ?? accounts[0];
  const hasDemoBots = bots.some(isDemoBot);

  // ============================================================
  // Render
  // ============================================================
  return (
    <div className="space-y-4">
      {/* === Header === */}
      <Card className="border-border/40 overflow-hidden shadow-sm">
        <div className="px-4 lg:px-5 py-4 bg-gradient-to-r from-primary/5 via-transparent to-transparent border-b border-border/40">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-lg shadow-primary/20">
                <Bot className="h-5 w-5 text-primary-foreground" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold tracking-tight">AI Trading Bots</h2>
                  {hasDemoBots && (
                    <Badge
                      variant="outline"
                      className="text-[10px] h-5 border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                    >
                      Demo Data
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {totalBots === 0
                    ? 'No bots yet — create your first AI bot to start automated trading.'
                    : `${runningCount} of ${totalBots} bots running · ${formatNumber(totalTrades)} total trades`}
                </p>
              </div>
            </div>
            <Button
              onClick={() => setShowCreateForm((v) => !v)}
              className="cursor-pointer shadow-sm"
              size="sm"
            >
              {showCreateForm ? (
                <>
                  <XCircle className="h-4 w-4 mr-1.5" />
                  Close
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-1.5" />
                  Create Bot
                </>
              )}
            </Button>
          </div>
        </div>

        {/* === Summary stat strip === */}
        <CardContent className="p-3 lg:p-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <SummaryStat
              label="Total Bots"
              value={formatNumber(totalBots)}
              icon={Bot}
              accent="text-foreground"
            />
            <SummaryStat
              label="Running"
              value={formatNumber(runningCount)}
              icon={Play}
              accent="text-emerald-500"
            />
            <SummaryStat
              label="Allocation"
              value={formatCompactCurrency(totalAllocation)}
              icon={DollarSign}
              accent="text-primary"
            />
            <SummaryStat
              label="Combined P&L"
              value={`${totalPnl >= 0 ? '+' : ''}${formatCompactCurrency(totalPnl)}`}
              icon={totalPnl >= 0 ? TrendingUp : TrendingDown}
              accent={totalPnl >= 0 ? 'text-emerald-500' : 'text-red-500'}
            />
          </div>
        </CardContent>
      </Card>

      {/* === Engine Status Card === */}
      <Card className="border-border/40 overflow-hidden shadow-sm">
        <div className="px-4 lg:px-5 py-3.5 bg-gradient-to-r from-emerald-500/[0.04] via-transparent to-transparent border-b border-border/40">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-500/90 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
                {engineStatus ? (
                  <Radio className="h-5 w-5 text-white" />
                ) : (
                  <WifiOff className="h-5 w-5 text-white/80" />
                )}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold tracking-tight">Trade Engine</h2>
                  {engineLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  ) : engineStatus ? (
                    <Badge
                      variant="outline"
                      className="text-[10px] h-5 border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    >
                      <motion.span
                        animate={{ opacity: [1, 0.3, 1] }}
                        transition={{ duration: 1.6, repeat: Infinity }}
                        className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1"
                      />
                      Connected
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="text-[10px] h-5 border-red-500/40 bg-red-500/10 text-red-500"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500 mr-1" />
                      Offline
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {engineStatus
                    ? `Uptime ${formatUptime(engineStatus.uptime)} · ${engineStatus.cycleCount} cycles completed · polls every ${(engineStatus.pollIntervalMs / 1000).toFixed(0)}s`
                    : 'Auto-trade engine is not reachable. Trades won\'t execute.'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowEngineLog((v) => !v)}
                className="cursor-pointer text-xs"
              >
                <Activity className="h-3.5 w-3.5 mr-1.5" />
                {showEngineLog ? 'Hide Log' : 'Activity Log'}
                {engineActivity.length > 0 && (
                  <Badge variant="secondary" className="ml-1.5 h-4 px-1.5 text-[9px] tabular-nums">
                    {engineActivity.length}
                  </Badge>
                )}
              </Button>
              <Button
                onClick={handleTriggerCycle}
                disabled={triggering || !engineStatus}
                size="sm"
                className="cursor-pointer shadow-sm text-xs"
              >
                {triggering ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                )}
                Trigger Cycle
              </Button>
            </div>
          </div>
        </div>

        {/* Engine stats strip */}
        <CardContent className="p-3 lg:p-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="flex items-center gap-2.5 p-2.5 rounded-xl bg-muted/40 border border-border/40">
              <div className="w-8 h-8 rounded-lg bg-background flex items-center justify-center shrink-0 shadow-sm">
                <Activity className="h-4 w-4 text-emerald-500" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold tabular-nums truncate text-emerald-500">
                  {engineStatus?.cycleCount ?? '—'}
                </p>
                <p className="text-[10px] text-muted-foreground leading-tight">Cycles Run</p>
              </div>
            </div>
            <div className="flex items-center gap-2.5 p-2.5 rounded-xl bg-muted/40 border border-border/40">
              <div className="w-8 h-8 rounded-lg bg-background flex items-center justify-center shrink-0 shadow-sm">
                <Bot className="h-4 w-4 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold tabular-nums truncate text-primary">{runningCount}</p>
                <p className="text-[10px] text-muted-foreground leading-tight">Active Bots</p>
              </div>
            </div>
            <div className="flex items-center gap-2.5 p-2.5 rounded-xl bg-muted/40 border border-border/40">
              <div className="w-8 h-8 rounded-lg bg-background flex items-center justify-center shrink-0 shadow-sm">
                <Clock className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold tabular-nums truncate">
                  {engineStatus?.lastCycleTime
                    ? timeAgo(engineStatus.lastCycleTime)
                    : '—'}
                </p>
                <p className="text-[10px] text-muted-foreground leading-tight">Last Cycle</p>
              </div>
            </div>
            <div className="flex items-center gap-2.5 p-2.5 rounded-xl bg-muted/40 border border-border/40">
              <div className="w-8 h-8 rounded-lg bg-background flex items-center justify-center shrink-0 shadow-sm">
                {engineStatus?.lastCycleError ? (
                  <AlertTriangle className="h-4 w-4 text-red-500" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                )}
              </div>
              <div className="min-w-0">
                <p className={`text-sm font-bold tabular-nums truncate ${engineStatus?.lastCycleError ? 'text-red-500' : 'text-emerald-500'}`}>
                  {engineStatus?.lastCycleError ? 'Error' : 'Healthy'}
                </p>
                <p className="text-[10px] text-muted-foreground leading-tight">Engine Health</p>
              </div>
            </div>
          </div>
        </CardContent>

        {/* Activity Log (expandable) */}
        <AnimatePresence>
          {showEngineLog && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="overflow-hidden"
            >
              <div className="border-t border-border/40 p-3 lg:p-4">
                <div className="flex items-center gap-1.5 mb-3">
                  <Activity className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                    Engine Activity Log
                  </span>
                </div>
                {engineActivity.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">
                    No activity yet. Trigger a cycle or wait for the next auto-cycle.
                  </p>
                ) : (
                  <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1">
                    {engineActivity.slice(0, 50).map((entry) => (
                      <div
                        key={entry.id}
                        className="flex items-start gap-2.5 p-2 rounded-lg bg-muted/30 border border-border/20 text-[11px]"
                      >
                        <div className="shrink-0 mt-0.5">
                          {entry.type === 'error' ? (
                            <XCircle className="h-3.5 w-3.5 text-red-500" />
                          ) : entry.type === 'trade_opened' || entry.type === 'tp_hit' ? (
                            <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
                          ) : entry.type === 'trade_closed' || entry.type === 'sl_hit' ? (
                            <TrendingDown className="h-3.5 w-3.5 text-red-500" />
                          ) : entry.type === 'signal_generated' ? (
                            <Target className="h-3.5 w-3.5 text-amber-500" />
                          ) : (
                            <Activity className="h-3.5 w-3.5 text-muted-foreground" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-semibold text-foreground">{entry.botName}</span>
                            <Badge
                              variant="secondary"
                              className="h-4 px-1.5 text-[9px] font-semibold"
                            >
                              {entry.symbol}
                            </Badge>
                            {entry.side && (
                              <span className={entry.side === 'buy' ? 'text-emerald-500' : 'text-red-500'}>
                                {entry.side.toUpperCase()}
                              </span>
                            )}
                          </div>
                          <p className="text-muted-foreground mt-0.5">
                            {entry.type === 'trade_opened' && `Opened position @ $${(entry.price ?? 0).toFixed(2)} qty=${(entry.qty ?? 0).toFixed(4)}`}
                            {entry.type === 'trade_closed' && `Closed position PnL: $${(entry.pnl ?? 0).toFixed(2)}`}
                            {entry.type === 'sl_hit' && `Stop Loss hit @ $${(entry.price ?? 0).toFixed(2)} — PnL: $${(entry.pnl ?? 0).toFixed(2)}`}
                            {entry.type === 'tp_hit' && `Take Profit hit @ $${(entry.price ?? 0).toFixed(2)} — PnL: $${(entry.pnl ?? 0).toFixed(2)}`}
                            {entry.type === 'signal_generated' && `Signal: ${(entry.confidence ?? 0).toFixed(0)}% confidence — ${entry.reason ?? ''}`}
                            {entry.type === 'cycle_start' && 'Cycle started'}
                            {entry.type === 'cycle_end' && 'Cycle completed'}
                            {entry.type === 'error' && (entry.error ?? 'Unknown error')}
                          </p>
                          <span className="text-[9px] text-muted-foreground/60 tabular-nums">
                            {timeAgo(entry.timestamp)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>

      {/* === Inline notices / errors === */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="flex items-start gap-3 p-3.5 rounded-xl border border-red-500/30 bg-red-500/[0.06]">
              <AlertTriangle className="h-4.5 w-4.5 text-red-500 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-red-600 dark:text-red-400">
                  Something went wrong
                </p>
                <p className="text-xs text-muted-foreground mt-0.5 break-words">{error}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Button size="sm" variant="outline" onClick={fetchBots} className="h-7 text-xs cursor-pointer">
                  <Loader2 className="h-3 w-3 mr-1" />
                  Retry
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setError(null)}
                  className="h-7 w-7 p-0 cursor-pointer"
                  aria-label="Dismiss error"
                >
                  <XCircle className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </motion.div>
        )}

        {notice && !error && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-3 p-3.5 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06]">
              <CheckCircle2 className="h-4.5 w-4.5 text-emerald-500 shrink-0" />
              <p className="text-sm text-emerald-700 dark:text-emerald-400 flex-1">{notice}</p>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setNotice(null)}
                className="h-7 w-7 p-0 cursor-pointer"
                aria-label="Dismiss notice"
              >
                <XCircle className="h-4 w-4" />
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* === Create bot form === */}
      <AnimatePresence initial={false}>
        {showCreateForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <CreateBotForm
              form={form}
              onField={handleField}
              onCreate={handleCreate}
              onCancel={() => {
                setShowCreateForm(false);
                setForm(DEFAULT_FORM);
                setError(null);
              }}
              creating={creating}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* === Bot list === */}
      {loading ? (
        <BotsLoadingSkeleton />
      ) : bots.length === 0 ? (
        <BotsEmptyState onCreate={() => setShowCreateForm(true)} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3 lg:gap-4">
          <AnimatePresence mode="popLayout">
            {bots.map((bot) => (
              <motion.div
                key={bot.id}
                layout
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.22, ease: 'easeOut' }}
              >
                <BotCard
                  bot={bot}
                  expanded={expandedId === bot.id}
                  onToggleExpanded={() =>
                    setExpandedId((id) => (id === bot.id ? null : bot.id))
                  }
                  onToggle={handleToggle}
                  onDelete={handleDelete}
                  toggling={togglingId === bot.id}
                  deleting={deletingId === bot.id}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* === Footer hint === */}
      {!loading && bots.length > 0 && (
        <p className="text-[11px] text-muted-foreground/80 text-center pt-1">
          {activeAccount
            ? `Bots trade against your "${activeAccount.broker}" ${activeAccount.accountType} account. `
            : 'Connect a broker account to enable live trading. '}
          {engineStatus
            ? 'The trade engine is executing strategies automatically.'
            : 'Start the trade engine to execute bot strategies automatically.'}
        </p>
      )}
    </div>
  );
}

// ============================================================
// Summary stat (header strip)
// ============================================================
function SummaryStat({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  icon: typeof Bot;
  accent: string;
}) {
  return (
    <div className="flex items-center gap-2.5 p-2.5 rounded-xl bg-muted/40 border border-border/40">
      <div className="w-8 h-8 rounded-lg bg-background flex items-center justify-center shrink-0 shadow-sm">
        <Icon className={`h-4 w-4 ${accent}`} />
      </div>
      <div className="min-w-0">
        <p className={`text-sm font-bold tabular-nums truncate ${accent}`}>{value}</p>
        <p className="text-[10px] text-muted-foreground leading-tight">{label}</p>
      </div>
    </div>
  );
}

// ============================================================
// Create bot form
// ============================================================
function CreateBotForm({
  form,
  onField,
  onCreate,
  onCancel,
  creating,
}: {
  form: BotFormState;
  onField: <K extends keyof BotFormState>(key: K, value: BotFormState[K]) => void;
  onCreate: () => void;
  onCancel: () => void;
  creating: boolean;
}) {
  return (
    <Card className="border-primary/30 shadow-md overflow-hidden">
      <div className="px-4 lg:px-5 py-3.5 border-b border-border/50 bg-gradient-to-r from-primary/[0.06] to-transparent flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
          <Plus className="h-4 w-4 text-primary" />
        </div>
        <div>
          <h3 className="text-sm font-bold">Create New Bot</h3>
          <p className="text-[11px] text-muted-foreground">
            Configure a new automated AI trading bot.
          </p>
        </div>
      </div>

      <CardContent className="p-4 lg:p-5 space-y-4">
        {/* Row: Name */}
        <FormField label="Bot Name" required>
          <Input
            value={form.name}
            onChange={(e) => onField('name', e.target.value)}
            placeholder="e.g. Momentum Hunter"
            className="h-9"
            maxLength={60}
          />
        </FormField>

        {/* Row: Strategy + Timeframe */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormField label="Strategy">
            <Select value={form.strategy} onValueChange={(v) => onField('strategy', v)}>
              <SelectTrigger className="w-full h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(STRATEGIES).map(([key, cfg]) => {
                  const Icon = cfg.icon;
                  return (
                    <SelectItem key={key} value={key}>
                      <span className="flex items-center gap-2">
                        <Icon className={`h-3.5 w-3.5 ${cfg.color}`} />
                        {cfg.label}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Timeframe">
            <Select value={form.timeframe} onValueChange={(v) => onField('timeframe', v)}>
              <SelectTrigger className="w-full h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMEFRAMES.map((tf) => (
                  <SelectItem key={tf} value={tf}>
                    {tf}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        </div>

        {/* Row: Symbols */}
        <FormField label="Symbols" hint="Comma-separated, e.g. BTC,ETH,SOL">
          <Input
            value={form.symbols}
            onChange={(e) => onField('symbols', e.target.value)}
            placeholder="BTC,ETH"
            className="h-9"
          />
        </FormField>

        {/* Row: Allocation + Position sizing */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormField label="Allocation Amount ($)">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted-foreground">
                $
              </span>
              <Input
                type="number"
                min={0}
                step={100}
                value={form.allocationAmount}
                onChange={(e) => onField('allocationAmount', e.target.value)}
                placeholder="10000"
                className="h-9 pl-7 tabular-nums"
              />
            </div>
          </FormField>
          <FormField label="Position Sizing">
            <Select
              value={form.positionSizing}
              onValueChange={(v) => onField('positionSizing', v)}
            >
              <SelectTrigger className="w-full h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(POSITION_SIZING).map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        </div>

        {/* Row: Risk per trade + Max positions */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormField label="Risk per Trade (%)">
            <Input
              type="number"
              min={0}
              step={0.1}
              value={form.riskPerTrade}
              onChange={(e) => onField('riskPerTrade', e.target.value)}
              className="h-9 tabular-nums"
            />
          </FormField>
          <FormField label="Max Positions">
            <Input
              type="number"
              min={1}
              max={50}
              step={1}
              value={form.maxPositions}
              onChange={(e) => onField('maxPositions', e.target.value)}
              className="h-9 tabular-nums"
            />
          </FormField>
        </div>

        {/* Row: SL / TP / Trailing */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <FormField label="Stop Loss (%)">
            <Input
              type="number"
              min={0}
              step={0.1}
              value={form.stopLossPercent}
              onChange={(e) => onField('stopLossPercent', e.target.value)}
              className="h-9 tabular-nums"
            />
          </FormField>
          <FormField label="Take Profit (%)">
            <Input
              type="number"
              min={0}
              step={0.1}
              value={form.takeProfitPercent}
              onChange={(e) => onField('takeProfitPercent', e.target.value)}
              className="h-9 tabular-nums"
            />
          </FormField>
          <FormField label="Trailing Stop (%)">
            <Input
              type="number"
              min={0}
              step={0.1}
              value={form.trailingStopPct}
              onChange={(e) => onField('trailingStopPct', e.target.value)}
              className="h-9 tabular-nums"
            />
          </FormField>
        </div>

        {/* Row: Trading session */}
        <FormField label="Trading Session">
          <Select
            value={form.tradingSessions}
            onValueChange={(v) => onField('tradingSessions', v)}
          >
            <SelectTrigger className="w-full h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(TRADING_SESSIONS).map(([key, label]) => (
                <SelectItem key={key} value={key}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 pt-1">
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={creating}
            className="cursor-pointer"
          >
            Cancel
          </Button>
          <Button onClick={onCreate} disabled={creating} className="cursor-pointer shadow-sm">
            {creating ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                Creating…
              </>
            ) : (
              <>
                <Plus className="h-4 w-4 mr-1.5" />
                Create Bot
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function FormField({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold flex items-center gap-1">
        {label}
        {required && <span className="text-red-500">*</span>}
        {hint && <span className="text-[10px] font-normal text-muted-foreground">· {hint}</span>}
      </label>
      {children}
    </div>
  );
}

// ============================================================
// Bot card
// ============================================================
function BotCard({
  bot,
  expanded,
  onToggleExpanded,
  onToggle,
  onDelete,
  toggling,
  deleting,
}: {
  bot: TradingBot;
  expanded: boolean;
  onToggleExpanded: () => void;
  onToggle: (bot: TradingBot) => void;
  onDelete: (bot: TradingBot) => void;
  toggling: boolean;
  deleting: boolean;
}) {
  const strat = getStrategy(bot.strategy);
  const status = getStatus(bot.status);
  const StratIcon = strat.icon;
  const StatusIcon = status.icon;
  const isRunning = bot.status === 'running';
  const isPaused = bot.status === 'paused';

  const pnl = bot.totalPnl ?? 0;
  const winRate = winRateOf(bot);
  const totalTrades = bot.totalTrades ?? 0;
  const symbols = parseSymbols(bot.symbols);
  const demo = isDemoBot(bot);

  return (
    <Card
      className={`overflow-hidden transition-all shadow-sm hover:shadow-md ${
        isRunning
          ? 'border-emerald-500/40 bg-emerald-500/[0.02]'
          : isPaused
            ? 'border-amber-500/40 bg-amber-500/[0.02]'
            : 'border-border/50'
      }`}
    >
      {/* Header */}
      <div
        className={`px-4 py-3.5 border-b ${
          isRunning
            ? 'border-emerald-500/20 bg-gradient-to-r from-emerald-500/[0.08] to-transparent'
            : isPaused
              ? 'border-amber-500/20 bg-gradient-to-r from-amber-500/[0.08] to-transparent'
              : 'border-border/40 bg-gradient-to-r from-muted/30 to-transparent'
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-md bg-gradient-to-br ${strat.gradient}`}
            >
              <StratIcon className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <h3 className="text-sm font-bold truncate">{bot.name}</h3>
                {demo && (
                  <Badge
                    variant="outline"
                    className="text-[9px] h-4 px-1.5 border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                  >
                    DEMO
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                <Badge
                  variant="outline"
                  className={`text-[10px] h-5 ${strat.bg} ${strat.border} ${strat.color}`}
                >
                  <StratIcon className="h-2.5 w-2.5 mr-0.5" />
                  {strat.label}
                </Badge>
                <span
                  className={`inline-flex items-center gap-1 px-1.5 h-5 rounded-md text-[10px] font-semibold ${status.bg} ${status.border} border ${status.color}`}
                >
                  {isRunning ? (
                    <motion.span
                      animate={{ opacity: [1, 0.3, 1] }}
                      transition={{ duration: 1.6, repeat: Infinity }}
                      className={`w-1.5 h-1.5 rounded-full ${status.dot}`}
                    />
                  ) : (
                    <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
                  )}
                  <StatusIcon className="h-2.5 w-2.5" />
                  {status.label}
                </span>
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {bot.timeframe}
                </span>
              </div>
            </div>
          </div>

          {/* Toggle switch */}
          <div className="flex flex-col items-end gap-1 shrink-0">
            <Switch
              checked={bot.enabled}
              onCheckedChange={() => onToggle(bot)}
              disabled={toggling}
              className="cursor-pointer"
              aria-label={bot.enabled ? 'Stop bot' : 'Start bot'}
            />
            <span className="text-[9px] text-muted-foreground tabular-nums">
              {toggling ? '…' : bot.enabled ? 'ON' : 'OFF'}
            </span>
          </div>
        </div>
      </div>

      {/* Quick stats */}
      <CardContent className="p-3.5 space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <BotStat
            label="Allocation"
            value={formatCompactCurrency(bot.allocationAmount)}
            icon={DollarSign}
            iconClass="text-primary"
          />
          <BotStat
            label="Total P&L"
            value={`${pnl >= 0 ? '+' : ''}${formatCompactCurrency(pnl)}`}
            icon={pnl >= 0 ? TrendingUp : TrendingDown}
            iconClass={pnl >= 0 ? 'text-emerald-500' : 'text-red-500'}
            valueClass={pnl >= 0 ? 'text-emerald-500' : 'text-red-500'}
          />
          <BotStat
            label="Win Rate"
            value={`${winRate}%`}
            icon={Target}
            iconClass={winRate >= 50 ? 'text-emerald-500' : 'text-orange-500'}
            valueClass={winRate >= 50 ? 'text-emerald-500' : 'text-orange-500'}
          />
          <BotStat
            label="Trades"
            value={formatNumber(totalTrades)}
            icon={BarChart3}
            iconClass="text-muted-foreground"
          />
        </div>

        {/* Symbols */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] text-muted-foreground font-medium">Symbols:</span>
          {symbols.length === 0 ? (
            <span className="text-[10px] text-muted-foreground/60 italic">none</span>
          ) : (
            symbols.slice(0, 6).map((s) => (
              <Badge
                key={s}
                variant="secondary"
                className="text-[9px] h-4 px-1.5 bg-muted/70 font-semibold"
              >
                {s}
              </Badge>
            ))
          )}
          {symbols.length > 6 && (
            <span className="text-[9px] text-muted-foreground">
              +{symbols.length - 6}
            </span>
          )}
        </div>

        {/* Action row */}
        <div className="flex items-center justify-between pt-1 border-t border-border/40">
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span className="tabular-nums">
              Last trade: {timeAgo(bot.lastTradeAt)}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggleExpanded}
              className="h-7 px-2 text-[11px] cursor-pointer"
            >
              <Settings2 className="h-3.5 w-3.5 mr-1" />
              {expanded ? 'Hide' : 'Settings'}
              {expanded ? (
                <ChevronUp className="h-3.5 w-3.5 ml-1" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 ml-1" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDelete(bot)}
              disabled={deleting}
              className="h-7 w-7 p-0 cursor-pointer text-muted-foreground hover:text-red-500 hover:bg-red-500/10"
              aria-label="Delete bot"
            >
              {deleting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        </div>

        {/* Advanced settings (expandable) */}
        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="overflow-hidden"
            >
              <div className="pt-3 mt-1 border-t border-border/40 space-y-3">
                <div className="flex items-center gap-1.5">
                  <Settings2 className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                    Advanced Settings
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <SettingItem
                    label="Position Sizing"
                    value={POSITION_SIZING[bot.positionSizing ?? ''] ?? bot.positionSizing ?? '—'}
                  />
                  <SettingItem
                    label="Risk / Trade"
                    value={`${(bot.riskPerTrade ?? 0).toFixed(2)}%`}
                  />
                  <SettingItem
                    label="Max Positions"
                    value={formatNumber(bot.maxPositions ?? 0)}
                  />
                  <SettingItem
                    label="Trailing Stop"
                    value={`${(bot.trailingStopPct ?? 0).toFixed(1)}%`}
                  />
                  <SettingItem
                    label="Stop Loss"
                    value={`${(bot.stopLossPercent ?? 0).toFixed(1)}%`}
                    valueClass="text-red-500"
                  />
                  <SettingItem
                    label="Take Profit"
                    value={`${(bot.takeProfitPercent ?? 0).toFixed(1)}%`}
                    valueClass="text-emerald-500"
                  />
                  <SettingItem
                    label="Session"
                    value={TRADING_SESSIONS[bot.tradingSessions ?? ''] ?? bot.tradingSessions ?? '—'}
                  />
                  <SettingItem
                    label="Streak"
                    value={`${bot.currentStreak ?? 0}`}
                  />
                </div>

                {/* Win / Loss breakdown */}
                <div className="grid grid-cols-3 gap-2 pt-1">
                  <SettingItem label="Wins" value={formatNumber(bot.winTrades ?? 0)} valueClass="text-emerald-500" />
                  <SettingItem label="Losses" value={formatNumber(bot.lossTrades ?? 0)} valueClass="text-red-500" />
                  <SettingItem
                    label="Best"
                    value={formatCompactCurrency(bot.bestTrade ?? 0)}
                    valueClass="text-emerald-500"
                  />
                </div>

                {/* Timestamps */}
                <div className="grid grid-cols-2 gap-2 pt-1 text-[10px] text-muted-foreground">
                  <div>
                    <span className="font-medium">Created:</span>{' '}
                    <span className="tabular-nums">{timeAgo(bot.createdAt)}</span>
                  </div>
                  <div>
                    <span className="font-medium">Updated:</span>{' '}
                    <span className="tabular-nums">{timeAgo(bot.updatedAt)}</span>
                  </div>
                </div>

                {bot.lastError && (
                  <div className="flex items-start gap-2 p-2 rounded-lg bg-red-500/[0.06] border border-red-500/20">
                    <AlertTriangle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-red-600 dark:text-red-400 break-words">
                      {bot.lastError}
                    </p>
                  </div>
                )}

                {/* Delete confirm row */}
                <div className="flex items-center justify-between gap-2 pt-1">
                  <span className="text-[10px] text-muted-foreground">
                    Bot ID: <span className="font-mono tabular-nums">{bot.id}</span>
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onDelete(bot)}
                    disabled={deleting}
                    className="h-7 text-[11px] cursor-pointer border-red-500/30 text-red-500 hover:bg-red-500/10 hover:text-red-600"
                  >
                    {deleting ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5 mr-1" />
                    )}
                    Delete Bot
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}

function BotStat({
  label,
  value,
  icon: Icon,
  iconClass,
  valueClass,
}: {
  label: string;
  value: string;
  icon: typeof Bot;
  iconClass?: string;
  valueClass?: string;
}) {
  return (
    <div className="p-2 rounded-lg bg-muted/40 border border-border/30">
      <div className="flex items-center gap-1 mb-0.5">
        <Icon className={`h-3 w-3 ${iconClass ?? 'text-muted-foreground'}`} />
        <span className="text-[9px] text-muted-foreground font-medium uppercase tracking-wide">
          {label}
        </span>
      </div>
      <p className={`text-sm font-bold tabular-nums ${valueClass ?? ''}`}>{value}</p>
    </div>
  );
}

function SettingItem({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="p-2 rounded-lg bg-muted/30 border border-border/30">
      <p className="text-[9px] text-muted-foreground font-medium uppercase tracking-wide">
        {label}
      </p>
      <p className={`text-xs font-bold tabular-nums mt-0.5 ${valueClass ?? ''}`}>{value}</p>
    </div>
  );
}

// ============================================================
// Loading skeleton
// ============================================================
function BotsLoadingSkeleton() {
  return (
    <div className="space-y-3">
      <Card className="border-border/40 overflow-hidden">
        <CardContent className="p-4 lg:p-5 flex items-center justify-center min-h-[180px]">
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <span className="text-sm font-medium">Loading AI trading bots…</span>
            <span className="text-[11px] text-muted-foreground/70">
              Fetching bot configurations and performance stats.
            </span>
          </div>
        </CardContent>
      </Card>
      <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3 lg:gap-4">
        {[0, 1, 2].map((i) => (
          <Card key={i} className="border-border/40 overflow-hidden">
            <div className="px-4 py-3.5 border-b border-border/40 bg-muted/20">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-muted animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-32 rounded bg-muted animate-pulse" />
                  <div className="h-3 w-24 rounded bg-muted animate-pulse" />
                </div>
                <div className="w-10 h-5 rounded-full bg-muted animate-pulse" />
              </div>
            </div>
            <CardContent className="p-3.5 space-y-3">
              <div className="grid grid-cols-4 gap-2">
                {[0, 1, 2, 3].map((j) => (
                  <div key={j} className="h-12 rounded-lg bg-muted animate-pulse" />
                ))}
              </div>
              <div className="h-4 w-full rounded bg-muted animate-pulse" />
              <div className="h-7 w-1/2 rounded bg-muted animate-pulse" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// Empty state
// ============================================================
function BotsEmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <Card className="border-dashed border-border/60 overflow-hidden">
      <CardContent className="p-8 lg:p-12 flex flex-col items-center justify-center text-center">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center mb-4 shadow-sm">
          <Bot className="h-8 w-8 text-primary" />
        </div>
        <h3 className="text-base font-bold">No trading bots yet</h3>
        <p className="text-sm text-muted-foreground mt-1.5 max-w-sm">
          Create your first AI trading bot to automate your strategy. Choose from
          signal-based, DCA, grid, scalping or momentum strategies and let the AI
          execute trades on your behalf.
        </p>
        <Button onClick={onCreate} className="mt-4 cursor-pointer shadow-sm">
          <Plus className="h-4 w-4 mr-1.5" />
          Create Your First Bot
        </Button>
      </CardContent>
    </Card>
  );
}
