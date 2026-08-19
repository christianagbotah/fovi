// ============================================================
// GET /api/trading/engine/bots
// CR4.3A R7 Task 4: Replace isExplicitlyDemo with canonical
//   evaluateEngineAccountEligibility. Add credential fields
//   to Prisma select for verification, strip before response.
// ============================================================

import { NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';
import { enforceInternalAuth, logSecurityEvent } from '@/lib/trading-policy';
import { evaluateEngineAccountEligibility } from '@/lib/engine-eligibility';

export async function GET(req: Request) {
  // ── Require internal service auth ──
  const authError = enforceInternalAuth(req);
  if (authError) return authError;

  if (!db || !hasModel('bot')) {
    return NextResponse.json(
      {
        error: 'Bot data is temporarily unavailable.',
        code: 'SERVICE_UNAVAILABLE',
        remediationPhase: 'containment',
      },
      { status: 503 },
    );
  }

  try {
    // Fetch all running+enabled bots with their account info
    // Include credential fields for eligibility verification
    const bots = await db.bot.findMany({
      where: {
        enabled: true,
        status: 'running',
      },
      include: {
        account: {
          select: {
            id: true,
            broker: true,
            accountType: true,
            isDemo: true,
            balance: true,
            isActive: true,
            apiKey: true,
            apiSecret: true,
            passphrase: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Filter using canonical eligibility check
    const active = bots.filter((b) => {
      if (!b.account) return false;
      if (b.account.isActive !== true) return false;
      const result = evaluateEngineAccountEligibility({
        broker: b.account.broker,
        accountType: b.account.accountType,
        isDemo: b.account.isDemo,
        isActive: b.account.isActive,
        apiKey: b.account.apiKey,
        apiSecret: b.account.apiSecret,
        passphrase: b.account.passphrase,
      });
      return result.eligible;
    });

    // Strip credential fields from response — map to safe DTOs
    const safe = active.map((b) => ({
      ...b,
      account: b.account ? {
        id: b.account.id,
        broker: b.account.broker,
        accountType: b.account.accountType,
        isDemo: b.account.isDemo,
        balance: b.account.balance,
        isActive: b.account.isActive,
      } : null,
    }));

    return NextResponse.json(safe);
  } catch (error) {
    logSecurityEvent({
      eventType: 'ENGINE_BOTS_ERROR',
      route: '/api/trading/engine/bots',
      reason: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'Failed to fetch bots.' },
      { status: 500 },
    );
  }
}
