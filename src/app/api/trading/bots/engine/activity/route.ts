// ============================================================
// GET /api/trading/bots/engine/activity
// Phase 1 CR1: Keep enforceInternalAuth, add secret header to engine fetch.
// ============================================================

import { NextResponse } from 'next/server';
import { enforceInternalAuth, INTERNAL_SERVICE_SECRET } from '@/lib/trading-policy';

const ENGINE_URL = 'http://localhost:3012/activity';

export async function GET(req: Request) {
  // ── CONTAINMENT: Require internal service auth ──
  const authError = enforceInternalAuth(req);
  if (authError) return authError;

  try {
    const res = await fetch(ENGINE_URL, {
      headers: {
        'X-Internal-Service-Secret': INTERNAL_SERVICE_SECRET,
      },
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
