import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel, isDbAvailable, safeDbQuery } from '@/lib/db';

// GET: return the authenticated user's active subscription with plan details
export async function GET(request: NextRequest) {
  try {
    const userId = request.headers.get('X-User-Id');
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    }

    if (!isDbAvailable() || !db || !hasModel('subscription') || !hasModel('subscriptionPlan')) {
      return NextResponse.json({ subscription: null });
    }

    const subscription = await safeDbQuery(() =>
      db!.subscription.findFirst({
        where: {
          userId,
          status: 'active',
          expiresAt: { gt: new Date() },
        },
        include: {
          user: {
            select: { id: true, email: true, name: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      })
    );

    if (!subscription) {
      return NextResponse.json({ subscription: null });
    }

    // Enrich with plan details
    const plan = await safeDbQuery(() =>
      db!.subscriptionPlan.findUnique({
        where: { name: subscription!.plan },
      })
    );

    return NextResponse.json({
      subscription: {
        ...subscription,
        planDetails: plan
          ? {
              ...plan,
              features: JSON.parse(plan.features),
            }
          : null,
      },
    });
  } catch (err) {
    console.error('[Subscription] Failed to fetch current subscription:', err);
    return NextResponse.json({ error: 'Failed to fetch subscription.' }, { status: 500 });
  }
}
