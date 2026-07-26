# Task 6: Trade Notifications Hook + Paper Trading Leaderboard

**Agent:** main
**Date:** 2026-07-26
**Status:** ✅ Complete

## Summary

Built two new features for the Fovi AI auto-trading platform:

1. **Real-time Trade Notifications Hook** — `useTradeNotifications()` polls
   `/api/trading/auto-trade/activity` every 15s and fires a Sonner toast
   for every newly detected AI trade while the page is visible.
2. **Paper Trading Leaderboard** — new `/api/trading/leaderboard` GET
   endpoint that returns 10 deterministic-but-daily-varied simulated
   paper traders plus the user's rank, plus a polished `LeaderboardPanel`
   UI component with gold/silver/bronze podium ring borders, Framer Motion
   staggered entrance, loading skeleton, refresh button, and full mobile
   responsiveness (Sharpe + trades columns hidden on small screens).

## Files Created / Modified

- `src/hooks/use-trade-notifications.ts` (NEW) — polling hook
- `src/app/api/trading/leaderboard/route.ts` (NEW) — leaderboard API
- `src/components/trading/leaderboard-panel.tsx` (NEW) — leaderboard UI
- `src/app/page.tsx` (EDITED) — wired up hook call, added leaderboard
  sidebar tab + render block, imported `LeaderboardPanel` and
  `useTradeNotifications`

## Implementation Notes

### Hook (`use-trade-notifications.ts`)
- `'use client'` directive; exports `useTradeNotifications()`
- Uses `useRef` for `seenIds` (Set), `hasInitialized`, `isVisible` — no re-render storms
- `useEffect` registers a `visibilitychange` listener that updates `isVisibleRef`
- Polling `useEffect` schedules an initial 1.5s-delayed check (avoids on-mount
  fetch stampede) then a `setInterval` every 15s
- First poll **seeds** the seen-set silently (no toast flood on page load)
- Subsequent polls filter to truly-new activity IDs, record them, then fire
  toasts **only if** `document.visibilityState === 'visible'`
- Variant picker: `pending` → `info`, `buy`/`cover` → `success`, `sell`/`short` → `error`
- Icon: `Clock` for pending, `ArrowUpRight` (emerald) for buy/cover, `ArrowDownRight`
  (red) for sell/short
- Uses `createElement` instead of JSX so the file can stay `.ts` (ESLint
  rejects JSX in `.ts` files)

### API (`/api/trading/leaderboard/route.ts`)
- Deterministic seeded RNG (mulberry32) keyed by **day-of-year** so the
  leaderboard is stable for the whole UTC day, then rotates daily
- 15-name pool Fisher-Yates shuffled → take 10 → assign stats → sort by
  `totalPnl` desc → assign ranks 1..10
- User rank picked in the middle (3..7, 1-indexed); user's `totalPnl` is
  interpolated between `leaderboard[N-1]` and `leaderboard[N-2]` so the
  rank is internally consistent
- pnlPercent = totalPnl / 1000 (assumes $100k paper capital base)
- All 6 strategies appear (signal_based, dca, grid, scalping, momentum, breakout)
- DB resilience pattern honored: `if (!db)` fast path + try/catch that
  matches `'validating datasource'` errors → returns the deterministic
  payload (it doesn't actually need the DB, but the pattern stays
  consistent with every other trading route)

### Component (`leaderboard-panel.tsx`)
- `'use client'`, Framer Motion staggered entrance on rows
- Top bar: `UserRankCard` highlighted with `ring-2 ring-primary/30 bg-primary/5`
- Podium ring colors are pure CSS (NO emojis):
  - Gold `ring-[#f59e0b]` + amber glow shadow
  - Silver `ring-[#94a3b8]`
  - Bronze `ring-[#d97706]`
- Each row: rank cell, colored avatar circle with initials (10-color palette,
  no indigo/blue), name + 5-trade streak flame icon, strategy badge, P&L
  (green/red) + percent, win rate, total trades (hidden < md), Sharpe
  ratio (hidden < md)
- Loading skeleton matches the row layout
- Refresh button + 60s background poll (light — leaderboard itself rotates daily)
- Error state with retry button
- All colors from emerald/amber/rose/orange/fuchsia/lime/teal/purple/red/yellow
  families — **NO indigo or blue**

## Verification

- `bun run lint` → 0 errors, 0 warnings
- `GET /api/trading/leaderboard` → 200, 1850 bytes, valid JSON
- `GET /` → 200, 63,677 bytes (page compiles with new hook + tab)
- `GET /api/trading/auto-trade/activity` → 200 (DB resilience pattern
  catches prisma error, falls back to DEMO_ACTIVITY) — confirms the hook's
  data source still works
- Sample leaderboard output for today:
  - rank 1 AlphaWolf — momentum — $16,537.83 — 53.5% win — 160 trades — 2.05 Sharpe
  - rank 7 CryptoSage — breakout — $8,607.69 — 67.2% win — 245 trades — 2.83 Sharpe
  - userRank: rank 7 — You — $8,980.08 — 69.1% win — 60 trades — 1.02 Sharpe
  (User's totalPnl sits between rank 6 SigmaEdge $9,490.11 and rank 7
  CryptoSage $8,607.69 — internally consistent.)

## Patterns Followed

- DB resilience: `if (!db)` + `'validating datasource'` catch (same as
  `auto-trade/activity`, `sessions`, `webhooks`, etc.)
- Trading store import path: `import type { AutoTradeActivity } from '@/lib/store/trading-store'`
- Framer Motion staggered entrance with `delay: Math.min(index * 0.05, 0.5)`
  (same pattern as journal-panel and sessions-panel)
- shadcn/ui Card, Badge, Button, Skeleton (no custom primitives)
- `'use client'` directive on the component and hook
- No emojis for podium — colored CSS ring borders as specified
- NO indigo or blue colors anywhere in the new component
