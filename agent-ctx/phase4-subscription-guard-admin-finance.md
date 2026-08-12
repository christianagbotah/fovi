---
Task ID: Phase 4
Agent: fullstack-developer
Task: Subscription limit enforcement + Admin financial dashboard API

Work Log:
- Created `src/lib/subscription-guard.ts`
  - `checkSubscriptionLimit(userId, limitType)` — checks active subscription, counts current usage, returns `{ allowed, current, limit, planName }`
  - Free tier defaults: maxBots: 1, maxAccounts: 1, maxPositions: 3
  - Looks up SubscriptionPlan for active subscriptions, falls back to free tier if none
  - Demo user (DEMO_USER_ID) always allowed (demo mode)
  - DB unavailable → always allowed (graceful degradation)
  - `getLimitMessage(type)` for human-readable 403 error messages
- Enforced subscription limits in 3 API routes:
  - `POST /api/trading/bots` — checks `maxBots` after auth, before DB create, returns 403 with `{ error, current, limit }`
  - `POST /api/trading/accounts` — checks `maxAccounts` in both demo-broker and real-broker paths
  - `PUT /api/trading/auto-trade` — checks `maxBots` only when `enabled === true` or `status === 'running'`
- Created `src/app/api/admin/finance/route.ts`
  - `GET /api/admin/finance` — admin-only (verifies X-User-Role header)
  - Returns: totalUsers, activeTraders, totalDeposits, totalAdminLevyCollected, totalRealizedPnl, openPositions, totalBotsRunning, perUserStats[], recentLevyTransactions[], platformMetrics
  - Uses Prisma aggregation queries (groupBy, aggregate, count) for efficiency
  - 8 parallel queries via Promise.all for fast response
  - Excludes demo user from all metrics
  - Graceful empty response when DB unavailable

Stage Summary:
- Subscription plan limits are now enforced at the API level for bot creation, account linking, and auto-trade enablement
- Admin financial dashboard API provides platform-wide financial overview with per-user breakdowns
- All changes gracefully degrade when DB is unavailable (demo mode)
