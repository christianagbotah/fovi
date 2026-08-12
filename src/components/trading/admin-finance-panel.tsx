'use client';

import { useEffect, useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  DollarSign,
  TrendingUp,
  Users,
  Activity,
  Trophy,
  Wallet,
  Bot,
  ArrowUpDown,
  Shield,
  Loader2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// ── Types ───────────────────────────────────────────────
interface PerUserStat {
  userId: string;
  email: string;
  totalTrades: number;
  totalPnl: number;
  adminLevy: number;
  winRate: number;
}

interface RecentLevyTransaction {
  id: string;
  userId: string;
  email: string;
  adminLevyCollected: number;
  totalTrades: number;
}

interface PlatformMetrics {
  winRate: number;
  avgTradePnl: number;
  totalTrades: number;
}

interface FinanceData {
  totalUsers: number;
  activeTraders: number;
  totalDeposits: number;
  totalAdminLevyCollected: number;
  totalRealizedPnl: number;
  openPositions: number;
  totalBotsRunning: number;
  platformMetrics: PlatformMetrics;
  perUserStats: PerUserStat[];
  recentLevyTransactions: RecentLevyTransaction[];
}

type SortKey = 'email' | 'totalTrades' | 'totalPnl' | 'adminLevy' | 'winRate';
type SortDir = 'asc' | 'desc';

// ── Helpers ─────────────────────────────────────────────
function fmt(n: number, decimals = 2) {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function moneyColor(n: number) {
  return n >= 0 ? 'text-emerald-500' : 'text-red-500';
}

function moneyStr(n: number, showSign = true) {
  const sign = showSign && n > 0 ? '+' : '';
  return `${sign}$${fmt(n)}`;
}

// ── Main Component ──────────────────────────────────────
export function AdminFinancePanel() {
  const [data, setData] = useState<FinanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('adminLevy');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  useEffect(() => {
    let cancelled = false;
    async function fetchFinance() {
      try {
        setLoading(true);
        const res = await fetch('/api/admin/finance');
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to load finance data');
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchFinance();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const sortedUsers = useMemo(() => {
    if (!data) return [];
    return [...data.perUserStats].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortDir === 'asc'
        ? (av as number) - (bv as number)
        : (bv as number) - (av as number);
    });
  }, [data, sortKey, sortDir]);

  const maxLevy = useMemo(() => {
    if (!data) return 1;
    return Math.max(...data.perUserStats.map((u) => u.adminLevy), 1);
  }, [data]);

  // ── Loading Skeleton ──────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-4">
                <div className="h-3 w-16 bg-muted rounded mb-2" />
                <div className="h-6 w-24 bg-muted rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-4">
                <div className="h-3 w-14 bg-muted rounded mb-2" />
                <div className="h-5 w-20 bg-muted rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card className="animate-pulse">
          <CardContent className="p-4">
            <div className="h-40 bg-muted rounded" />
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Error State ──────────────────────────────────────
  if (error || !data) {
    return (
      <Card className="border-destructive/50 bg-destructive/5">
        <CardContent className="p-6 text-center">
          <Shield className="h-8 w-8 text-destructive/50 mx-auto mb-2" />
          <p className="text-sm text-destructive">
            {error ?? 'No finance data available'}
          </p>
        </CardContent>
      </Card>
    );
  }

  const { platformMetrics } = data;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-4"
    >
      {/* ── Top Summary Cards ──────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Total Levy Collected – Prominent */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0 }}
          className="rounded-lg border border-primary/20 bg-primary/10 p-4"
        >
          <div className="flex items-center gap-2 mb-1">
            <DollarSign className="h-4 w-4 text-primary" />
            <span className="text-xs text-muted-foreground">Total Levy Collected</span>
          </div>
          <p className="text-lg font-bold tabular-nums text-primary">
            ${fmt(data.totalAdminLevyCollected)}
          </p>
        </motion.div>

        {/* Active Traders */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="rounded-lg border border-border bg-card p-4"
        >
          <div className="flex items-center gap-2 mb-1">
            <Users className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Active Traders</span>
          </div>
          <p className="text-lg font-bold tabular-nums">
            {data.activeTraders}
            <span className="text-xs font-normal text-muted-foreground ml-1.5">
              / {data.totalUsers} users
            </span>
          </p>
        </motion.div>

        {/* Total Trades */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="rounded-lg border border-border bg-card p-4"
        >
          <div className="flex items-center gap-2 mb-1">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Total Trades</span>
          </div>
          <p className="text-lg font-bold tabular-nums">
            {platformMetrics.totalTrades}
          </p>
        </motion.div>

        {/* Platform Win Rate */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="rounded-lg border border-border bg-card p-4"
        >
          <div className="flex items-center gap-2 mb-1">
            <Trophy className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Platform Win Rate</span>
          </div>
          <p className="text-lg font-bold tabular-nums">
            {fmt(platformMetrics.winRate, 1)}%
          </p>
        </motion.div>
      </div>

      {/* ── Revenue Metrics Row ────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="rounded-lg border border-border bg-card p-4"
        >
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Total User P&L</span>
          </div>
          <p
            className={`text-lg font-bold tabular-nums ${moneyColor(data.totalRealizedPnl)}`}
          >
            {moneyStr(data.totalRealizedPnl)}
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="rounded-lg border border-border bg-card p-4"
        >
          <div className="flex items-center gap-2 mb-1">
            <Wallet className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Total Deposits</span>
          </div>
          <p className="text-lg font-bold tabular-nums">
            ${fmt(data.totalDeposits)}
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="rounded-lg border border-border bg-card p-4"
        >
          <div className="flex items-center gap-2 mb-1">
            <Bot className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Bots Running</span>
          </div>
          <p className="text-lg font-bold tabular-nums">
            {data.totalBotsRunning}
            <span className="text-xs font-normal text-muted-foreground ml-1.5">
              / {data.openPositions} open positions
            </span>
          </p>
        </motion.div>
      </div>

      {/* ── Per-User Levy Breakdown Table ──────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-primary" />
            Per-User Levy Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {sortedUsers.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No user trading data yet.
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card z-10">
                  <tr className="border-b border-border">
                    {(
                      [
                        ['email', 'Email'],
                        ['totalTrades', 'Trades'],
                        ['totalPnl', 'P&L'],
                        ['adminLevy', 'Levy Collected'],
                        ['winRate', 'Win Rate'],
                      ] as [SortKey, string][]
                    ).map(([key, label]) => (
                      <th
                        key={key}
                        className="text-left text-xs text-muted-foreground font-medium px-4 py-2.5 cursor-pointer select-none hover:text-foreground transition-colors"
                        onClick={() => toggleSort(key)}
                      >
                        <span className="inline-flex items-center gap-1">
                          {label}
                          {key === 'adminLevy' && (
                            <span className="text-primary">★</span>
                          )}
                          <ArrowUpDown
                            className={`h-3 w-3 transition-opacity ${
                              sortKey === key
                                ? 'opacity-100'
                                : 'opacity-0 group-hover:opacity-40'
                            }`}
                          />
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {sortedUsers.map((user, i) => (
                    <motion.tr
                      key={user.userId}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.35 + i * 0.04 }}
                      className="hover:bg-muted/50 transition-colors"
                    >
                      <td className="px-4 py-2.5 font-medium truncate max-w-[180px]">
                        {user.email}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums">
                        {user.totalTrades}
                      </td>
                      <td
                        className={`px-4 py-2.5 tabular-nums font-medium ${moneyColor(user.totalPnl)}`}
                      >
                        {moneyStr(user.totalPnl)}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums font-semibold text-primary">
                        ${fmt(user.adminLevy)}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums">
                        <span
                          className={`inline-flex items-center gap-1.5 ${
                            user.winRate >= 50
                              ? 'text-emerald-500'
                              : 'text-red-500'
                          }`}
                        >
                          {fmt(user.winRate, 1)}%
                          <span
                            className="inline-block w-10 h-1.5 rounded-full bg-muted overflow-hidden"
                          >
                            <motion.span
                              className={`block h-full rounded-full ${
                                user.winRate >= 50
                                  ? 'bg-emerald-500'
                                  : 'bg-red-500'
                              }`}
                              initial={{ width: 0 }}
                              animate={{
                                width: `${Math.min(user.winRate, 100)}%`,
                              }}
                              transition={{
                                delay: 0.5 + i * 0.04,
                                duration: 0.5,
                                ease: 'easeOut',
                              }}
                            />
                          </span>
                        </span>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Per-User Levy Bar Chart ────────────────────── */}
      {data.perUserStats.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              Levy by User
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-3 h-40">
              {sortedUsers.map((user, i) => {
                const heightPct = Math.max((user.adminLevy / maxLevy) * 100, 3);
                return (
                  <motion.div
                    key={user.userId}
                    initial={{ height: 0 }}
                    animate={{ height: `${heightPct}%` }}
                    transition={{
                      delay: 0.5 + i * 0.06,
                      duration: 0.45,
                      ease: 'easeOut',
                    }}
                    className="flex-1 flex flex-col items-center justify-end min-w-0"
                    title={`${user.email}: $${fmt(user.adminLevy)}`}
                  >
                    <span className="text-[10px] tabular-nums font-semibold mb-1 leading-tight text-center text-primary">
                      ${
                        user.adminLevy >= 1000
                          ? `$${(user.adminLevy / 1000).toFixed(1)}k`
                          : `$${fmt(user.adminLevy, 0)}`
                      }
                    </span>
                    <div
                      className="w-full max-w-[48px] rounded-t-sm bg-primary/80 hover:bg-primary transition-colors cursor-default"
                      style={{ minHeight: '4px' }}
                    />
                    <span className="text-[10px] text-muted-foreground mt-1.5 tabular-nums truncate w-full text-center">
                      {user.email.split('@')[0]}
                    </span>
                  </motion.div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </motion.div>
  );
}
