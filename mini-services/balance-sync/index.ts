// ============================================================
// Fovi Balance/Position Sync Service
// Port: 3013
// ============================================================

import postgres from 'postgres';
import { createBalanceSyncHandler } from './sync-handler';
export type { SyncDeps, TradingAccount, BalanceSyncHandler } from './sync-handler';
export { createBalanceSyncHandler } from './sync-handler';

const PORT = 3013;
const SYNC_INTERVAL_MS = 5 * 60 * 1000;

const databaseUrl = process.env.DATABASE_URL || '';
let sql: ReturnType<typeof postgres> | null = null;
let dbReady = false;

if (databaseUrl.startsWith('postgresql://') || databaseUrl.startsWith('postgres://')) {
  sql = postgres(databaseUrl);
  dbReady = true;
} else {
  console.warn('[BalanceSync] DATABASE_URL is not a PostgreSQL URL. Sync cycles will be skipped.');
}

interface TradingAccount { id: string; userId: string; broker: string; accountType: string; isActive: boolean; }

async function getActiveAccounts(): Promise<TradingAccount[]> {
  if (!sql || !dbReady) return [];
  const rows = await sql<TradingAccount[]>`
    SELECT id, "userId", broker, "accountType", "isActive"
    FROM "TradingAccount"
    WHERE "accountType" != 'demo'
      AND "isActive" = true
      AND "apiKey" IS NOT NULL
      AND "apiSecret" IS NOT NULL
  `;
  return rows;
}

const handler = createBalanceSyncHandler();

const server = Bun.serve({
  port: PORT,
  fetch(req: Request): Response {
    const url = new URL(req.url);
    if (url.pathname === '/health' && req.method === 'GET') {
      return Response.json({ status: 'ok', service: 'fovi-balance-sync', port: PORT, dbReady, cyclesCompleted: handler.getCycleCount(), uptime: process.uptime(), timestamp: new Date().toISOString() });
    }
    if (url.pathname === '/sync' && req.method === 'POST') {
      handler.runSyncCycle(getActiveAccounts).catch(err => { console.error('[BalanceSync] Manual sync error:', err); });
      return Response.json({ message: 'Sync cycle triggered', cycle: handler.getCycleCount() + 1 });
    }
    if (url.pathname === '/status' && req.method === 'GET') {
      return Response.json({ cyclesCompleted: handler.getCycleCount(), intervalMs: SYNC_INTERVAL_MS, port: PORT });
    }
    return new Response('Not Found', { status: 404 });
  },
});

console.log(`[BalanceSync] Service started on port ${PORT}`);
console.log(`[BalanceSync] Endpoints: GET /health, POST /sync, GET /status`);

setTimeout(() => { handler.runSyncCycle(getActiveAccounts).catch(err => { console.error('[BalanceSync] Initial sync failed:', err); }); }, 10_000);
setInterval(() => { handler.runSyncCycle(getActiveAccounts).catch(err => { console.error('[BalanceSync] Periodic sync failed:', err); }); }, SYNC_INTERVAL_MS);

process.on('SIGTERM', () => { console.log('[BalanceSync] Shutting down...'); if (sql) sql.end().then(() => process.exit(0)); else process.exit(0); });
process.on('SIGINT', () => { console.log('[BalanceSync] Interrupted, shutting down...'); if (sql) sql.end().then(() => process.exit(0)); else process.exit(0); });
