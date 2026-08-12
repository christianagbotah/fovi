import { NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const start = Date.now();
  const checks: Record<string, { ok: boolean; latencyMs: number; detail?: string }> = {};

  // DB check
  if (db && hasModel('user')) {
    try {
      const t0 = Date.now();
      await db.$queryRaw`SELECT 1`;
      checks.database = { ok: true, latencyMs: Date.now() - t0 };
    } catch (err: any) {
      checks.database = { ok: false, latencyMs: Date.now() - start, detail: err.message?.slice(0, 100) };
    }
  } else {
    checks.database = { ok: false, latencyMs: 0, detail: 'DB not connected (demo mode)' };
  }

  const allOk = Object.values(checks).every(c => c.ok);

  return NextResponse.json({
    status: allOk ? 'healthy' : 'degraded',
    uptime: process.uptime(),
    version: process.env.npm_package_version || '1.0.0',
    checks,
    timestamp: new Date().toISOString(),
  }, {
    status: allOk ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}
