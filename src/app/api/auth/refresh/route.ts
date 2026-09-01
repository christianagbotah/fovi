import { NextResponse } from 'next/server';

/**
 * Refresh-token sessions are intentionally unavailable until Fovi has a
 * server-side, revocable session model with rotation/reuse detection and
 * account-state revalidation. The previous stateless JWT-to-JWT refresh
 * path could mint credentials without checking whether the user still
 * exists or remains active.
 */
export async function POST() {
  return NextResponse.json(
    {
      error: 'Refresh sessions are not available.',
      code: 'REFRESH_SESSIONS_DISABLED',
      remediationPhase: 'session-hardening',
    },
    { status: 503 },
  );
}
