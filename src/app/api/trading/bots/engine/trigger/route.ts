import { NextResponse } from 'next/server';

// ============================================================
// POST /api/trading/bots/engine/trigger
// ============================================================
// Proxies the request to the auto-trade-engine's /cycle endpoint.
// ============================================================

const ENGINE_URL = 'http://localhost:3012/cycle';

export async function POST() {
  try {
    const res = await fetch(ENGINE_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: `Engine returned ${res.status}` }, { status: 502 });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Engine unreachable' },
      { status: 502 },
    );
  }
}
