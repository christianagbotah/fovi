// ============================================================
// balance-sync/core.ts — Startup-free core module
// CR4.3A R7:
//   All logic is in pure functions / exported stateless helpers.
//   No Bun.serve, no global timers, no process event handlers.
//   The server entrypoint (index.ts) is a thin wrapper.
//   Added createBalanceSyncHandler() for testable route logic.
//
//   During Phase 1, getActiveAccounts() unconditionally returns [].
//   No non-demo account can be selected or contacted.
// ============================================================

export interface TradingAccount {
  id: string;
  userId: string;
  broker: string;
  accountType: string;
  isDemo: boolean | null;
  isActive: boolean;
  apiKey: string | null;
  apiSecret: string | null;
  passphrase: string | null;
}

export interface SyncResult {
  accountsProcessed: number;
  liveAccountsFound: number;
  fetchesAttempted: number;
  errors: string[];
}

// ── Internal service auth (pure function) ──

export function constantTimeEqual(a: string, b: string): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createHash, timingSafeEqual } = require('node:crypto');
    const encoder = new TextEncoder();
    const digestA = createHash('sha256').update(encoder.encode(a)).digest();
    const digestB = createHash('sha256').update(encoder.encode(b)).digest();
    return timingSafeEqual(digestA, digestB);
  } catch {
    return false;
  }
}

export function checkInternalAuth(
  getHeader: (name: string) => string | null,
  secret: string,
): { valid: boolean; status: number } {
  if (!secret) {
    return { valid: false, status: 503 };
  }
  const provided = getHeader('x-internal-service-secret') || '';
  if (constantTimeEqual(provided, secret)) {
    return { valid: true, status: 200 };
  }
  return { valid: false, status: 401 };
}

export function authErrorResponse(status: number): Response {
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

// ── Account selection ──

export type SqlQueryFn = <T>(strings: TemplateStringsArray, ...values: unknown[]) => Promise<T[]>;

/**
 * Phase 1: Unconditionally returns empty array.
 * No non-demo account may be selected or contacted.
 */
export async function getActiveAccounts(_sql: SqlQueryFn | null): Promise<TradingAccount[]> {
  // During Phase 1, no non-demo account may be synchronized.
  return [];
}

// ── Sync cycle ──

export interface SyncCycleDeps {
  sql: SqlQueryFn | null;
  dbReady: boolean;
  balanceSyncEnabled: boolean;
  nextjsBase: string;
  internalServiceSecret: string;
  fetchFn?: typeof fetch;
}

export async function runSyncCycle(deps: SyncCycleDeps): Promise<SyncResult> {
  const result: SyncResult = { accountsProcessed: 0, liveAccountsFound: 0, fetchesAttempted: 0, errors: [] };

  if (!deps.balanceSyncEnabled) {
    return result;
  }

  try {
    const accounts = await getActiveAccounts(deps.sql);
    result.liveAccountsFound = accounts.length;

    if (accounts.length === 0) {
      return result;
    }

    const fetchFn = deps.fetchFn || fetch;

    for (const account of accounts) {
      result.fetchesAttempted++;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (deps.internalServiceSecret) {
        headers['X-Internal-Service-Secret'] = deps.internalServiceSecret;
      }

      try {
        const posUrl = `${deps.nextjsBase}/api/trading/positions?accountId=${account.id}`;
        const posRes = await fetchFn(posUrl, { headers, signal: AbortSignal.timeout(30_000) } as RequestInit);
        console.log(`[BalanceSync] Positions sync for ${account.id}: ${posRes.status}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`positions:${account.id}: ${msg}`);
      }

      try {
        const portUrl = `${deps.nextjsBase}/api/trading/portfolio?accountId=${account.id}`;
        const portRes = await fetchFn(portUrl, { headers, signal: AbortSignal.timeout(30_000) } as RequestInit);
        console.log(`[BalanceSync] Portfolio sync for ${account.id}: ${portRes.status}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`portfolio:${account.id}: ${msg}`);
      }

      result.accountsProcessed++;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(`cycle: ${msg}`);
  }

  return result;
}

// ============================================================
// createBalanceSyncHandler — Testable route handler factory
// ============================================================

export interface BalanceSyncHandlerDeps {
  internalServiceSecret: string;
  balanceSyncEnabled: boolean;
  syncIntervalMs: number;
  port: number;
  dbReady: boolean;
  getDbReady?: () => boolean;
}

export function createBalanceSyncHandler(deps: BalanceSyncHandlerDeps) {
  return (req: Request): Response => {
    const url = new URL(req.url);

    if (url.pathname === '/health' && req.method === 'GET') {
      const dbReady = deps.getDbReady ? deps.getDbReady() : deps.dbReady;
      return Response.json({
        status: dbReady ? 'ok' : 'degraded', service: 'fovi-balance-sync', port: deps.port,
        dbReady, balanceSyncEnabled: deps.balanceSyncEnabled,
        uptime: process.uptime(), timestamp: new Date().toISOString(),
      }, { status: dbReady ? 200 : 503 });
    }

    if (url.pathname === '/sync' && req.method === 'POST') {
      const auth = checkInternalAuth(
        (name: string) => req.headers.get(name),
        deps.internalServiceSecret,
      );
      if (!auth.valid) return authErrorResponse(auth.status);

      // Phase 1: UNCONDITIONAL 403 — do NOT check balanceSyncEnabled, do NOT call runSyncCycle
      return Response.json(
        { triggered: false, code: 'PHASE1_LIVE_TRADING_DISABLED', remediationPhase: 'containment' },
        { status: 403 },
      );
    }

    if (url.pathname === '/status' && req.method === 'GET') {
      const auth = checkInternalAuth(
        (name: string) => req.headers.get(name),
        deps.internalServiceSecret,
      );
      if (!auth.valid) return authErrorResponse(auth.status);

      const statusPayload: Record<string, unknown> = {
        cyclesCompleted: 0, intervalMs: deps.syncIntervalMs,
        port: deps.port, balanceSyncEnabled: deps.balanceSyncEnabled,
      };
      if (!deps.balanceSyncEnabled) {
        statusPayload.reason = 'Phase 1: Balance sync is disabled during containment.';
        statusPayload.remediationPhase = 'containment';
      }
      return Response.json(statusPayload);
    }

    return new Response('Not Found', { status: 404 });
  };
}
