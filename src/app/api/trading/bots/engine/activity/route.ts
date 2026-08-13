import { NextResponse } from 'next/server';

// ============================================================
// GET /api/trading/bots/engine/activity
// ============================================================
// Proxies the request to the auto-trade-engine's /activity endpoint.
// ============================================================

const ENGINE_URL = 'http://localhost:3012/activity';

export async function GET() {
  try {
    const res = await fetch(ENGINE_URL, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return NextResponse.json([], { status: 502 });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json([], { status: 502 });
  }
}
