import { NextRequest, NextResponse } from 'next/server';
import { getUserIdSync, authRequiredResponse } from '@/lib/get-user-id';

// Phase 2B removes fabricated analytics. Verified P&L must eventually come
// from broker-confirmed fills/reconciliation, not random/demo formulas.
export async function GET(req: NextRequest) {
  try {
    getUserIdSync(req);
  } catch {
    return authRequiredResponse();
  }

  return NextResponse.json(
    {
      error: 'Verified execution-derived P&L is not available yet.',
      code: 'VERIFIED_PNL_UNAVAILABLE',
      dataPolicy: 'verified-only',
      daily: [],
      weekly: [],
      monthly: [],
      stats: {
        totalPnl: null,
        totalPnlPercent: null,
        sharpeRatio: null,
        sortinoRatio: null,
        maxDrawdown: null,
        profitFactor: null,
        winRate: null,
        avgWin: null,
        avgLoss: null,
        bestTrade: null,
        worstTrade: null,
        totalTrades: null,
        winTrades: null,
        lossTrades: null,
      },
    },
    { status: 503, headers: { 'x-data-policy': 'verified-only' } },
  );
}
