// ============================================================
// POST /api/trading/engine/report
// Phase 2E: activity/error reporting only; durable close owns trade stats.
// ------------------------------------------------------------
// A completed trade is counted exactly once by /api/trading/engine/close in
// the same transaction that closes the Position. Open reports are therefore
// informational and closed reports are rejected to prevent double counting.
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
  const authError = enforceInternalAuth(req);
  if (authError) return authError;

  const body: ReportPayload = await req.json().catch(() => ({}));
  const { botId, tradeType, reason } = body;

  if (!botId) {
    return NextResponse.json({ error: 'botId is required' }, { status: 400 });
  }

  if (tradeType === 'closed') {
    return NextResponse.json(
      {
        error: 'Closed-trade statistics are persisted atomically by the Phase 2E close adapter.',
        code: 'DURABLE_CLOSE_REQUIRED',
        remediationPhase: 'phase-2e-position-close-restart-reconciliation',
      },
      { status: 409 },
    );
  }

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
    const updateData: Record<string, unknown> = { updatedAt: new Date() };

    if (tradeType === 'opened') {
      // Informational only. totalTrades is the count of completed round trips
      // and is incremented by the atomic close transaction, never on open.
      updateData.lastTradeAt = new Date();
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
