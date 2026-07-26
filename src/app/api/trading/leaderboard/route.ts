import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

// ============================================================
// GET /api/trading/leaderboard
// ------------------------------------------------------------
// Returns a daily-refreshed paper-trading leaderboard of 10
// simulated traders plus the current user's rank. Stats are
// generated deterministically from the day-of-year so the
// rankings stay stable for the whole UTC day, then rotate.
//
// Response shape:
//   {
//     "leaderboard": [ { rank, name, avatar, totalPnl, pnlPercent,
//                        winRate, totalTrades, sharpeRatio, streak,
//                        strategy }, ... 10 entries ],
//     "userRank":    { rank, name: "You", ... }
//   }
// ============================================================

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

interface LeaderboardResponse {
  leaderboard: LeaderboardEntry[];
  userRank: LeaderboardEntry;
}

// Diverse pool of paper-trader handles. We shuffle + slice 10 each day.
const TRADER_NAMES = [
  'AlphaWolf', 'QuantumFox', 'DeltaSurge', 'NeonTiger',
  'ApexHawk', 'ZenBull', 'CryptoSage', 'LunaRider',
  'GridMaster', 'PipPirate', 'EchoViper', 'NovaTide',
  'IronWolf', 'SigmaEdge', 'FluxWave',
];

const STRATEGIES: Strategy[] = [
  'signal_based',
  'dca',
  'grid',
  'scalping',
  'momentum',
  'breakout',
];

// ── Seeded RNG (mulberry32) ─────────────────────────────────
// Same seed → same sequence, so the leaderboard is stable for
// the whole day and reproducible on every server.
function mulberry32(seed: number) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function getDayOfYear(d: Date): number {
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  const now = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.floor((now - start) / 86_400_000);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ── Leaderboard builder ─────────────────────────────────────
function buildLeaderboard(): LeaderboardResponse {
  const dayOfYear = getDayOfYear(new Date());
  // Mix day-of-year with a fixed prime so consecutive days produce
  // noticeably different (but still deterministic) sequences.
  const seed = (dayOfYear * 2654435761) >>> 0;
  const rng = mulberry32(seed);

  // Fisher-Yates shuffle on a copy of the names pool, then take 10.
  const names = [...TRADER_NAMES];
  for (let i = names.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [names[i], names[j]] = [names[j], names[i]];
  }
  const topNames = names.slice(0, 10);

  // Generate stats for each trader. We add a slight skill bias toward
  // earlier-picked names so the ordering has some daily structure,
  // but the final rank is determined by totalPnl after sorting.
  const raw = topNames.map((name, i) => {
    const skillBias = 1 - i * 0.04;
    const totalPnl = round2(22000 * skillBias * (0.45 + rng() * 0.6) - 1500);
    return {
      name,
      avatar: name.charAt(0).toUpperCase(),
      totalPnl,
      pnlPercent: round2(totalPnl / 1000), // assume $100k paper capital base
      winRate: round1(48 + rng() * 32),
      totalTrades: Math.floor(55 + rng() * 195),
      sharpeRatio: round2(0.6 + rng() * 2.4),
      streak: Math.floor(rng() * 14) - 2,
      strategy: STRATEGIES[Math.floor(rng() * STRATEGIES.length)],
    };
  });

  // Sort by totalPnl desc and assign ranks 1..10.
  const sorted = raw.sort((a, b) => b.totalPnl - a.totalPnl);
  const leaderboard: LeaderboardEntry[] = sorted.map((e, i) => ({
    ...e,
    rank: i + 1,
  }));

  // User's rank: somewhere in the middle (3..7, 1-indexed).
  const userRankN = 3 + Math.floor(rng() * 5); // 3,4,5,6,7
  // The user sits between current rank N-1 (higher P&L) and rank N
  // (lower P&L). After insertion, user takes rank N.
  const lowerPnl = leaderboard[userRankN - 1].totalPnl;
  const upperPnl = leaderboard[userRankN - 2].totalPnl;
  const userPnl = lowerPnl + (upperPnl - lowerPnl) * (0.4 + rng() * 0.2);

  const userRank: LeaderboardEntry = {
    rank: userRankN,
    name: 'You',
    avatar: 'Y',
    totalPnl: round2(userPnl),
    pnlPercent: round2(userPnl / 1000),
    winRate: round1(54 + rng() * 18),
    totalTrades: Math.floor(60 + rng() * 60),
    sharpeRatio: round2(1.0 + rng() * 0.9),
    streak: Math.floor(rng() * 8),
    strategy: 'signal_based',
  };

  return { leaderboard, userRank };
}

// ── Route handler ───────────────────────────────────────────
export async function GET(): Promise<NextResponse<LeaderboardResponse | { error: string }>> {
  // Leaderboard is generated deterministically from day-of-year, so it
  // doesn't depend on the database. We still honor the project's import
  // convention and DB-resilience pattern so this route degrades the
  // same way every other trading route does.
  if (!db) {
    return NextResponse.json(buildLeaderboard());
  }
  try {
    return NextResponse.json(buildLeaderboard());
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('validating datasource')) {
      // Prisma validation error (e.g., wrong DB URL) — return the
      // deterministic leaderboard just like the !db path.
      return NextResponse.json(buildLeaderboard());
    }
    const msg = error instanceof Error ? error.message : 'Failed to build leaderboard';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
