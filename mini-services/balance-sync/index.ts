// ============================================================
// Fovi Balance/Position Sync Service
// Phase 1 CR1:
//   P0-5: Bind Bun.serve to 127.0.0.1, auth check for /sync.
//   Send X-Internal-Service-Secret header to Next.js API calls.
// ============================================================

import postgres from 'postgres';

const PORT = 3013;
const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const NEXTJS_BASE = 'http://localhost:3002';
const INTERNAL_SERVICE_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';

// ── PostgreSQL Connection ──
const databaseUrl = process.env.DATABASE_URL || '';
let sql: ReturnType<typeof postgres> | null = null;
let dbReady = false;

if (databaseUrl.startsWith('postgresql://') || databaseUrl.startsWith('postgres://')) {
  sql = postgres(databaseUrl);
  dbReady = true;
} else {
  console.warn('[BalanceSync] DATABASE_URL is not a PostgreSQL URL. Sync cycles will be skipped.');
}

interface TradingAccount {
  id: string;
  userId: string;
  broker: string;
  accountType: string;
  isActive: boolean;
}

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

// ── P0-5: Internal service auth ──
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function checkInternalAuth(req: Request): boolean {
  if (!INTERNAL_SERVICE_SECRET) return false;
  const provided = req.headers.get('x-internal-service-secret') || '';
  return constantTimeEqual(provided, INTERNAL_SERVICE_SECRET);
}

function authErrorResponse(): Response {
  return new Response(
    JSON.stringify({ error: 'Unauthorized.', code: 'INTERNAL_AUTH_INVALID' }),
    { status: 401, headers: { 'Content-Type': 'application/json' } },
  );
}

// ── Sync a single account's positions & portfolio ──
async function syncAccount(account: TradingAccount): Promise<void> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  // P0-5: Send internal service secret, also send X-User-Id from DB
  if (INTERNAL_SERVICE_SECRET) {
    headers['X-Internal-Service-Secret'] = INTERNAL_SERVICE_SECRET;
  }
  // The proxy validates the secret and sets X-Internal-Service=true.
  // Routes use getUserId which falls back to DEMO_USER_ID for internal requests,
  // but since the account is queried by ID from the DB, this is acceptable for sync.
  headers['X-User-Id'] = account.userId;

  // Sync positions
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

  // Sync portfolio
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
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  } catch (err) {
    console.error('[BalanceSync] Sync cycle error:', err);
  }

  const elapsed = Date.now() - startTime;
  console.log(`[BalanceSync] ── Sync cycle #${syncCycleCount} completed in ${elapsed}ms ──`);
}

// ── HTTP Server — P0-5: Bind to 127.0.0.1 ──
const server = Bun.serve({
  port: PORT,
  hostname: '127.0.0.1',
  fetch(req: Request): Response {
    const url = new URL(req.url);

    // Health check — unauthenticated
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

    // Manual sync trigger — requires auth
    if (url.pathname === '/sync' && req.method === 'POST') {
      if (!checkInternalAuth(req)) return authErrorResponse();
      runSyncCycle().catch(err => {
        console.error('[BalanceSync] Manual sync error:', err);
      });
      return Response.json({ message: 'Sync cycle triggered', cycle: syncCycleCount + 1 });
    }

    // Sync status — requires auth
    if (url.pathname === '/status' && req.method === 'GET') {
      if (!checkInternalAuth(req)) return authErrorResponse();
      return Response.json({
        cyclesCompleted: syncCycleCount,
        intervalMs: SYNC_INTERVAL_MS,
        port: PORT,
      });
    }

    return new Response('Not Found', { status: 404 });
  },
});

console.log(`[BalanceSync] Service started on 127.0.0.1:${PORT}`);
console.log(`[BalanceSync] Sync interval: ${SYNC_INTERVAL_MS / 1000}s`);
console.log(`[BalanceSync] Endpoints: GET /health, POST /sync, GET /status`);

setTimeout(() => {
  runSyncCycle().catch(err => {
    console.error('[BalanceSync] Initial sync failed:', err);
  });
}, 10_000);

setInterval(() => {
  runSyncCycle().catch(err => {
    console.error('[BalanceSync] Periodic sync failed:', err);
  });
}, SYNC_INTERVAL_MS);

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
