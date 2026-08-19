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

// ── Thin Bun.serve — uses handler from core.ts ──
const handler = createBalanceSyncHandler({
  internalServiceSecret: INTERNAL_SERVICE_SECRET,
  balanceSyncEnabled: BALANCE_SYNC_ENABLED,
  syncIntervalMs: SYNC_INTERVAL_MS,
  port: PORT,
  dbReady,
});

const server = Bun.serve({
  port: PORT,
  hostname: '127.0.0.1',
  fetch: handler,
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
