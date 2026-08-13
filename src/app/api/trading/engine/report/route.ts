import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';

// ============================================================
// POST /api/trading/engine/report
// ============================================================
// Called by the auto-trade-engine to report trade results and update bot stats.
// Body: { botId, tradeType: 'opened'|'closed', pnl?, isWin?, reason? }
// ============================================================

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
  const body: ReportPayload = await req.json().catch(() => ({}));
  const { botId, tradeType, pnl, isWin, reason, symbol, side, qty, price } = body;

  if (!botId) {
    return NextResponse.json({ error: 'botId is required' }, { status: 400 });
  }

  // No DB — accept report but don't persist
  if (!db || !hasModel('bot')) {
    return NextResponse.json({ success: true, persisted: false });
  }

  try {
    // Update bot stats
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
    console.warn('[engine/report POST] error:', error);
    return NextResponse.json({ success: true, persisted: false });
  }
}
