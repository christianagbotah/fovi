import { NextResponse } from 'next/server';
import { CONTAINMENT_CODES } from '@/lib/trading-policy';

export async function POST() {
  return NextResponse.json(
    {
      error: 'Webhook ingress is temporarily disabled during platform remediation.',
      code: CONTAINMENT_CODES.WEBHOOK_DISABLED,
      remediationPhase: 'containment',
      deferred: 'Webhook security redesign.',
    },
    { status: 503 },
  );
}
