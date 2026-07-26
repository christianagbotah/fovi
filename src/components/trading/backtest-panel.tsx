'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play,
  Loader2,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Target,
  Shield,
  Zap,
  Activity,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';

// ── Types ───────────────────────────────────────────────
interface BacktestStats {
  totalPnl: number;
  pnlPercent: number;
  totalTrades: number;
  winTrades: number;
  lossTrades: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  maxDrawdown: number;
  sharpeRatio: number;
  sortinoRatio: number;
  profitFactor: number;
  bestTrade: number;
  worstTrade: number;
}

interface BacktestTrade {
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  exitPrice: number;
  qty: number;
  pnl: number;
  pnlPercent: number;
  entryDate: number;
  exitDate: number;
  signalType: string;
  holdBars: number;
}

interface BacktestResult {
  trades: BacktestTrade[];
  equityCurve: number[];
  stats: BacktestStats;
}

// ── Form defaults ───────────────────────────────────────
const DEFAULTS = {
  symbol: 'AAPL',
  timeframe: '1d',
  strategy: 'signal_based',
  allocation: 10000,
  stopLoss: 2,
  takeProfit: 4,
  trailing: 1.5,
  sizing: 'fixed_fractional',
  risk: 2,
};

const TIMEFRAMES = [
  { value: '1m', label: '1m' },
  { value: '5m', label: '5m' },
  { value: '15m', label: '15m' },
  { value: '1h', label: '1h' },
  { value: '4h', label: '4h' },
  { value: '1d', label: '1d' },
];

const STRATEGIES = [
  { value: 'signal_based', label: 'Signal Based' },
  { value: 'dca', label: 'DCA' },
  { value: 'grid', label: 'Grid' },
  { value: 'scalping', label: 'Scalping' },
  { value: 'momentum', label: 'Momentum' },
];

const SIZINGS = [
  { value: 'kelly', label: 'Kelly' },
  { value: 'fixed_fractional', label: 'Fixed Fractional' },
  { value: 'volatility', label: 'Volatility' },
  { value: 'fixed', label: 'Fixed' },
];

// ── Helpers ─────────────────────────────────────────────
function fmt(n: number, decimals = 2) {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtDate(ts: number) {
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

// ── Equity Curve SVG ────────────────────────────────────
function EquityCurve({ data }: { data: number[] }) {
  if (data.length < 2) return null;

  const w = 600;
  const h = 180;
  const pad = { top: 12, right: 12, bottom: 12, left: 12 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const step = plotW / (data.length - 1);
  const points = data.map((v, i) => ({
    x: pad.left + i * step,
    y: pad.top + plotH - ((v - min) / range) * plotH,
  }));

  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ');

  const areaPath =
    linePath +
    ` L${points[points.length - 1].x.toFixed(1)},${(pad.top + plotH).toFixed(1)}` +
    ` L${points[0].x.toFixed(1)},${(pad.top + plotH).toFixed(1)} Z`;

  const isPositive = data[data.length - 1] >= data[0];
  const stroke = isPositive ? '#10b981' : '#ef4444';
  const fill = isPositive ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)';

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="w-full h-auto"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <linearGradient id="ecGrad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.25" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#ecGrad)" />
      <path d={linePath} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" />
      <circle
        cx={points[0].x}
        cy={points[0].y}
        r="3"
        fill={stroke}
      />
      <circle
        cx={points[points.length - 1].x}
        cy={points[points.length - 1].y}
        r="3"
        fill={stroke}
      />
    </svg>
  );
}

// ── Stat Card ───────────────────────────────────────────
function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color = 'text-foreground',
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-start gap-3 rounded-lg border bg-card p-3"
    >
      <div className="mt-0.5 rounded-md bg-muted p-1.5">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground leading-tight">{label}</p>
        <p className={`text-sm font-semibold tabular-nums ${color}`}>{value}</p>
        {sub && <p className="text-[11px] text-muted-foreground tabular-nums">{sub}</p>}
      </div>
    </motion.div>
  );
}

