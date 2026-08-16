import { NextResponse } from 'next/server';

// ============================================================
// GET /api/trading/bots/engine/status
// ============================================================
// Proxies the request to the auto-trade-engine's /health endpoint.
// Runs server-side so it can reach localhost:3012 from the host.
// ============================================================

const ENGINE_URL = 'http://localhost:3012/health';

export async function GET() {
  try {
    const res = await fetch(ENGINE_URL, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return NextResponse.json({ status: 'error', error: `Engine returned ${res.status}` }, { status: 502 });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { status: 'offline', error: err instanceof Error ? err.message : 'Engine unreachable' },
      { status: 502 },
    );
  }
}
