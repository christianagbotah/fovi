// ============================================================
// Fovi Balance/Position Sync Service — Thin Startup Wrapper
// Phase 1 CR4:
//   Pure logic lives in core.ts. This file is only startup glue:
//   DB connection, Bun.serve, env vars, signal handlers.
//   /sync unconditionally returns 403 during Phase 1.
// ============================================================

import postgres from 'postgres';
import {
  checkInternalAuth,
  authErrorResponse,
  getActiveAccounts,
  runSyncCycle,
  type SyncResult,
} from './core';

const PORT = 3013;
const SYNC_INTERVAL_MS = 5 * 60 * 1000;
const NEXTJS_BASE = 'http://localhost:3002';
const INTERNAL_SERVICE_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';

function envBool(name: string): boolean {
  const raw = process.env[name];
  if (!raw) return false;
  const lower = raw.trim().toLowerCase();
  return lower === 'true' || lower === '1' || lower === 'yes';
}
const BALANCE_SYNC_ENABLED = envBool('BALANCE_SYNC_ENABLED');

// ── DB connection (only startup side effect) ──
const databaseUrl = process.env.DATABASE_URL || '';
let sql: ReturnType<typeof postgres> | null = null;
let dbReady = false;

if (databaseUrl.startsWith('postgresql://') || databaseUrl.startsWith('postgres://')) {
  sql = postgres(databaseUrl);
  dbReady = true;
} else {
  console.warn('[BalanceSync] DATABASE_URL is not PostgreSQL — sync cycles will be skipped.');
}

// ── Thin Bun.serve — no timers, no periodic sync ──
const server = Bun.serve({
  port: PORT,
  hostname: '127.0.0.1',
  fetch(req: Request): Response {
    const url = new URL(req.url);

    if (url.pathname === '/health' && req.method === 'GET') {
      return Response.json({
        status: 'ok', service: 'fovi-balance-sync', port: PORT,
        dbReady, balanceSyncEnabled: BALANCE_SYNC_ENABLED,
        uptime: process.uptime(), timestamp: new Date().toISOString(),
      });
    }

    if (url.pathname === '/sync' && req.method === 'POST') {
      const auth = checkInternalAuth(
        (name: string) => req.headers.get(name),
        INTERNAL_SERVICE_SECRET,
      );
      if (!auth.valid) return authErrorResponse(auth.status);

      // Phase 1: UNCONDITIONAL 403 — do NOT check BALANCE_SYNC_ENABLED, do NOT call runSyncCycle
      return Response.json(
        { triggered: false, code: 'PHASE1_LIVE_TRADING_DISABLED', remediationPhase: 'containment' },
        { status: 403 },
      );
    }

    if (url.pathname === '/status' && req.method === 'GET') {
      const auth = checkInternalAuth(
        (name: string) => req.headers.get(name),
        INTERNAL_SERVICE_SECRET,
      );
      if (!auth.valid) return authErrorResponse(auth.status);

      const statusPayload: Record<string, unknown> = {
        cyclesCompleted: 0, intervalMs: SYNC_INTERVAL_MS,
        port: PORT, balanceSyncEnabled: BALANCE_SYNC_ENABLED,
      };
      if (!BALANCE_SYNC_ENABLED) {
        statusPayload.reason = 'Phase 1: Balance sync is disabled during containment.';
        statusPayload.remediationPhase = 'containment';
      }
      return Response.json(statusPayload);
    }

    return new Response('Not Found', { status: 404 });
  },
});

console.log(`[BalanceSync] Service started on 127.0.0.1:${PORT}`);
console.log(`[BalanceSync] BALANCE_SYNC_ENABLED: ${BALANCE_SYNC_ENABLED}`);
console.log(`[BalanceSync] Sync interval: ${SYNC_INTERVAL_MS / 1000}s`);
console.log('[BalanceSync] Endpoints: GET /health, POST /sync, GET /status');
console.log('[BalanceSync] NOTE: Live broker linkage is not fixed or enabled by this round.');
console.log('[BalanceSync] Phase 1: /sync unconditionally returns 403 PHASE1_LIVE_TRADING_DISABLED');

// ── Signal handlers ──
process.on('SIGTERM', () => {
  console.log('[BalanceSync] Shutting down...');
  if (sql) sql.end().then(() => process.exit(0));
  else process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[BalanceSync] Interrupted, shutting down...');
  if (sql) sql.end().then(() => process.exit(0));
  else process.exit(0);
});
