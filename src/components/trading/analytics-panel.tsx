'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  TrendingUp,
  TrendingDown,
  BarChart3,
  Shield,
  Target,
  Zap,
  Activity,
  Trophy,
  Loader2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

// ── Types ───────────────────────────────────────────────
interface PnlBar {
  label: string;
  pnl: number;
  pnlPercent: number;
  trades: number;
  wins: number;
}

interface AnalyticsStats {
  totalPnl: number;
  totalPnlPercent: number;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdown: number;
  profitFactor: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  bestTrade: number;
  worstTrade: number;
  totalTrades: number;
  winTrades: number;
  lossTrades: number;
}

interface AnalyticsData {
  daily: PnlBar[];
  weekly: PnlBar[];
  monthly: PnlBar[];
  stats: AnalyticsStats;
}

// ── Helpers ─────────────────────────────────────────────
function fmt(n: number, decimals = 2) {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// ── Metric Card ─────────────────────────────────────────
function MetricCard({
  icon: Icon,
  label,
  value,
 sub,
  color = 'text-foreground',
  delay = 0,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
  color?: string;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="rounded-lg border bg-card p-3.5 flex items-start gap-3"
    >
      <div className="mt-0.5 rounded-md bg-muted p-1.5 shrink-0">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground leading-tight">{label}</p>
        <p className={`text-sm font-semibold tabular-nums mt-0.5 ${color}`}>{value}</p>
        {sub && (
          <p className="text-[11px] text-muted-foreground tabular-nums mt-0.5">{sub}</p>
        )}
      </div>
    </motion.div>
  );
}

// ── CSS Bar Chart ───────────────────────────────────────
function PnlBarChart({
  data,
  title,
}: {
  data: PnlBar[];
  title: string;
}) {
  const maxAbs = Math.max(...data.map((d) => Math.abs(d.pnl)), 1);
  const totalPnl = data.reduce((s, d) => s + d.pnl, 0);

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        <Badge
          variant={totalPnl >= 0 ? 'default' : 'destructive'}
          className="text-[10px] px-1.5 py-0 h-5 tabular-nums"
        >
          {totalPnl >= 0 ? '+' : ''}${fmt(totalPnl, 0)}
        </Badge>
      </CardHeader>
      <CardContent>
        <div className="flex items-end gap-2 h-36">
          {data.map((d, i) => {
            const heightPct = Math.max((Math.abs(d.pnl) / maxAbs) * 100, 2);
            const isProfit = d.pnl >= 0;
            return (
              <motion.div
                key={d.label}
                initial={{ height: 0 }}
                animate={{ height: `${heightPct}%` }}
                transition={{ delay: i * 60, duration: 0.4, ease: 'easeOut' }}
                className="flex-1 flex flex-col items-center justify-end min-w-0"
                title={`${d.label}: ${isProfit ? '+' : ''}$${fmt(d.pnl)}`}
              >
                <span className="text-[10px] tabular-nums font-medium mb-1 leading-tight text-center">
                  {d.pnl !== 0 && (
                    <span className={isProfit ? 'text-emerald-500' : 'text-red-500'}>
                      {isProfit ? '+' : ''}${Math.abs(d.pnl) >= 1000
                        ? `${(d.pnl / 1000).toFixed(1)}k`
                        : fmt(d.pnl, 0)}
                    </span>
                  )}
                </span>
                <div
                  className={`w-full max-w-[40px] rounded-t-sm ${
                    isProfit
                      ? 'bg-emerald-500/80 hover:bg-emerald-500'
                      : 'bg-red-500/80 hover:bg-red-500'
                  } transition-colors cursor-default`}
                  style={{ minHeight: '4px' }}
                />
                <span className="text-[10px] text-muted-foreground mt-1.5 tabular-nums truncate w-full text-center">
                  {d.label}
                </span>
              </motion.div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main Component ──────────────────────────────────────
export function AnalyticsPanel() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchAnalytics() {
      try {
        setLoading(true);
        const res = await fetch('/api/trading/analytics');
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to load analytics');
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchAnalytics();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-3.5">
                <div className="h-3 w-14 bg-muted rounded mb-2" />
                <div className="h-5 w-20 bg-muted rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-4">
                <div className="h-36 bg-muted rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card className="border-destructive/50 bg-destructive/5">
        <CardContent className="p-6 text-center">
          <Shield className="h-8 w-8 text-destructive/50 mx-auto mb-2" />
          <p className="text-sm text-destructive">{error ?? 'No analytics data available'}</p>
        </CardContent>
      </Card>
    );
  }

  const { stats, daily, weekly, monthly } = data;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-4"
    >
      {/* ── Risk Metrics Grid ──────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard
          icon={Zap}
          label="Sharpe Ratio"
          value={fmt(stats.sharpeRatio)}
          delay={0}
        />
        <MetricCard
          icon={Activity}
          label="Sortino Ratio"
          value={fmt(stats.sortinoRatio)}
          delay={0.05}
        />
        <MetricCard
          icon={Shield}
          label="Max Drawdown"
          value={`${fmt(stats.maxDrawdown)}%`}
          color="text-red-400"
          delay={0.1}
        />
        <MetricCard
          icon={BarChart3}
          label="Profit Factor"
          value={fmt(stats.profitFactor)}
          sub={stats.profitFactor >= 1 ? 'Profitable' : 'Unprofitable'}
          color={stats.profitFactor >= 1 ? 'text-emerald-500' : 'text-red-500'}
          delay={0.15}
        />
        <MetricCard
          icon={TrendingUp}
          label="Avg Win"
          value={`+$${fmt(stats.avgWin)}`}
          color="text-emerald-500"
          delay={0.2}
        />
        <MetricCard
          icon={TrendingDown}
          label="Avg Loss"
          value={`-$${fmt(stats.avgLoss)}`}
          color="text-red-500"
          delay={0.25}
        />
        <MetricCard
          icon={Target}
          label="Win Rate"
          value={`${fmt(stats.winRate, 1)}%`}
          sub={`${stats.winTrades}W / ${stats.lossTrades}L of ${stats.totalTrades}`}
          delay={0.3}
        />
        <MetricCard
          icon={Trophy}
          label="Total Trades"
          value={String(stats.totalTrades)}
          sub={`P&L: ${stats.totalPnl >= 0 ? '+' : ''}$${fmt(stats.totalPnl)}`}
          color={stats.totalPnl >= 0 ? 'text-emerald-500' : 'text-red-500'}
          delay={0.35}
        />
      </div>

      {/* ── P&L Bar Charts ────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <PnlBarChart data={daily} title="Daily P&L (7d)" />
        <PnlBarChart data={weekly} title="Weekly P&L (4w)" />
        <PnlBarChart data={monthly} title="Monthly P&L (6m)" />
      </div>
    </motion.div>
  );
}
