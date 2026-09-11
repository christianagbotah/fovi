import { NextRequest, NextResponse } from 'next/server';
import { db, isDbAvailable, hasModel, DEMO_USER_ID } from '@/lib/db';

// ============================================================
// GET /api/admin/finance — Admin financial dashboard
// Returns platform-wide financial metrics and per-user stats.
// Every required query is fail-closed: an operational/storage failure must
// never be represented as legitimate zero-valued financial state.
// ============================================================
export async function GET(request: NextRequest) {
  // Verify admin role from the trusted request boundary.
  const userRole = request.headers.get('x-user-role');
  if (userRole !== 'admin') {
    return NextResponse.json({ error: 'Forbidden: admin access required' }, { status: 403 });
  }

  const requiredModels = [
    'user',
    'tradingAccount',
    'position',
    'bot',
    'botConfig',
    'subscription',
  ];

  if (!isDbAvailable() || !db || requiredModels.some((model) => !hasModel(model))) {
    return NextResponse.json(
      { error: 'Financial dashboard storage is unavailable.' },
      { status: 503 },
    );
  }

  try {
    // Run all independent queries in parallel. These deliberately use direct
    // Prisma calls rather than safeDbQuery: if any required metric cannot be
    // established, the whole financial dashboard is unqualified.
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
      db.user.count({ where: { id: { not: DEMO_USER_ID } } }),

      // 2. Active traders — users who have open positions OR running bots
      (async () => {
        const openPositionAccountIds = await db.position
          .findMany({
            where: { status: 'open' },
            select: { accountId: true },
            distinct: ['accountId'],
          })
          .then((positions) => positions.map((position) => position.accountId));

        const accountUsersFromPositions = openPositionAccountIds.length > 0
          ? await db.tradingAccount.findMany({
              where: {
                id: { in: openPositionAccountIds },
                userId: { not: DEMO_USER_ID },
              },
              select: { userId: true },
              distinct: ['userId'],
            }).then((accounts) => accounts.map((account) => account.userId))
          : [];

        const usersWithBots = await db.bot
          .findMany({
            where: { status: 'running', userId: { not: DEMO_USER_ID } },
            select: { userId: true },
            distinct: ['userId'],
          })
          .then((bots) => bots.map((bot) => bot.userId));

        return new Set([...accountUsersFromPositions, ...usersWithBots]).size;
      })(),

      // 3. Account-level aggregates (deposits, levy, realized PnL)
      db.tradingAccount.groupBy({
        by: ['userId'],
        where: { userId: { not: DEMO_USER_ID } },
        _sum: {
          balance: true,
          linkedBalance: true,
          totalRealizedProfit: true,
          totalAdminLevyCollected: true,
        },
        _count: { id: true },
      }),

      // 4. Total open positions for non-demo accounts
      (async () => {
        const nonDemoAccounts = await db.tradingAccount.findMany({
          where: { userId: { not: DEMO_USER_ID } },
          select: { id: true },
        });
        if (nonDemoAccounts.length === 0) return 0;
        return db.position.count({
          where: {
            accountId: { in: nonDemoAccounts.map((account) => account.id) },
            status: 'open',
          },
        });
      })(),

      // 5. Total bots running
      db.bot.count({
        where: { status: 'running', userId: { not: DEMO_USER_ID } },
      }),

      // 6. Platform-wide trade metrics from Bot table
      db.bot.aggregate({
        where: { userId: { not: DEMO_USER_ID } },
        _sum: { totalTrades: true, winTrades: true, totalPnl: true },
      }),

      // 7. Recent levy data from BotConfig (adminLevyCollected > 0)
      db.botConfig.findMany({
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
      }),

      // 8. Per-user stats
      (async () => {
        const users = await db.user.findMany({
          where: { id: { not: DEMO_USER_ID } },
          select: { id: true, email: true, name: true },
        });

        if (users.length === 0) return [];
        const userIds = users.map((user) => user.id);

        const accountsByUser = await db.tradingAccount.groupBy({
          by: ['userId'],
          where: { userId: { in: userIds } },
          _sum: {
            balance: true,
            totalRealizedProfit: true,
            totalAdminLevyCollected: true,
          },
          _count: { id: true },
        });

        const allAccounts = await db.tradingAccount.findMany({
          where: { userId: { in: userIds } },
          select: { id: true, userId: true },
        });
        const accountIds = allAccounts.map((account) => account.id);
        const accountIdToUserId = new Map(
          allAccounts.map((account) => [account.id, account.userId]),
        );

        const openPositionsByUser: Record<string, number> = {};
        if (accountIds.length > 0) {
          const openPositions = await db.position.groupBy({
            by: ['accountId'],
            where: { accountId: { in: accountIds }, status: 'open' },
            _count: { id: true },
          });
          for (const openPosition of openPositions) {
            const userId = accountIdToUserId.get(openPosition.accountId);
            if (userId) {
              openPositionsByUser[userId] =
                (openPositionsByUser[userId] || 0) + openPosition._count.id;
            }
          }
        }

        const now = new Date();
        const activeSubscriptions = await db.subscription.findMany({
          where: {
            userId: { in: userIds },
            status: 'active',
            expiresAt: { gt: now },
          },
          select: { userId: true, plan: true },
        });
        const subscriptionByUser = new Map(
          activeSubscriptions.map((subscription) => [subscription.userId, subscription.plan]),
        );
        const accountMap = new Map(accountsByUser.map((account) => [account.userId, account]));

        return users.map((user) => {
          const account = accountMap.get(user.id);
          return {
            userId: user.id,
            email: user.email,
            name: user.name,
            balance: account?._sum.balance ?? 0,
            realizedPnl: account?._sum.totalRealizedProfit ?? 0,
            adminLevy: account?._sum.totalAdminLevyCollected ?? 0,
            openPositions: openPositionsByUser[user.id] || 0,
            subscriptionPlan: subscriptionByUser.get(user.id) || 'Free',
          };
        });
      })(),
    ]);

    let recentLevyTransactions: Array<Record<string, unknown>> = [];
    if (recentLevyData.length > 0) {
      const levyUserIds = [...new Set(recentLevyData.map((levy) => levy.userId))];
      const levyUsers = await db.user.findMany({
        where: { id: { in: levyUserIds } },
        select: { id: true, email: true, name: true },
      });
      const levyUserMap = new Map(levyUsers.map((user) => [user.id, user]));

      recentLevyTransactions = recentLevyData.map((levy) => {
        const user = levyUserMap.get(levy.userId);
        return {
          id: levy.id,
          userId: levy.userId,
          email: user?.email ?? null,
          name: user?.name ?? null,
          amount: levy.adminLevyCollected,
          totalTrades: levy.totalTrades,
          type: 'admin_levy',
          timestamp: levy.updatedAt,
        };
      });
    }

    const totalTrades = platformTradeStats._sum.totalTrades ?? 0;
    const winTrades = platformTradeStats._sum.winTrades ?? 0;
    const totalPnl = platformTradeStats._sum.totalPnl ?? 0;
    const winRate = totalTrades > 0 ? winTrades / totalTrades : 0;
    const avgTradePnl = totalTrades > 0 ? totalPnl / totalTrades : 0;

    const totalDeposits = accountAggregates.reduce(
      (sum, account) => sum + (account._sum.linkedBalance ?? 0),
      0,
    );
    const totalAdminLevyCollected = accountAggregates.reduce(
      (sum, account) => sum + (account._sum.totalAdminLevyCollected ?? 0),
      0,
    );
    const totalRealizedPnl = accountAggregates.reduce(
      (sum, account) => sum + (account._sum.totalRealizedProfit ?? 0),
      0,
    );

    return NextResponse.json({
      totalUsers: totalUsersResult,
      activeTraders: activeTradersResult,
      totalDeposits,
      totalAdminLevyCollected,
      totalRealizedPnl,
      openPositions: openPositionsResult,
      totalBotsRunning: botsRunningResult,
      perUserStats: perUserData,
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
      { error: 'Financial dashboard data is unavailable.' },
      { status: 503 },
    );
  }
}