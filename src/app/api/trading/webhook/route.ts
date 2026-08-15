import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';
import { CONTAINMENT_CODES, DEMO_PROVENANCE_HEADER } from '@/lib/trading-policy';

// ── CONTAINMENT: Webhook ingress is DISABLED during Phase 1 ──
// Complete webhook redesign is deferred to a later phase.
// This endpoint only accepts signals for storage (no auto-execution).

export async function POST(req: NextRequest) {
  // ── CONTAINMENT: Reject all webhook payloads during remediation ──
  // The complete webhook security model (per-user binding, HMAC enforcement,
  // replay protection, idempotency) will be implemented in a later phase.
  return NextResponse.json(
    {
      error: 'Webhook ingress is temporarily disabled during platform remediation.',
      code: CONTAINMENT_CODES.WEBHOOK_DISABLED,
      remediationPhase: 'containment',
      deferred: 'Webhook security redesign including per-user binding, mandatory HMAC, replay protection, and idempotency will be implemented in a future phase.',
    },
    { status: 503 },
  );
}
