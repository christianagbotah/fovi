// ============================================================
// Fovi Balance/Position Sync Service
// Phase 1 CR2:
//   Kill switch defaults to false. No initial/periodic non-demo sync.
//   Uses node:crypto.timingSafeEqual for auth.
//   Does NOT send X-User-Id (proxy strips it, and that is correct).
//   Tenant-safe sync deferred to later phase.
// ============================================================

import postgres from 'postgres';
import { createHash, timingSafeEqual as nodeTimingSafeEqual } from 'node:crypto';

const PORT = 3013;
const SYNC_INTERVAL_MS = 5 * 60 * 1000;
const NEXTJS_BASE = 'http://localhost:3002';
const INTERNAL_SERVICE_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';

// ── Kill switch: defaults to false ──
function envBool(name: string): boolean {
  const raw = process.env[name];
  if (!raw) return false;
  const lower = raw.trim().toLowerCase();
  return lower === 'true' || lower === '1' || lower === 'yes';
}
const BALANCE_SYNC_ENABLED = envBool('BALANCE_SYNC_ENABLED');

const databaseUrl = process.env.DATABASE_URL || '';
let sql: ReturnType<typeof postgres> | null = null;
let dbReady = false;

if (databaseUrl.startsWith('postgresql://') || databaseUrl.startsWith('postgres://')) {
  sql = postgres(databaseUrl);
  dbReady = true;
} else {
  console.warn('[BalanceSync] DATABASE_URL is not PostgreSQL — sync cycles will be skipped.');
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

// ── Internal service auth with SHA-256 + timingSafeEqual ──
function constantTimeEqual(a: string, b: string): boolean {
  try {
    const encoder = new TextEncoder();
    const digestA = createHash('sha256').update(encoder.encode(a)).digest();
    const digestB = createHash('sha256').update(encoder.encode(b)).digest();
    return nodeTimingSafeEqual(digestA, digestB);
  } catch {
    return false;
  }
}

function checkInternalAuth(req: Request): { valid: boolean; status: number } {
  if (!INTERNAL_SERVICE_SECRET) {
    return { valid: false, status: 503 };
  }
  const provided = req.headers.get('x-internal-service-secret') || '';
  if (constantTimeEqual(provided, INTERNAL_SERVICE_SECRET)) {
    return { valid: true, status: 200 };
  }
  return { valid: false, status: 401 };
}

function authErrorResponse(status: number): Response {
  if (status === 503) {
    return new Response(
      JSON.stringify({ error: 'Internal service authentication not configured.', code: 'INTERNAL_AUTH_REQUIRED' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }
  return new Response(
    JSON.stringify({ error: 'Unauthorized.', code: 'INTERNAL_AUTH_INVALID' }),
    { status: 401, headers: { 'Content-Type': 'application/json' } },
  );
}

// ── Sync a single account's positions & portfolio ──
// CR2: Does NOT send X-User-Id. The proxy strips it, and that is correct.
// Tenant-safe internal sync API is deferred to a later phase.
async function syncAccount(account: TradingAccount): Promise<void> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (INTERNAL_SERVICE_SECRET) {
    headers['X-Internal-Service-Secret'] = INTERNAL_SERVICE_SECRET;
  }
  // Do NOT send X-User-Id — the proxy strips it, and that is correct.
  // Live broker linkage is not fixed or enabled in this round.

  try {
    const posUrl = `${NEXTJS_BASE}/api/trading/positions?accountId=${account.id}`;
    const posRes = await fetch(posUrl, { headers, signal: AbortSignal.timeout(30_000) });
    console.log(`[BalanceSync] Positions sync for ${account.id}: ${posRes.status}`);
  } catch (err) {
    console.warn(`[BalanceSync] Positions sync error for ${account.id}:`, err);
  }

  try {
    const portUrl = `${NEXTJS_BASE}/api/trading/portfolio?accountId=${account.id}`;
    const portRes = await fetch(portUrl, { headers, signal: AbortSignal.timeout(30_000) });
    console.log(`[BalanceSync] Portfolio sync for ${account.id}: ${portRes.status}`);
  } catch (err) {
    console.warn(`[BalanceSync] Portfolio sync error for ${account.id}:`, err);
  }
}

let syncCycleCount = 0;

async function runSyncCycle(): Promise<void> {
  syncCycleCount++;
  console.log(`[BalanceSync] ── Sync cycle #${syncCycleCount} started at ${new Date().toISOString()} ──`);

  // ── Kill switch check ──
  if (!BALANCE_SYNC_ENABLED) {
    console.log('[BalanceSync] BALANCE_SYNC_ENABLED=false — skipping cycle');
    return;
  }

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
}

const server = Bun.serve({
  port: PORT,
  hostname: '127.0.0.1',
  fetch(req: Request): Response {
    const url = new URL(req.url);

    if (url.pathname === '/health' && req.method === 'GET') {
      return Response.json({
        status: 'ok', service: 'fovi-balance-sync', port: PORT,
        dbReady, cyclesCompleted: syncCycleCount,
        balanceSyncEnabled: BALANCE_SYNC_ENABLED,
        uptime: process.uptime(), timestamp: new Date().toISOString(),
      });
    }

    if (url.pathname === '/sync' && req.method === 'POST') {
      const auth = checkInternalAuth(req);
      if (!auth.valid) return authErrorResponse(auth.status);
      runSyncCycle().catch(err => console.error('[BalanceSync] Manual sync error:', err));
      return Response.json({ message: 'Sync cycle triggered', cycle: syncCycleCount + 1 });
    }

    if (url.pathname === '/status' && req.method === 'GET') {
      const auth = checkInternalAuth(req);
      if (!auth.valid) return authErrorResponse(auth.status);
      return Response.json({
        cyclesCompleted: syncCycleCount, intervalMs: SYNC_INTERVAL_MS,
        port: PORT, balanceSyncEnabled: BALANCE_SYNC_ENABLED,
      });
    }

    return new Response('Not Found', { status: 404 });
  },
});

console.log(`[BalanceSync] Service started on 127.0.0.1:${PORT}`);
console.log(`[BalanceSync] BALANCE_SYNC_ENABLED: ${BALANCE_SYNC_ENABLED}`);
console.log(`[BalanceSync] Sync interval: ${SYNC_INTERVAL_MS / 1000}s`);
console.log(`[BalanceSync] Endpoints: GET /health, POST /sync, GET /status`);
console.log(`[BalanceSync] NOTE: Live broker linkage is not fixed or enabled by this round.`);

// ── CR2: Do NOT start initial or periodic non-demo sync when disabled ──
if (BALANCE_SYNC_ENABLED) {
  setTimeout(() => {
    runSyncCycle().catch(err => console.error('[BalanceSync] Initial sync failed:', err));
  }, 10_000);

  setInterval(() => {
    runSyncCycle().catch(err => console.error('[BalanceSync] Periodic sync failed:', err));
  }, SYNC_INTERVAL_MS);
} else {
  console.log('[BalanceSync] Kill switch OFF — no initial or periodic sync scheduled.');
}

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
