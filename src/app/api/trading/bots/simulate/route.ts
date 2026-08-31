import { NextResponse } from 'next/server';

// The former route generated random wins/losses and random P&L. That output
// looked like strategy performance but was not derived from market history.
// Phase 2D will provide deterministic verified backtesting instead.
export async function POST() {
  return NextResponse.json(
    {
      error: 'Bot performance simulation is unavailable until the verified backtest engine is complete.',
      code: 'SIMULATION_UNAVAILABLE_PENDING_REAL_BACKTEST',
      dataPolicy: 'verified-only',
      trades: [],
      summary: {
        totalPnl: null,
        winRate: null,
        avgRiskReward: null,
        signalsFound: null,
        positionSize: null,
      },
    },
    { status: 503, headers: { 'x-data-policy': 'verified-only' } },
  );
}