// ── Main Component ──────────────────────────────────────
export function BacktestPanel() {
  const [symbol, setSymbol] = useState(DEFAULTS.symbol);
  const [timeframe, setTimeframe] = useState(DEFAULTS.timeframe);
  const [strategy, setStrategy] = useState(DEFAULTS.strategy);
  const [allocation, setAllocation] = useState(String(DEFAULTS.allocation));
  const [stopLoss, setStopLoss] = useState(String(DEFAULTS.stopLoss));
  const [takeProfit, setTakeProfit] = useState(String(DEFAULTS.takeProfit));
  const [trailing, setTrailing] = useState(String(DEFAULTS.trailing));
  const [sizing, setSizing] = useState(DEFAULTS.sizing);
  const [risk, setRisk] = useState(String(DEFAULTS.risk));

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runBacktest = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/trading/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          timeframe,
          strategy,
          allocationAmount: Number(allocation),
          stopLossPercent: Number(stopLoss),
          takeProfitPercent: Number(takeProfit),
          trailingStopPct: Number(trailing),
          positionSizing: sizing,
          riskPerTrade: Number(risk),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Backtest failed');
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [symbol, timeframe, strategy, allocation, stopLoss, takeProfit, trailing, sizing, risk]);

  const { stats, trades, equityCurve } = result ?? { stats: null as unknown as BacktestStats, trades: [], equityCurve: [] as number[] };

  return (
    <div className="space-y-4">
      {/* ── Configuration Form ──────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            Strategy Backtest
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {/* Symbol */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Symbol</label>
              <Input
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                className="h-8 text-sm tabular-nums"
              />
            </div>

            {/* Timeframe */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Timeframe</label>
              <Select value={timeframe} onValueChange={setTimeframe}>
                <SelectTrigger className="h-8 text-sm w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMEFRAMES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Strategy */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Strategy</label>
              <Select value={strategy} onValueChange={setStrategy}>
                <SelectTrigger className="h-8 text-sm w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STRATEGIES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Allocation */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Allocation ($)</label>
              <Input
                type="number"
                value={allocation}
                onChange={(e) => setAllocation(e.target.value)}
                className="h-8 text-sm tabular-nums"
              />
            </div>

            {/* Stop Loss % */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Stop Loss %</label>
              <Input
                type="number"
                step="0.1"
                value={stopLoss}
                onChange={(e) => setStopLoss(e.target.value)}
                className="h-8 text-sm tabular-nums"
              />
            </div>

            {/* Take Profit % */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Take Profit %</label>
              <Input
                type="number"
                step="0.1"
                value={takeProfit}
                onChange={(e) => setTakeProfit(e.target.value)}
                className="h-8 text-sm tabular-nums"
              />
            </div>

            {/* Trailing Stop % */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Trailing Stop %</label>
              <Input
                type="number"
                step="0.1"
                value={trailing}
                onChange={(e) => setTrailing(e.target.value)}
                className="h-8 text-sm tabular-nums"
              />
            </div>

            {/* Position Sizing */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Position Sizing</label>
              <Select value={sizing} onValueChange={setSizing}>
                <SelectTrigger className="h-8 text-sm w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SIZINGS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Risk Per Trade % */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Risk Per Trade %</label>
              <Input
                type="number"
                step="0.1"
                value={risk}
                onChange={(e) => setRisk(e.target.value)}
                className="h-8 text-sm tabular-nums"
              />
            </div>
          </div>

          <Button
            onClick={runBacktest}
            disabled={loading}
            className="w-full sm:w-auto"
            size="sm"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Running Backtest…
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" />
                Run Backtest
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* ── Error ──────────────────────────────────────── */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <Card className="border-destructive/50 bg-destructive/5">
              <CardContent className="p-3 text-sm text-destructive">{error}</CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Loading Skeleton ────────────────────────────── */}
      <AnimatePresence>
        {loading && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="grid grid-cols-2 sm:grid-cols-3 gap-3"
          >
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="animate-pulse">
                <CardContent className="p-3">
                  <div className="h-3 w-16 bg-muted rounded mb-2" />
                  <div className="h-5 w-24 bg-muted rounded" />
                </CardContent>
              </Card>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Results ─────────────────────────────────────── */}
      <AnimatePresence>
        {result && !loading && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="space-y-4"
          >
            {/* Summary Stats Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <StatCard
                icon={Activity}
                label="Total P&L"
                value={`${stats.totalPnl >= 0 ? '+' : ''}$${fmt(Math.abs(stats.totalPnl))}`}
                sub={`${stats.pnlPercent >= 0 ? '+' : ''}${fmt(stats.pnlPercent)}%`}
                color={stats.totalPnl >= 0 ? 'text-emerald-500' : 'text-red-500'}
              />
              <StatCard
                icon={Target}
                label="Win Rate"
                value={`${fmt(stats.winRate, 1)}%`}
                sub={`${stats.winTrades}W / ${stats.lossTrades}L`}
              />
              <StatCard
                icon={Zap}
                label="Sharpe Ratio"
                value={fmt(stats.sharpeRatio)}
              />
              <StatCard
                icon={Shield}
                label="Max Drawdown"
                value={`${fmt(stats.maxDrawdown)}%`}
                color="text-red-400"
              />
              <StatCard
                icon={BarChart3}
                label="Profit Factor"
                value={fmt(stats.profitFactor)}
              />
              <StatCard
                icon={TrendingUp}
                label="Total Trades"
                value={String(stats.totalTrades)}
              />
            </div>

            {/* Equity Curve */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Equity Curve</CardTitle>
              </CardHeader>
              <CardContent>
                <EquityCurve data={equityCurve} />
                <div className="flex justify-between mt-2 text-[11px] text-muted-foreground tabular-nums">
                  <span>Start: ${fmt(equityCurve[0] ?? 0, 0)}</span>
                  <span>End: ${fmt(equityCurve[equityCurve.length - 1] ?? 0, 0)}</span>
                </div>
              </CardContent>
            </Card>

            {/* Trade List */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">
                  Trades ({trades.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="max-h-96">
                  <div className="min-w-[540px]">
                    {/* Table Header */}
                    <div className="grid grid-cols-[64px_48px_80px_80px_80px_64px] gap-2 px-4 py-2 text-[11px] font-medium text-muted-foreground border-b bg-muted/30">
                      <span>Symbol</span>
                      <span>Side</span>
                      <span className="text-right">Entry</span>
                      <span className="text-right">Exit</span>
                      <span className="text-right">P&L</span>
                      <span className="text-right">Bars</span>
                    </div>
                    {/* Rows */}
                    {trades.map((t, i) => (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: Math.min(i * 20, 600) }}
                        className="grid grid-cols-[64px_48px_80px_80px_80px_64px] gap-2 px-4 py-2.5 text-sm tabular-nums border-b last:border-0 hover:bg-accent/30 transition-colors"
                      >
                        <span className="font-medium">{t.symbol}</span>
                        <span>
                          <Badge
                            variant={t.side === 'long' ? 'default' : 'destructive'}
                            className="text-[10px] px-1.5 py-0 h-5"
                          >
                            {t.side === 'long' ? (
                              <TrendingUp className="h-3 w-3 mr-0.5" />
                            ) : (
                              <TrendingDown className="h-3 w-3 mr-0.5" />
                            )}
                            {t.side}
                          </Badge>
                        </span>
                        <span className="text-right text-muted-foreground">
                          ${fmt(t.entryPrice)}
                        </span>
                        <span className="text-right text-muted-foreground">
                          ${fmt(t.exitPrice)}
                        </span>
                        <span
                          className={`text-right font-medium ${
                            t.pnl >= 0 ? 'text-emerald-500' : 'text-red-500'
                          }`}
                        >
                          {t.pnl >= 0 ? '+' : ''}${fmt(t.pnl)}
                        </span>
                        <span className="text-right text-muted-foreground">
                          {t.holdBars}
                        </span>
                      </motion.div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
