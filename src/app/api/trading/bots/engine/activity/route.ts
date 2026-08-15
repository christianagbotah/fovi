import { NextResponse } from 'next/server';
import { enforceInternalAuth } from '@/lib/trading-policy';

const ENGINE_URL = 'http://localhost:3012/activity';

export async function GET(req: Request) {
  // ── CONTAINMENT: Require internal service auth ──
  const authError = enforceInternalAuth(req);
  if (authError) return authError;

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
