// ============================================================
// GET /api/trading/engine/bots
// Phase 1 CR1: P0-4 — enforceInternalAuth, remove demo bot fallback.
// No DEMO_USER_ID / ensureDemoUser.
// ============================================================

import { NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';
import { enforceInternalAuth, logSecurityEvent } from '@/lib/trading-policy';

export async function GET(req: Request) {
  // ── P0-4: Require internal service auth ──
  const authError = enforceInternalAuth(req);
  if (authError) return authError;

  if (!db || !hasModel('bot')) {
    // P0-4: Return 503, NOT demo bots
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
            balance: true,
            isActive: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Filter to only bots with active accounts
    const active = bots.filter((b) => b.account?.isActive !== false);

    return NextResponse.json(active);
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
