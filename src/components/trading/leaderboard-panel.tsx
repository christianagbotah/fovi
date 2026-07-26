'use client';

// ============================================================
// LeaderboardPanel — Paper Trading Leaderboard
// ------------------------------------------------------------
// Fetches /api/trading/leaderboard (10 simulated paper traders
// plus the current user's rank) and renders:
//
//   • Top bar: user's own rank card (primary-color border highlight)
//   • Leaderboard list: 10 traders ranked by totalPnl
//     - Top 3 get gold (#f59e0b) / silver (#94a3b8) / bronze
//       (#d97706) ring borders around their avatars
//     - Each row shows: rank, colored avatar with initials, name,
//       strategy badge, P&L (green/red), win rate, total trades,
//       and Sharpe ratio (Sharpe + trades are hidden on mobile)
//   • Loading skeleton state and a manual refresh button
//   • Framer Motion staggered entrance for each row
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Trophy,
  RefreshCw,
  Loader2,
  Flame,
  AlertTriangle,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

// ── Types ──────────────────────────────────────────────────
type Strategy =
  | 'signal_based'
  | 'dca'
  | 'grid'
  | 'scalping'
  | 'momentum'
  | 'breakout';

interface LeaderboardEntry {
  rank: number;
  name: string;
  avatar: string;
  totalPnl: number;
  pnlPercent: number;
  winRate: number;
  totalTrades: number;
  sharpeRatio: number;
  streak: number;
  strategy: Strategy;
}

interface LeaderboardData {
  leaderboard: LeaderboardEntry[];
  userRank: LeaderboardEntry;
}

// ── Visual configs ─────────────────────────────────────────
// Top-3 podium ring + glow colors (NO emojis — pure CSS rings).
const PODIUM_RING: Record<number, string> = {
  1: 'ring-[#f59e0b]', // gold
  2: 'ring-[#94a3b8]', // silver
  3: 'ring-[#d97706]', // bronze
};

const PODIUM_GLOW: Record<number, string> = {
  1: 'shadow-[0_0_18px_-4px_rgba(245,158,11,0.55)]',
  2: 'shadow-[0_0_14px_-6px_rgba(148,163,184,0.55)]',
  3: 'shadow-[0_0_14px_-6px_rgba(217,119,6,0.55)]',
};

const PODIUM_RANK_BG: Record<number, string> = {
  1: 'bg-[#f59e0b]/15 text-[#f59e0b]',
  2: 'bg-[#94a3b8]/15 text-[#94a3b8]',
  3: 'bg-[#d97706]/15 text-[#d97706]',
};

// Avatar color palette — deliberately excludes indigo/blue.
const AVATAR_COLORS: string[] = [
  'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  'bg-rose-500/15 text-rose-600 dark:text-rose-400',
  'bg-orange-500/15 text-orange-600 dark:text-orange-400',
  'bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400',
  'bg-lime-500/15 text-lime-600 dark:text-lime-400',
  'bg-teal-500/15 text-teal-600 dark:text-teal-400',
  'bg-purple-500/15 text-purple-600 dark:text-purple-400',
  'bg-red-500/15 text-red-600 dark:text-red-400',
  'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400',
];

const STRATEGY_LABELS: Record<Strategy, string> = {
  signal_based: 'Signal',
  dca: 'DCA',
  grid: 'Grid',
  scalping: 'Scalp',
  momentum: 'Momentum',
  breakout: 'Breakout',
};

