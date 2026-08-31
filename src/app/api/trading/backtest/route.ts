import { NextRequest, NextResponse } from 'next/server';
import { getUserId, authRequiredResponse } from '@/lib/get-user-id';

// Phase 2B deliberately disables the old random/demo backtester.
// Phase 2D will add versioned historical datasets, costs/slippage and
// walk-forward validation. Until then, unknown history is returned as unknown.
export async function POST(req: NextRequest) {
  try {
    await getUserId(req);
  } catch {
    return authRequiredResponse();
  }

  await req.json().catch(() => ({}));
  return NextResponse.json(
    {
      error: 'Verified historical backtest data is not available in Phase 2B.',
      code: 'HISTORICAL_DATA_UNAVAILABLE',
      dataPolicy: 'verified-only',
      remediationPhase: 'phase-2d',
    },
    { status: 503, headers: { 'x-data-policy': 'verified-only' } },
  );
}
