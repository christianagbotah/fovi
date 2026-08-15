// ============================================================
// POST /api/trading/engine/report
// Phase 1 CR1: P0-4 — enforceInternalAuth, remove no-DB success fallback.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';
import { enforceInternalAuth, logSecurityEvent } from '@/lib/trading-policy';

interface ReportPayload {
  botId: string;
  tradeType: 'opened' | 'closed' | 'error';
  pnl?: number;
  isWin?: boolean;
  reason?: string;
  symbol?: string;
  side?: string;
  qty?: number;
  price?: number;
}

export async function POST(req: NextRequest) {
  // ── P0-4: Require internal service auth ──
  const authError = enforceInternalAuth(req);
  if (authError) return authError;

  const body: ReportPayload = await req.json().catch(() => ({}));
  const { botId, tradeType, pnl, isWin, reason, symbol, side, qty, price } = body;

  if (!botId) {
    return NextResponse.json({ error: 'botId is required' }, { status: 400 });
  }

  // P0-4: No DB → return 503, NOT success with persisted:false
  if (!db || !hasModel('bot')) {
    return NextResponse.json(
      {
        error: 'Engine reporting is temporarily unavailable.',
        code: 'SERVICE_UNAVAILABLE',
        remediationPhase: 'containment',
      },
      { status: 503 },
    );
  }

  try {
    const updateData: Record<string, unknown> = {
      lastTradeAt: new Date(),
      updatedAt: new Date(),
    };

    if (tradeType === 'opened') {
      updateData.totalTrades = { increment: 1 };
    } else if (tradeType === 'closed') {
      updateData.totalTrades = { increment: 1 };
      if (isWin) updateData.winTrades = { increment: 1 };
      else updateData.lossTrades = { increment: 1 };
      if (pnl !== undefined) updateData.totalPnl = { increment: pnl };
    } else if (tradeType === 'error' && reason) {
      updateData.lastError = reason;
    }

    const updated = await db.bot.update({
      where: { id: botId },
      data: updateData,
    });

    return NextResponse.json({ success: true, persisted: true, botId: updated.id });
  } catch (error) {
    logSecurityEvent({
      eventType: 'ENGINE_REPORT_ERROR',
      route: '/api/trading/engine/report',
      reason: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'Failed to persist engine report.' },
      { status: 500 },
    );
  }
}
