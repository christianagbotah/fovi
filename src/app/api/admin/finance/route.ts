import { NextRequest, NextResponse } from 'next/server';
import { db, isDbAvailable, hasModel, safeDbQuery, DEMO_USER_ID } from '@/lib/db';

// ============================================================
// GET /api/admin/finance — Admin financial dashboard
// Returns platform-wide financial metrics and per-user stats
// ============================================================
export async function GET(request: NextRequest) {
  // Verify admin role from header (middleware also enforces this)
  const userRole = request.headers.get('x-user-role');
  if (userRole !== 'admin') {
    return NextResponse.json({ error: 'Forbidden: admin access required' }, { status: 403 });
  }

  if (!isDbAvailable() || !db || !hasModel('user')) {
    return NextResponse.json({
      totalUsers: 0,
      activeTraders: 0,
      totalDeposits: 0,
      totalAdminLevyCollected: 0,
      totalRealizedPnl: 0,
      openPositions: 0,
      totalBotsRunning: 0,
      perUserStats: [],
      recentLevyTransactions: [],
      platformMetrics: { winRate: 0, avgTradePnl: 0, totalTrades: 0 },
    });
  }

  try {
    // Run all independent queries in parallel for speed
    const [
      totalUsersResult,
      activeTradersResult,
      accountAggregates,
      openPositionsResult,
      botsRunningResult,
      platformTradeStats,
      recentLevyData,
      perUserData,
    ] = await Promise.all([
      // 1. Total users (exclude demo)
      safeDbQuery(() =>
        db!.user.count({ where: { id: { not: DEMO_USER_ID } } })
      ),

      // 2. Active traders — users who have open positions OR running bots
      safeDbQuery(async () => {
        // Users with open positions
        const openPositionAccountIds = await db!.position
          .findMany({
            where: { status: 'open' },
            select: { accountId: true },
            distinct: ['accountId'],
          })
          .then((p) => p.map((pp) => pp.accountId));

        const accountUsersFromPositions = openPositionAccountIds.length > 0
          ? await db!.tradingAccount.findMany({
              where: { id: { in: openPositionAccountIds }, userId: { not: DEMO_USER_ID } },
              select: { userId: true },
              distinct: ['userId'],
            }).then((a) => a.map((aa) => aa.userId))
          : [];

        // Users with running bots
        const usersWithBots = await db!.bot
          .findMany({
            where: { status: 'running', userId: { not: DEMO_USER_ID } },
            select: { userId: true },
            distinct: ['userId'],
          })
          .then((b) => b.map((bb) => bb.userId));

        // Merge unique user IDs
        const uniqueIds = new Set([...accountUsersFromPositions, ...usersWithBots]);
        return uniqueIds.size;
      }),

      // 3. Account-level aggregates (deposits, levy, realized PnL)
      safeDbQuery(() =>
        db!.tradingAccount.groupBy({
          by: ['userId'],
          where: { userId: { not: DEMO_USER_ID } },
          _sum: {
            balance: true,
            linkedBalance: true,
            totalRealizedProfit: true,
            totalAdminLevyCollected: true,
          },
          _count: { id: true },
        })
      ),

      // 4. Total open positions
      safeDbQuery(async () => {
        const nonDemoAccounts = await db!.tradingAccount.findMany({
          where: { userId: { not: DEMO_USER_ID } },
          select: { id: true },
        });
        if (nonDemoAccounts.length === 0) return 0;
        return db!.position.count({
          where: {
            accountId: { in: nonDemoAccounts.map((a) => a.id) },
            status: 'open',
          },
        });
      }),

      // 5. Total bots running
      safeDbQuery(() =>
        db!.bot.count({
          where: { status: 'running', userId: { not: DEMO_USER_ID } },
        })
      ),

      // 6. Platform-wide trade metrics from Bot table
      safeDbQuery(() =>
        db!.bot.aggregate({
          where: { userId: { not: DEMO_USER_ID } },
          _sum: { totalTrades: true, winTrades: true, totalPnl: true },
        })
      ),

      // 7. Recent levy data from BotConfig (adminLevyCollected > 0)
      safeDbQuery(() =>
        db!.botConfig.findMany({
          where: {
            adminLevyCollected: { gt: 0 },
            userId: { not: DEMO_USER_ID },
          },
          select: {
            id: true,
            userId: true,
            adminLevyCollected: true,
            totalTrades: true,
            updatedAt: true,
          },
          orderBy: { updatedAt: 'desc' },
          take: 20,
        })
      ),

      // 8. Per-user stats
      safeDbQuery(async () => {
        const users = await db!.user.findMany({
          where: { id: { not: DEMO_USER_ID } },
          select: { id: true, email: true, name: true },
        });

        if (users.length === 0) return [];
        const userIds = users.map((u) => u.id);

        // Accounts grouped by user
        const accountsByUser = await db!.tradingAccount.groupBy({
          by: ['userId'],
          where: { userId: { in: userIds } },
          _sum: {
            balance: true,
            totalRealizedProfit: true,
            totalAdminLevyCollected: true,
          },
          _count: { id: true },
        });

        // Open positions per user
        const allAccounts = await db!.tradingAccount.findMany({
          where: { userId: { in: userIds } },
          select: { id: true, userId: true },
        });
        const accountIds = allAccounts.map((a) => a.id);
        const accountIdToUserId = new Map(allAccounts.map((a) => [a.id, a.userId]));

        let openPositionsByUser: Record<string, number> = {};
        if (accountIds.length > 0) {
          const openPositions = await db!.position.groupBy({
            by: ['accountId'],
            where: { accountId: { in: accountIds }, status: 'open' },
            _count: { id: true },
          });
          for (const op of openPositions) {
            const uid = accountIdToUserId.get(op.accountId);
            if (uid) {
              openPositionsByUser[uid] = (openPositionsByUser[uid] || 0) + op._count.id;
            }
          }
        }

        // Subscription plan per user
        const now = new Date();
        const activeSubs = await db!.subscription.findMany({
          where: { userId: { in: userIds }, status: 'active', expiresAt: { gt: now } },
          select: { userId: true, plan: true },
        });
        const subByUser = new Map(activeSubs.map((s) => [s.userId, s.plan]));

        // Build per-user stats
        const accountMap = new Map(accountsByUser.map((a) => [a.userId, a]));

        return users.map((u) => {
          const acc = accountMap.get(u.id);
          const subPlan = subByUser.get(u.id);
          return {
            userId: u.id,
            email: u.email,
            name: u.name,
            balance: acc?._sum.balance ?? 0,
            realizedPnl: acc?._sum.totalRealizedProfit ?? 0,
            adminLevy: acc?._sum.totalAdminLevyCollected ?? 0,
            openPositions: openPositionsByUser[u.id] || 0,
            subscriptionPlan: subPlan || 'Free',
          };
        });
      }),
    ]);

    // Build recent levy transactions with user info
    let recentLevyTransactions: Array<Record<string, unknown>> = [];
    if (recentLevyData && recentLevyData.length > 0) {
      const levyUserIds = [...new Set(recentLevyData.map((l) => l.userId))];
      const levyUsers = await safeDbQuery(() =>
        db!.user.findMany({
          where: { id: { in: levyUserIds } },
          select: { id: true, email: true, name: true },
        })
      );
      const levyUserMap = new Map(levyUsers?.map((u) => [u.id, u]) ?? []);

      recentLevyTransactions = recentLevyData.map((l) => {
        const u = levyUserMap.get(l.userId);
        return {
          id: l.id,
          userId: l.userId,
          email: u?.email ?? null,
          name: u?.name ?? null,
          amount: l.adminLevyCollected,
          totalTrades: l.totalTrades,
          type: 'admin_levy',
          timestamp: l.updatedAt,
        };
      });
    }

    // Compute platform metrics
    const totalTrades = platformTradeStats?._sum.totalTrades ?? 0;
    const winTrades = platformTradeStats?._sum.winTrades ?? 0;
    const totalPnl = platformTradeStats?._sum.totalPnl ?? 0;
    const winRate = totalTrades > 0 ? winTrades / totalTrades : 0;
    const avgTradePnl = totalTrades > 0 ? totalPnl / totalTrades : 0;

    // Compute top-level aggregates from account data
    const totalDeposits = accountAggregates?.reduce(
      (sum, a) => sum + (a._sum.linkedBalance ?? 0),
      0,
    ) ?? 0;
    const totalAdminLevyCollected = accountAggregates?.reduce(
      (sum, a) => sum + (a._sum.totalAdminLevyCollected ?? 0),
      0,
    ) ?? 0;
    const totalRealizedPnl = accountAggregates?.reduce(
      (sum, a) => sum + (a._sum.totalRealizedProfit ?? 0),
      0,
    ) ?? 0;

    return NextResponse.json({
      totalUsers: totalUsersResult ?? 0,
      activeTraders: activeTradersResult ?? 0,
      totalDeposits,
      totalAdminLevyCollected,
      totalRealizedPnl,
      openPositions: openPositionsResult ?? 0,
      totalBotsRunning: botsRunningResult ?? 0,
      perUserStats: perUserData ?? [],
      recentLevyTransactions,
      platformMetrics: {
        winRate: Math.round(winRate * 100) / 100,
        avgTradePnl: Math.round(avgTradePnl * 100) / 100,
        totalTrades,
      },
    });
  } catch (err) {
    console.error('[Admin Finance] Failed to fetch dashboard data:', err);
    return NextResponse.json(
      { error: 'Failed to fetch financial dashboard data.' },
      { status: 500 },
    );
  }
}
