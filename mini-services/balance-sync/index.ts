// ============================================================
// Fovi Balance/Position Sync Service
// Periodically syncs all non-demo trading accounts by calling
// the Next.js API routes for positions and portfolio.
// Port: 3013
// ============================================================

import postgres from 'postgres';

const PORT = 3013;
const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const NEXTJS_BASE = 'http://localhost:3002';

// ── PostgreSQL Connection ──
const databaseUrl = process.env.DATABASE_URL || '';
let sql: ReturnType<typeof postgres> | null = null;
let dbReady = false;

if (databaseUrl.startsWith('postgresql://') || databaseUrl.startsWith('postgres://')) {
  sql = postgres(databaseUrl);
  dbReady = true;
} else {
  console.warn('[BalanceSync] DATABASE_URL is not a PostgreSQL URL (got: ' + databaseUrl.slice(0, 20) + '...). Sync cycles will be skipped.');
}

interface TradingAccount {
  id: string;
  userId: string;
  broker: string;
  accountType: string;
  isActive: boolean;
}

// ── Fetch non-demo, active trading accounts ──
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

// ── Sync a single account's positions & portfolio ──
async function syncAccount(account: TradingAccount): Promise<void> {
  const headers: Record<string, string> = {
    'X-User-Id': account.userId,
    'Content-Type': 'application/json',
  };

  // Sync positions (triggers broker position fetch + DB upsert)
  try {
    const posUrl = `${NEXTJS_BASE}/api/trading/positions?accountId=${account.id}`;
    const posRes = await fetch(posUrl, { headers, signal: AbortSignal.timeout(30_000) });
    if (!posRes.ok) {
      console.warn(`[BalanceSync] Positions sync failed for ${account.id}: ${posRes.status}`);
    } else {
      console.log(`[BalanceSync] Positions synced for ${account.id} (${account.broker})`);
    }
  } catch (err) {
    console.warn(`[BalanceSync] Positions sync error for ${account.id}:`, err);
  }

  // Sync portfolio (triggers balance refresh)
  try {
    const portUrl = `${NEXTJS_BASE}/api/trading/portfolio?accountId=${account.id}`;
    const portRes = await fetch(portUrl, { headers, signal: AbortSignal.timeout(30_000) });
    if (!portRes.ok) {
      console.warn(`[BalanceSync] Portfolio sync failed for ${account.id}: ${portRes.status}`);
    } else {
      console.log(`[BalanceSync] Portfolio synced for ${account.id} (${account.broker})`);
    }
  } catch (err) {
    console.warn(`[BalanceSync] Portfolio sync error for ${account.id}:`, err);
  }
}

// ── Full sync cycle ──
let syncCycleCount = 0;

async function runSyncCycle(): Promise<void> {
  syncCycleCount++;
  const startTime = Date.now();
  console.log(`[BalanceSync] ── Sync cycle #${syncCycleCount} started at ${new Date().toISOString()} ──`);

  try {
    const accounts = await getActiveAccounts();
    if (accounts.length === 0) {
      console.log('[BalanceSync] No active non-demo accounts to sync');
      return;
    }

    console.log(`[BalanceSync] Found ${accounts.length} active account(s) to sync`);

    for (const account of accounts) {
      await syncAccount(account);
      // Small delay between accounts to avoid hammering the Next.js server
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  } catch (err) {
    console.error('[BalanceSync] Sync cycle error:', err);
  }

  const elapsed = Date.now() - startTime;
  console.log(`[BalanceSync] ── Sync cycle #${syncCycleCount} completed in ${elapsed}ms ──`);
}

// ── HTTP Server ──
const server = Bun.serve({
  port: PORT,
  fetch(req: Request): Response {
    const url = new URL(req.url);

    // Health check
    if (url.pathname === '/health' && req.method === 'GET') {
      return Response.json({
        status: 'ok',
        service: 'fovi-balance-sync',
        port: PORT,
        dbReady,
        cyclesCompleted: syncCycleCount,
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      });
    }

    // Manual sync trigger
    if (url.pathname === '/sync' && req.method === 'POST') {
      // Run sync in background, respond immediately
      runSyncCycle().catch(err => {
        console.error('[BalanceSync] Manual sync error:', err);
      });
      return Response.json({ message: 'Sync cycle triggered', cycle: syncCycleCount + 1 });
    }

    // Sync status
    if (url.pathname === '/status' && req.method === 'GET') {
      return Response.json({
        cyclesCompleted: syncCycleCount,
        intervalMs: SYNC_INTERVAL_MS,
        port: PORT,
      });
    }

    return new Response('Not Found', { status: 404 });
  },
});

console.log(`[BalanceSync] Service started on port ${PORT}`);
console.log(`[BalanceSync] Sync interval: ${SYNC_INTERVAL_MS / 1000}s`);
console.log(`[BalanceSync] Endpoints: GET /health, POST /sync, GET /status`);

// ── Periodic Sync ──
// Run first sync after 10 seconds (let Next.js warm up)
setTimeout(() => {
  runSyncCycle().catch(err => {
    console.error('[BalanceSync] Initial sync failed:', err);
  });
}, 10_000);

// Then every 5 minutes
setInterval(() => {
  runSyncCycle().catch(err => {
    console.error('[BalanceSync] Periodic sync failed:', err);
  });
}, SYNC_INTERVAL_MS);

// Graceful shutdown
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
