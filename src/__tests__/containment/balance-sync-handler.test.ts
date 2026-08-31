// ============================================================
// balance-sync-handler.test.ts — CR4.3A R7
// Tests createBalanceSyncHandler from balance-sync/core.
// Uses synthetic Request objects.
// ============================================================

import { describe, it, expect } from 'vitest';
import { createBalanceSyncHandler } from '../../../mini-services/balance-sync/core';

const SECRET = 'test-internal-secret-abc123';

function makeHandler(overrides?: Record<string, unknown>) {
  return createBalanceSyncHandler({
    internalServiceSecret: SECRET,
    balanceSyncEnabled: false,
    syncIntervalMs: 60000,
    port: 3456,
    dbReady: true,
    ...overrides,
  });
}

function makeRequest(method: string, path: string, headers?: Record<string, string>): Request {
  const url = `http://localhost:3456${path}`;
  const init: RequestInit = { method, headers };
  return new Request(url, init);
}

describe('createBalanceSyncHandler', () => {
  // ── 1. GET /health → 200 with status ok ──
  it('GET /health → 200 with status ok', async () => {
    const handler = makeHandler();
    const req = makeRequest('GET', '/health');
    const res = handler(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.service).toBe('fovi-balance-sync');
    expect(body.dbReady).toBe(true);
  });

  it('GET /health → 503 degraded while the live DB readiness probe is false, then recovers', async () => {
    let ready = false;
    const handler = makeHandler({ getDbReady: () => ready });

    const degraded = handler(makeRequest('GET', '/health'));
    const degradedBody = await degraded.json();
    expect(degraded.status).toBe(503);
    expect(degradedBody.status).toBe('degraded');
    expect(degradedBody.dbReady).toBe(false);

    ready = true;
    const recovered = handler(makeRequest('GET', '/health'));
    const recoveredBody = await recovered.json();
    expect(recovered.status).toBe(200);
    expect(recoveredBody.status).toBe('ok');
    expect(recoveredBody.dbReady).toBe(true);
  });

  // ── 2. POST /sync without auth → 401 ──
  it('POST /sync without auth → 401', () => {
    const handler = makeHandler();
    const req = makeRequest('POST', '/sync');
    const res = handler(req);
    expect(res.status).toBe(401);
  });

  // ── 3. POST /sync with valid auth → 403 (Phase 1 unconditional) ──
  it('POST /sync with valid auth → 403 (Phase 1 unconditional)', () => {
    const handler = makeHandler();
    const req = makeRequest('POST', '/sync', {
      'x-internal-service-secret': SECRET,
    });
    const res = handler(req);
    expect(res.status).toBe(403);
  });

  // ── 4. POST /sync result does NOT call runSyncCycle (Phase 1 block) ──
  it('POST /sync result body contains PHASE1_LIVE_TRADING_DISABLED', async () => {
    const handler = makeHandler();
    const req = makeRequest('POST', '/sync', {
      'x-internal-service-secret': SECRET,
    });
    const res = handler(req);
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.code).toBe('PHASE1_LIVE_TRADING_DISABLED');
    expect(body.triggered).toBe(false);
    expect(body.remediationPhase).toBe('containment');
  });

  // ── 5. GET /status without auth → 401 ──
  it('GET /status without auth → 401', () => {
    const handler = makeHandler();
    const req = makeRequest('GET', '/status');
    const res = handler(req);
    expect(res.status).toBe(401);
  });

  // ── 6. GET /status with valid auth → 200 with balanceSyncEnabled info ──
  it('GET /status with valid auth → 200 with balanceSyncEnabled info', async () => {
    const handler = makeHandler({ balanceSyncEnabled: false });
    const req = makeRequest('GET', '/status', {
      'x-internal-service-secret': SECRET,
    });
    const res = handler(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.balanceSyncEnabled).toBe(false);
    expect(body.reason).toContain('Phase 1');
    expect(body.remediationPhase).toBe('containment');
  });

  // ── 7. GET /status with auth and balanceSyncEnabled=true → 200, no reason ──
  it('GET /status with auth and balanceSyncEnabled=true → 200, no reason', async () => {
    const handler = makeHandler({ balanceSyncEnabled: true });
    const req = makeRequest('GET', '/status', {
      'x-internal-service-secret': SECRET,
    });
    const res = handler(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.balanceSyncEnabled).toBe(true);
    expect(body.reason).toBeUndefined();
  });

  // ── 8. unknown route → 404 ──
  it('unknown route → 404', () => {
    const handler = makeHandler();
    const req = makeRequest('GET', '/unknown');
    const res = handler(req);
    expect(res.status).toBe(404);
  });

  // ── 9. POST on GET-only route → 404 ──
  it('POST on GET-only route (e.g. /health) → 404', () => {
    const handler = makeHandler();
    const req = makeRequest('POST', '/health');
    const res = handler(req);
    expect(res.status).toBe(404);
  });
});
