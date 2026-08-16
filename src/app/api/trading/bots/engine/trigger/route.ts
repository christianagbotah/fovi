// ============================================================
// POST /api/trading/bots/engine/trigger
// Phase 1 CR1: Keep enforceInternalAuth, add secret header to engine fetch.
// ============================================================

import { NextResponse } from 'next/server';
import { enforceInternalAuth, INTERNAL_SERVICE_SECRET } from '@/lib/trading-policy';

const ENGINE_URL = 'http://localhost:3012/cycle';

export async function POST(req: Request) {
  // ── CONTAINMENT: Require internal service auth ──
  const authError = enforceInternalAuth(req);
  if (authError) return authError;

  try {
    const res = await fetch(ENGINE_URL, {
      method: 'POST',
      headers: {
        'X-Internal-Service-Secret': INTERNAL_SERVICE_SECRET,
      },
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