// ── Helpers ────────────────────────────────────────────────
function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function fmtMoney(n: number): string {
  const sign = n >= 0 ? '+' : '-';
  const abs = Math.abs(n);
  return `${sign}$${abs.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtPct(n: number): string {
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

// ── User rank card (top bar) ───────────────────────────────
function UserRankCard({ user }: { user: LeaderboardEntry }) {
  const isPositive = user.totalPnl >= 0;
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <Card className="border-primary/50 ring-2 ring-primary/30 bg-primary/5">
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-center gap-3 sm:gap-4">
            {/* Rank badge */}
            <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-primary text-primary-foreground font-bold text-base sm:text-lg shrink-0 tabular-nums">
              #{user.rank}
            </div>

            {/* Avatar + identity */}
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div
                className={`flex items-center justify-center w-10 h-10 rounded-full font-bold text-sm shrink-0 ${avatarColor('You')}`}
              >
                {user.avatar}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm sm:text-base truncate">
                    {user.name}
                  </span>
                  <Badge variant="outline" className="text-[9px] h-5">
                    YOU
                  </Badge>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <Badge variant="secondary" className="text-[9px] h-5">
                    {STRATEGY_LABELS[user.strategy]}
                  </Badge>
                  {user.streak > 0 && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-500 font-medium">
                      <Flame className="h-2.5 w-2.5" />
                      {user.streak} streak
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Stats */}
            <div className="flex items-center gap-4 sm:gap-6 shrink-0">
              <div className="text-right">
                <p
                  className={`text-sm sm:text-base font-bold tabular-nums ${
                    isPositive ? 'text-emerald-500' : 'text-red-500'
                  }`}
                >
                  {fmtMoney(user.totalPnl)}
                </p>
                <p className="text-[10px] text-muted-foreground tabular-nums">
                  {fmtPct(user.pnlPercent)}
                </p>
              </div>
              <div className="text-right hidden sm:block">
                <p className="text-sm font-bold tabular-nums">
                  {user.winRate.toFixed(1)}%
                </p>
                <p className="text-[10px] text-muted-foreground">Win Rate</p>
              </div>
              <div className="text-right hidden md:block">
                <p className="text-sm font-bold tabular-nums">
                  {user.sharpeRatio.toFixed(2)}
                </p>
                <p className="text-[10px] text-muted-foreground">Sharpe</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ── Leaderboard row ────────────────────────────────────────
function LeaderboardRow({
  entry,
  index,
}: {
  entry: LeaderboardEntry;
  index: number;
}) {
  const isPositive = entry.totalPnl >= 0;
  const isPodium = entry.rank <= 3;
  const ring = PODIUM_RING[entry.rank];
  const glow = PODIUM_GLOW[entry.rank];
  const rankBg = PODIUM_RANK_BG[entry.rank];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        delay: Math.min(index * 0.05, 0.5),
        duration: 0.25,
        ease: 'easeOut',
      }}
      className={`flex items-center gap-3 px-3 sm:px-4 py-2.5 rounded-lg transition-colors hover:bg-accent/40 ${
        isPodium ? `ring-1 ${ring} ${glow} bg-card mb-1` : 'border-b border-border/40'
      }`}
    >
      {/* Rank cell */}
      <div
        className={`flex items-center justify-center w-7 h-7 rounded-md font-bold text-xs shrink-0 tabular-nums ${
          isPodium ? rankBg : 'bg-muted text-muted-foreground'
        }`}
      >
        {entry.rank}
      </div>

      {/* Avatar */}
      <div
        className={`flex items-center justify-center w-9 h-9 rounded-full font-bold text-xs shrink-0 ${avatarColor(
          entry.name,
        )} ${isPodium ? `ring-2 ${ring}` : ''}`}
      >
        {entry.avatar}
      </div>

      {/* Name + strategy */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold truncate">{entry.name}</span>
          {entry.streak >= 5 && (
            <span
              className="inline-flex items-center gap-0.5 text-[10px] text-amber-500 font-medium shrink-0"
              title={`${entry.streak}-trade win streak`}
            >
              <Flame className="h-2.5 w-2.5" />
              {entry.streak}
            </span>
          )}
        </div>
        <Badge variant="secondary" className="text-[9px] h-4 mt-0.5">
          {STRATEGY_LABELS[entry.strategy]}
        </Badge>
      </div>

      {/* P&L */}
      <div className="text-right shrink-0 w-20 sm:w-24">
        <p
          className={`text-xs sm:text-sm font-bold tabular-nums ${
            isPositive ? 'text-emerald-500' : 'text-red-500'
          }`}
        >
          {fmtMoney(entry.totalPnl)}
        </p>
        <p
          className={`text-[10px] tabular-nums ${
            isPositive ? 'text-emerald-500/70' : 'text-red-500/70'
          }`}
        >
          {fmtPct(entry.pnlPercent)}
        </p>
      </div>

      {/* Win rate */}
      <div className="text-right shrink-0 w-12 sm:w-14">
        <p className="text-xs sm:text-sm font-semibold tabular-nums">
          {entry.winRate.toFixed(1)}%
        </p>
        <p className="text-[9px] text-muted-foreground">Win</p>
      </div>

      {/* Total trades — hidden on small screens */}
      <div className="text-right shrink-0 w-14 hidden md:block">
        <p className="text-xs sm:text-sm font-semibold tabular-nums">
          {entry.totalTrades}
        </p>
        <p className="text-[9px] text-muted-foreground">Trades</p>
      </div>

      {/* Sharpe ratio — hidden on small screens */}
      <div className="text-right shrink-0 w-14 hidden md:block">
        <p className="text-xs sm:text-sm font-semibold tabular-nums">
          {entry.sharpeRatio.toFixed(2)}
        </p>
        <p className="text-[9px] text-muted-foreground">Sharpe</p>
      </div>
    </motion.div>
  );
}

// ── Loading skeleton ───────────────────────────────────────
function LeaderboardSkeleton() {
  return (
    <div className="space-y-3">
      <Card className="border-primary/30">
        <CardContent className="p-5">
          <div className="flex items-center gap-3">
            <Skeleton className="h-12 w-12 rounded-xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-16" />
            </div>
            <Skeleton className="h-8 w-24" />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-3 space-y-1">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2.5">
              <Skeleton className="h-7 w-7 rounded-md" />
              <Skeleton className="h-9 w-9 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-3 w-12" />
              </div>
              <Skeleton className="h-6 w-20" />
              <Skeleton className="h-6 w-12" />
              <Skeleton className="h-6 w-14 hidden md:block" />
              <Skeleton className="h-6 w-14 hidden md:block" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────
export function LeaderboardPanel() {
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (silent = false) => {
    try {
      if (silent) setRefreshing(true);
      else setLoading(true);
      const res = await fetch('/api/trading/leaderboard', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load leaderboard');
      setData(json as LeaderboardData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    // Light background refresh every 60s — the leaderboard itself
    // rotates daily, but a periodic poll keeps streaks / counts
    // feeling live without hammering the API.
    const id = setInterval(() => fetchData(true), 60_000);
    return () => clearInterval(id);
  }, [fetchData]);

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Trophy className="h-4 w-4 text-amber-500" />
          Paper Trading Leaderboard
          <Badge variant="outline" className="text-[10px] h-5 ml-1">
            Top 10
          </Badge>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 cursor-pointer"
          onClick={() => fetchData(true)}
          disabled={refreshing}
        >
          {refreshing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Refresh
        </Button>
      </div>

      {loading ? (
        <LeaderboardSkeleton />
      ) : error || !data ? (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="p-6 text-center">
            <AlertTriangle className="h-8 w-8 text-destructive/50 mx-auto mb-2" />
            <p className="text-sm text-destructive">
              {error ?? 'No leaderboard data available'}
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-3 cursor-pointer"
              onClick={() => fetchData()}
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* User's own rank — highlighted top bar */}
          <UserRankCard user={data.userRank} />

          {/* Leaderboard list */}
          <Card className="overflow-hidden">
            <CardContent className="p-3 sm:p-4">
              {/* Column header row — desktop only */}
              <div className="hidden md:flex items-center gap-3 px-3 sm:px-4 pb-2 mb-1 border-b border-border/40 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                <div className="w-7 text-center">Rank</div>
                <div className="w-9" />
                <div className="flex-1">Trader</div>
                <div className="text-right w-24">P&amp;L</div>
                <div className="text-right w-14">Win</div>
                <div className="text-right w-14">Trades</div>
                <div className="text-right w-14">Sharpe</div>
              </div>

              <div className="space-y-0.5">
                {data.leaderboard.map((entry, idx) => (
                  <LeaderboardRow key={entry.name} entry={entry} index={idx} />
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Footnote */}
          <p className="text-[10px] text-muted-foreground text-center">
            Rankings refresh daily based on simulated paper-trading performance.
          </p>
        </>
      )}
    </div>
  );
}
