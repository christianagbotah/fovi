// ============================================================
// subscription-guard.ts — Enforce subscription plan limits
// ============================================================

import { db, hasModel, safeDbQuery, DEMO_USER_ID } from '@/lib/db';

export type LimitType = 'maxBots' | 'maxAccounts' | 'maxPositions';

export interface SubscriptionLimitCheck {
  allowed: boolean;
  current: number;
  limit: number;
  planName?: string;
}

/** Default free-tier limits when user has no active subscription */
const FREE_TIER_LIMITS: Record<LimitType, number> = {
  maxBots: 1,
  maxAccounts: 1,
  maxPositions: 3,
};

/** Human-readable messages per limit type */
const LIMIT_MESSAGES: Record<LimitType, string> = {
  maxBots: 'Bot limit reached. Upgrade your plan to create more bots.',
  maxAccounts: 'Account limit reached. Upgrade your plan to link more broker accounts.',
  maxPositions: 'Position limit reached. Upgrade your plan to open more positions.',
};

export function getLimitMessage(type: LimitType): string {
  return LIMIT_MESSAGES[type];
}

/**
 * Check if a user's active subscription permits an action.
 *
 * 1. Look up the user's active (non-expired, status='active') subscription.
 * 2. If none, use default free tier limits.
 * 3. Count current usage from DB.
 * 4. Return { allowed, current, limit, planName }.
 */
export async function checkSubscriptionLimit(
  userId: string,
  limitType: LimitType,
): Promise<SubscriptionLimitCheck> {
  // If DB is not available, always allow (demo mode)
  if (!db || !isDbAvailable()) {
    return { allowed: true, current: 0, limit: Infinity, planName: 'Demo' };
  }

  // Demo user always gets free rein in demo mode
  if (userId === DEMO_USER_ID) {
    return { allowed: true, current: 0, limit: Infinity, planName: 'Demo' };
  }

  // 1. Find user's active subscription
  const now = new Date();
  const activeSub = await safeDbQuery(() =>
    db!.subscription.findFirst({
      where: {
        userId,
        status: 'active',
        expiresAt: { gt: now },
      },
      include: {
        user: false, // don't need user data
      },
    })
  );

  let limitValue: number;
  let planName: string | undefined;

  if (activeSub) {
    // 2a. Look up the SubscriptionPlan for limits
    const plan = await safeDbQuery(() =>
      db!.subscriptionPlan.findFirst({
        where: { name: activeSub!.plan },
      })
    );

    if (plan) {
      limitValue = plan[limitType];
      planName = plan.displayName || plan.name;
    } else {
      // Plan row missing — fall back to free tier
      limitValue = FREE_TIER_LIMITS[limitType];
      planName = activeSub.plan;
    }
  } else {
    // 2b. No active subscription → free tier
    limitValue = FREE_TIER_LIMITS[limitType];
    planName = 'Free';
  }

  // 3. Count current usage based on limitType
  let current = 0;

  switch (limitType) {
    case 'maxBots': {
      const count = await safeDbQuery(() =>
        db!.bot.count({ where: { userId } })
      );
      current = count ?? 0;
      break;
    }
    case 'maxAccounts': {
      const count = await safeDbQuery(() =>
        db!.tradingAccount.count({ where: { userId } })
      );
      current = count ?? 0;
      break;
    }
    case 'maxPositions': {
      // Count open positions across all user accounts
      const count = await safeDbQuery(async () => {
        const accounts = await db!.tradingAccount.findMany({
          where: { userId },
          select: { id: true },
        });
        const accountIds = accounts.map((a) => a.id);
        if (accountIds.length === 0) return 0;
        return db!.position.count({
          where: {
            accountId: { in: accountIds },
            status: 'open',
          },
        });
      });
      current = count ?? 0;
      break;
    }
  }

  // 4. Determine if allowed
  const allowed = current < limitValue;

  return { allowed, current, limit: limitValue, planName };
}

function isDbAvailable(): boolean {
  return db !== null;
}
