// ============================================================
// Fovi Balance/Position Sync Service — Thin Startup Wrapper
// CR4.3A R7:
//   Pure logic lives in core.ts. This file is only startup glue:
//   DB connection, Bun.serve, env vars, signal handlers.
//   Uses createBalanceSyncHandler from core.ts for testable routing.
//   /sync unconditionally returns 403 during Phase 1.
// ============================================================

import postgres from 'postgres';
import { createBalanceSyncHandler } from './core';

const PORT = 3013;
const SYNC_INTERVAL_MS = 5 * 60 * 1000;
const DB_PROBE_INTERVAL_MS = 2_000;
const INTERNAL_SERVICE_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';

function envBool(name: string): boolean {
  const raw = process.env[name];
  if (!raw) return false;
  const lower = raw.trim().toLowerCase();
  return lower === 'true' || lower === '1' || lower === 'yes';
}
const BALANCE_SYNC_ENABLED = envBool('BALANCE_SYNC_ENABLED');

// ── DB connection and live readiness probe ──
const databaseUrl = process.env.DATABASE_URL || '';
let sql: ReturnType<typeof postgres> | null = null;
let dbReady = false;

if (databaseUrl.startsWith('postgresql://') || databaseUrl.startsWith('postgres://')) {
  sql = postgres(databaseUrl, { max: 1, connect_timeout: 3 });
} else {
  console.warn('[BalanceSync] DATABASE_URL is not PostgreSQL — sync cycles will be skipped.');
}

function setDbReady(next: boolean, detail?: string) {
  if (next === dbReady) return;
  dbReady = next;
  if (next) {
    console.log('[BalanceSync] Database readiness recovered.');
  } else {
    console.warn(`[BalanceSync] Database readiness lost${detail ? `: ${detail}` : '.'}`);
  }
}

async function refreshDbReadiness() {
  if (!sql) {
    setDbReady(false, 'PostgreSQL client is not configured');
    return;
  }
  try {
    await sql`SELECT 1`;
    setDbReady(true);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    setDbReady(false, detail);
  }
}

void refreshDbReadiness();
const dbProbeTimer = setInterval(() => { void refreshDbReadiness(); }, DB_PROBE_INTERVAL_MS);

// ── Thin Bun.serve — uses handler from core.ts ──
const handler = createBalanceSyncHandler({
  internalServiceSecret: INTERNAL_SERVICE_SECRET,
  balanceSyncEnabled: BALANCE_SYNC_ENABLED,
  syncIntervalMs: SYNC_INTERVAL_MS,
  port: PORT,
  dbReady,
  getDbReady: () => dbReady,
});

const server = Bun.serve({
  port: PORT,
  hostname: '127.0.0.1',
  fetch: handler,
});

console.log(`[BalanceSync] Service started on 127.0.0.1:${PORT}`);
console.log(`[BalanceSync] BALANCE_SYNC_ENABLED: ${BALANCE_SYNC_ENABLED}`);
console.log(`[BalanceSync] Sync interval: ${SYNC_INTERVAL_MS / 1000}s`);
console.log(`[BalanceSync] DB readiness probe interval: ${DB_PROBE_INTERVAL_MS / 1000}s`);
console.log('[BalanceSync] Endpoints: GET /health, POST /sync, GET /status');
console.log('[BalanceSync] NOTE: Live broker linkage is not fixed or enabled by this round.');
console.log('[BalanceSync] Phase 1: /sync unconditionally returns 403 PHASE1_LIVE_TRADING_DISABLED');

async function shutdown(message: string) {
  console.log(message);
  clearInterval(dbProbeTimer);
  server.stop();
  if (sql) await sql.end();
  process.exit(0);
}

// ── Signal handlers ──
process.on('SIGTERM', () => { void shutdown('[BalanceSync] Shutting down...'); });
process.on('SIGINT', () => { void shutdown('[BalanceSync] Interrupted, shutting down...'); });
