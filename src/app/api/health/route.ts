import { NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';

export const dynamic = 'force-dynamic';

type PublicHealthCheck = { ok: boolean };

export async function GET() {
  const checks: Record<string, PublicHealthCheck> = {};

  // Keep the public probe limited to boolean readiness. Do not expose raw
  // database errors, query latency, process uptime, package versions, or other
  // operational details that can fingerprint the deployment.
  if (db && hasModel('user')) {
    try {
      await db.$queryRaw`SELECT 1`;
      checks.database = { ok: true };
    } catch {
      checks.database = { ok: false };
    }
  } else {
    checks.database = { ok: false };
  }

  const allOk = Object.values(checks).every(check => check.ok);

  return NextResponse.json(
    {
      status: allOk ? 'healthy' : 'degraded',
      checks,
    },
    {
      status: allOk ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
