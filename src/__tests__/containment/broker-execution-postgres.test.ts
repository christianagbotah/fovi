// ============================================================
// broker-execution-postgres.test.ts — REAL PostgreSQL fidelity
// tests for the broker-execution boundary (CORRECTION ROUND 2,
// items 1 and 6).
//
// WHY THIS FILE EXISTS:
//   The in-memory fake (broker-execution-fake-db.ts) faithfully
//   models many PostgreSQL semantics, but constraints it does not
//   model MUST NOT be claimed as PostgreSQL-verified. This suite
//   runs the REAL production repositories, the REAL ownership
//   resolver and the REAL Prisma client against a REAL PostgreSQL
//   instance, proving the constraints the architect demanded:
//
//     1. Fresh-migration provider bootstrap (item 1): after a
//        fresh production migration, the production
//        ConnectionRepository creates a demo connection WITHOUT
//        any provider-table seed/FK (BrokerProviderConfig was
//        removed — canonical-providers.ts is the single source of
//        truth), while unknown providers are rejected and live
//        providers are refused by Phase 1 containment.
//     2. GLOBAL kill-switch singleton: the
//        KillSwitchRecord(scope, scopeId) UNIQUE constraint
//        rejects a second GLOBAL row at the database level, and
//        the repository's upsert keeps exactly one row.
//     3. Atomic idempotency: two PARALLEL submissions with the
//        same idempotency key produce EXACTLY ONE authoritative
//        command record (the loser rolls back and deduplicates);
//        the same key with a changed payload is a CONFLICT.
//     4. Audit-write failure → transaction rollback: when audit
//        inserts fail, the ENTIRE mutation rolls back — no
//        partial state, no false success.
//     5. Sanitizer parity (item 4): the transactional audit path
//        and the standalone AuditRepository.append() persist the
//        SAME sanitized ipMetadata (nested credentials redacted,
//        long UA truncated).
//     6. Cross-tenant indistinguishability (item 2): against real
//        PostgreSQL, resolving another tenant's REAL connection
//        id and a random non-existent id return IDENTICAL
//        failure resolutions.
//
// GATING:
//   The suite is activated by BROKER_PG_TEST_URL (the CI gate
//   provides a real PostgreSQL service and runs the production
//   migration first). Without the variable it SKIPS — it never
//   silently fakes PostgreSQL fidelity.
// ============================================================

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

// Hoisted BEFORE any module evaluation: point DATABASE_URL at the
// real test database so the real Prisma client initializes against it.
const pgUrl = vi.hoisted(() => {
  const url = process.env.BROKER_PG_TEST_URL;
  if (url) {
    process.env.DATABASE_URL = url;
  }
  return url ?? null;
});

// Real production modules — NO fake DB mock in this file.
import { db, isDbAvailable } from '@/lib/db';
import { ConnectionRepository } from '@/lib/broker-execution/persistence/connection-repository';
import { CommandRepository } from '@/lib/broker-execution/persistence/command-repository';
import { KillSwitchRepository } from '@/lib/broker-execution/persistence/kill-switch-repository';
import { AuditRepository } from '@/lib/broker-execution/persistence/audit-repository';
import { resolveOwnedConnection } from '@/lib/broker-execution/security/ownership';
import { isUniqueViolation } from '@/lib/broker-execution/persistence/db-access';

const BROKER_TABLES = [
  '"ProviderEventLog"',
  '"ReconciliationResult"',
  '"IdempotencyRecord"',
  '"BrokerExecutionAudit"',
  '"ExecutionStateTransition"',
  '"ExecutionCommandRecord"',
  '"KillSwitchRecord"',
  '"BrokerConnection"',
] as const;

const AUDIT_BLOCK_TRIGGER = '__fovi_test_block_audit';
const AUDIT_BLOCK_FUNCTION = '__fovi_test_block_audit_fn';

async function truncateBrokerTables(): Promise<void> {
  await db!.$executeRawUnsafe(
    `TRUNCATE TABLE ${BROKER_TABLES.join(', ')} RESTART IDENTITY CASCADE`,
  );
}

// ── Suite gate: only run against a REAL PostgreSQL instance ──
const describePg = pgUrl ? describe : describe.skip;

describePg('Broker execution — real PostgreSQL fidelity', () => {
  beforeAll(() => {
    if (!isDbAvailable()) {
      throw new Error(
        'BROKER_PG_TEST_URL is set but the Prisma client did not initialize. ' +
          'Did the test database get migrated? (CI runs scripts/migrate-production.ts first.)',
      );
    }
  });

  beforeEach(async () => {
    await truncateBrokerTables();
  });

  afterAll(async () => {
    // Safety net: remove the audit-block trigger if a test failed
    // before its own cleanup.
    await db!.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${AUDIT_BLOCK_TRIGGER} ON "BrokerExecutionAudit"`);
    await db!.$disconnect();
  });

  // ══════════════════════════════════════════════════════════
  // 1. Fresh-DB provider bootstrap — single source of truth
  // ══════════════════════════════════════════════════════════
  describe('fresh-migration provider bootstrap (no FK, no seed)', () => {
    it('the provider catalog tables were removed from the migration', async () => {
      const rows = await db!.$queryRawUnsafe<Array<{ table_name: string }>>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name IN ('BrokerProviderConfig', 'BrokerProviderCapability')`,
      );
      expect(rows).toEqual([]);
    });

    it('BrokerConnection.providerId carries NO database foreign key', async () => {
      const rows = await db!.$queryRawUnsafe<Array<{ conname: string }>>(
        `SELECT c.conname FROM pg_constraint c
         JOIN pg_class r ON c.conrelid = r.oid
         JOIN pg_namespace n ON r.relnamespace = n.oid
         WHERE r.relname = 'BrokerConnection' AND n.nspname = 'public' AND c.contype = 'f'`,
      );
      expect(rows).toEqual([]);
    });

    it('the production repository creates a DEMO connection on a fresh DB with zero provider rows', async () => {
      // Provider table count is zero — there is no seed to bootstrap.
      const providerRows = await db!.$queryRawUnsafe<Array<unknown>>(
        `SELECT 1 FROM information_schema.tables WHERE table_name = 'BrokerProviderConfig'`,
      );
      expect(providerRows).toEqual([]);

      const result = await ConnectionRepository.createConnection({
        tenantId: 'pg_user_A',
        providerId: 'demo',
        accountId: null,
        accountName: 'pg demo connection',
        actorId: 'pg_user_A',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.connection.providerId).toBe('demo');
      expect(result.connection.isDemo).toBe(true);
      expect(result.connection.accountType).toBe('demo');
      expect(result.connection.isActive).toBe(false);
      expect(result.connection.connectionState).toBe('DISCONNECTED');

      // The transactional audit row was written by the SAME transaction.
      const auditCount = await db!.brokerExecutionAudit.count({ where: { action: 'CONNECT' } });
      expect(auditCount).toBe(1);
    });

    it('an UNKNOWN provider id is rejected (400 PROVIDER_UNKNOWN) and nothing persists', async () => {
      const result = await ConnectionRepository.createConnection({
        tenantId: 'pg_user_A',
        providerId: 'kucoin-not-a-real-provider',
        actorId: 'pg_user_A',
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(400);
      expect(result.code).toBe('PROVIDER_UNKNOWN');
      expect(await db!.brokerConnection.count()).toBe(0);
    });

    it('a known LIVE provider is refused under Phase 1 containment (403 PROVIDER_UNAVAILABLE)', async () => {
      const result = await ConnectionRepository.createConnection({
        tenantId: 'pg_user_A',
        providerId: 'binance',
        actorId: 'pg_user_A',
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(403);
      expect(result.code).toBe('PROVIDER_UNAVAILABLE');
      expect(await db!.brokerConnection.count()).toBe(0);
    });
  });

  // ══════════════════════════════════════════════════════════
  // 2. GLOBAL kill-switch singleton
  // ══════════════════════════════════════════════════════════
  describe('GLOBAL kill-switch singleton', () => {
    it('the database UNIQUE(scope, scopeId) constraint rejects a second GLOBAL row', async () => {
      const now = new Date();
      await db!.killSwitchRecord.create({
        data: {
          id: 'pg_ks_1',
          scope: 'GLOBAL',
          scopeId: 'global',
          state: 'ACTIVE',
          activatedBy: 'pg_admin',
          reason: 'singleton test first insert',
          createdAt: now,
          updatedAt: now,
        },
      });

      let violation: unknown = null;
      try {
        await db!.killSwitchRecord.create({
          data: {
            id: 'pg_ks_2',
            scope: 'GLOBAL',
            scopeId: 'global',
            state: 'ACTIVE',
            activatedBy: 'pg_admin',
            reason: 'singleton test second insert must fail',
            createdAt: now,
            updatedAt: now,
          },
        });
      } catch (error) {
        violation = error;
      }

      expect(violation).not.toBeNull();
      expect(isUniqueViolation(violation)).toBe(true);
      expect(await db!.killSwitchRecord.count({ where: { scope: 'GLOBAL' } })).toBe(1);
    });

    it('the repository upsert keeps EXACTLY ONE GLOBAL row across repeated activations', async () => {
      const first = await KillSwitchRepository.activateKillSwitch({
        scope: 'GLOBAL',
        activatedBy: 'pg_admin',
        reason: 'first activation',
      });
      const second = await KillSwitchRepository.activateKillSwitch({
        scope: 'GLOBAL',
        activatedBy: 'pg_admin',
        reason: 'second activation (upsert)',
      });

      expect(first.state).toBe('ACTIVE');
      expect(second.state).toBe('ACTIVE');
      expect(await db!.killSwitchRecord.count({ where: { scope: 'GLOBAL' } })).toBe(1);

      // Each activation wrote its audit entry in the same transaction.
      expect(await db!.brokerExecutionAudit.count({ where: { action: 'KILL_SWITCH_ACTIVATE' } })).toBe(2);
    });
  });

  // ══════════════════════════════════════════════════════════
  // 3. Atomic idempotency
  // ══════════════════════════════════════════════════════════
  describe('atomic idempotency (parallel submissions)', () => {
    async function createOwnedDemoConnection(tenantId: string): Promise<string> {
      const result = await ConnectionRepository.createConnection({
        tenantId,
        providerId: 'demo',
        accountId: null,
        actorId: tenantId,
      });
      if (!result.ok) throw new Error('demo connection create failed in test setup');
      return result.connection.id;
    }

    it('two PARALLEL identical submissions produce EXACTLY ONE authoritative record', async () => {
      const connectionId = await createOwnedDemoConnection('pg_user_A');

      const makeInput = (commandId: string) => ({
        commandId,
        idempotencyKey: 'pg_idem_key_same',
        tenantId: 'pg_user_A',
        connectionId,
        accountId: connectionId,
        providerId: 'demo',
        commandType: 'PLACE_MARKET',
        commandPayload: { symbol: 'BTC/USDT', side: 'BUY', size: 1 },
        requestFingerprint: 'pg-fingerprint-identical',
        correlationId: `pg_corr_${commandId}`,
        finalState: 'APPROVED',
        transitions: [
          { fromState: 'CREATED', toState: 'APPROVED', reason: 'phase 1 stopped', actorId: 'pg_user_A' },
        ],
        audit: {
          actorId: 'pg_user_A',
          tenantId: 'pg_user_A',
          action: 'COMMAND_SUBMITTED',
          accountId: connectionId,
          providerId: 'demo',
          resultingState: 'APPROVED',
          reason: 'parallel idempotency test',
          correlationId: `pg_corr_${commandId}`,
          commandId,
        },
      });

      // Genuinely parallel: both transactions race for the
      // IdempotencyRecord UNIQUE(idempotencyKey, tenantId,
      // accountId, providerId) claim.
      const [r1, r2] = await Promise.all([
        CommandRepository.createWithIdempotencyAndAudit(makeInput('pg_cmd_winner')),
        CommandRepository.createWithIdempotencyAndAudit(makeInput('pg_cmd_loser')),
      ]);

      const outcomes = [r1.outcome, r2.outcome].sort();
      expect(outcomes).toEqual(['CREATED', 'DUPLICATE']);

      // EXACTLY ONE authoritative command record exists.
      expect(await db!.executionCommandRecord.count()).toBe(1);
      expect(await db!.idempotencyRecord.count()).toBe(1);
    });

    it('the same key with a CHANGED payload is a CONFLICT (409 semantics)', async () => {
      const connectionId = await createOwnedDemoConnection('pg_user_A');
      const base = {
        idempotencyKey: 'pg_idem_key_conflict',
        tenantId: 'pg_user_A',
        connectionId,
        accountId: connectionId,
        providerId: 'demo',
        commandType: 'PLACE_MARKET',
        commandPayload: { symbol: 'BTC/USDT', side: 'BUY', size: 1 },
        correlationId: 'pg_corr_conflict',
        finalState: 'APPROVED',
        transitions: [
          { fromState: 'CREATED', toState: 'APPROVED', reason: 'phase 1 stopped', actorId: 'pg_user_A' },
        ],
        audit: {
          actorId: 'pg_user_A',
          tenantId: 'pg_user_A',
          action: 'COMMAND_SUBMITTED',
          accountId: connectionId,
          providerId: 'demo',
          resultingState: 'APPROVED',
          reason: 'conflict test',
        },
      };

      const first = await CommandRepository.createWithIdempotencyAndAudit({
        ...base,
        commandId: 'pg_cmd_conflict_1',
        requestFingerprint: 'pg-fingerprint-A',
      });
      expect(first.outcome).toBe('CREATED');

      const second = await CommandRepository.createWithIdempotencyAndAudit({
        ...base,
        commandId: 'pg_cmd_conflict_2',
        requestFingerprint: 'pg-fingerprint-B-DIFFERENT',
      });
      expect(second.outcome).toBe('CONFLICT');

      // Still exactly one authoritative record.
      expect(await db!.executionCommandRecord.count()).toBe(1);
    });
  });

  // ══════════════════════════════════════════════════════════
  // 4. Audit-write failure rolls the WHOLE mutation back
  // ══════════════════════════════════════════════════════════
  describe('audit write failure → full transaction rollback', () => {
    async function blockAuditInserts(): Promise<void> {
      await db!.$executeRawUnsafe(
        `CREATE OR REPLACE FUNCTION ${AUDIT_BLOCK_FUNCTION}() RETURNS trigger AS $fn$
         BEGIN
           RAISE EXCEPTION 'forced audit insert failure (rollback test)';
         END;
         $fn$ LANGUAGE plpgsql`,
      );
      await db!.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS ${AUDIT_BLOCK_TRIGGER} ON "BrokerExecutionAudit"`,
      );
      await db!.$executeRawUnsafe(
        `CREATE TRIGGER ${AUDIT_BLOCK_TRIGGER} BEFORE INSERT ON "BrokerExecutionAudit"
         FOR EACH ROW EXECUTE FUNCTION ${AUDIT_BLOCK_FUNCTION}()`,
      );
    }

    async function unblockAuditInserts(): Promise<void> {
      await db!.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS ${AUDIT_BLOCK_TRIGGER} ON "BrokerExecutionAudit"`,
      );
      await db!.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${AUDIT_BLOCK_FUNCTION}()`);
    }

    it('a failed audit insert leaves ZERO connection rows (no partial state, no false success)', async () => {
      await blockAuditInserts();
      try {
        const result = await ConnectionRepository.createConnection({
          tenantId: 'pg_user_A',
          providerId: 'demo',
          accountId: null,
          actorId: 'pg_user_A',
        });

        // Fail-closed: the mutation must NOT report success.
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.status).toBe(503);
          expect(result.code).toBe('SERVICE_UNAVAILABLE');
        }

        // The transaction rolled back — the connection record from
        // the SAME transaction is gone.
        expect(await db!.brokerConnection.count()).toBe(0);
      } finally {
        await unblockAuditInserts();
      }
    });

    it('normal operation resumes after the trigger is removed (fail-closed, not fail-broken)', async () => {
      const result = await ConnectionRepository.createConnection({
        tenantId: 'pg_user_A',
        providerId: 'demo',
        accountId: null,
        actorId: 'pg_user_A',
      });
      expect(result.ok).toBe(true);
      expect(await db!.brokerConnection.count()).toBe(1);
    });
  });

  // ══════════════════════════════════════════════════════════
  // 5. Sanitizer parity — transactional vs standalone audit
  // ══════════════════════════════════════════════════════════
  describe('transactional and standalone audit paths use the SAME sanitizer', () => {
    const maliciousIpMetadata = () => ({
      ip: '203.0.113.7',
      userAgent: 'UA-'.repeat(200), // 800 chars → must truncate to 256
      nested: {
        apiKey: 'SUPER-SECRET-API-KEY',
        credentials: { token: 'SECRET-TOKEN', note: 'harmless' },
      },
      forwardedFor: 'not-an-ip, definitely-garbage',
    });

    it('the TRANSACTIONAL path (createConnection) redacts nested credentials and truncates the UA', async () => {
      const result = await ConnectionRepository.createConnection({
        tenantId: 'pg_user_A',
        providerId: 'demo',
        accountId: null,
        actorId: 'pg_user_A',
        ipMetadata: maliciousIpMetadata(),
      });
      expect(result.ok).toBe(true);

      const row = await db!.brokerExecutionAudit.findFirst({
        where: { action: 'CONNECT', tenantId: 'pg_user_A' },
      });
      expect(row).not.toBeNull();
      const meta = row!.ipMetadata as Record<string, unknown>;
      expect(meta.ip).toBe('203.0.113.7');
      expect((meta.userAgent as string).length).toBe(256);
      expect((meta.userAgent as string).startsWith('UA-UA-')).toBe(true);
      const nested = meta.nested as Record<string, unknown>;
      expect(nested.apiKey).toBe('[REDACTED]');
      const credentials = nested.credentials as Record<string, unknown>;
      expect(credentials.token).toBe('[REDACTED]');
      expect(credentials.note).toBe('harmless');
      expect(meta.forwardedFor).toBeNull(); // malformed forwarded data dropped
    });

    it('the STANDALONE path (AuditRepository.append) persists the IDENTICAL sanitized shape', async () => {
      // Create the transactional audit row first (same malicious input).
      const created = await ConnectionRepository.createConnection({
        tenantId: 'pg_user_A',
        providerId: 'demo',
        accountId: null,
        actorId: 'pg_user_A',
        ipMetadata: maliciousIpMetadata(),
      });
      expect(created.ok).toBe(true);

      // Now the standalone path with the SAME malicious input.
      const appended = await AuditRepository.append({
        actorId: 'pg_user_A',
        tenantId: 'pg_user_A',
        action: 'TEST_SANITIZER_PARITY',
        reason: 'standalone sanitizer parity',
        ipMetadata: maliciousIpMetadata(),
      });
      expect(appended.id).toBeTruthy();

      const transactionalRow = await db!.brokerExecutionAudit.findFirst({
        where: { action: 'CONNECT', tenantId: 'pg_user_A' },
      });
      expect(transactionalRow).not.toBeNull();
      const standaloneRow = await db!.brokerExecutionAudit.findFirst({
        where: { action: 'TEST_SANITIZER_PARITY', tenantId: 'pg_user_A' },
      });
      expect(standaloneRow).not.toBeNull();

      // Both rows must carry the exact same sanitized ipMetadata —
      // one row was written inside a transaction, the other
      // standalone, but both went through the SAME sanitizer.
      expect(standaloneRow!.ipMetadata).toEqual(transactionalRow!.ipMetadata);
    });
  });

  // ══════════════════════════════════════════════════════════
  // 6. Cross-tenant indistinguishability (real PostgreSQL)
  // ══════════════════════════════════════════════════════════
  describe('cross-tenant existence oracle removed', () => {
    it('user B resolving user A\'s REAL connection id and a RANDOM id get IDENTICAL resolutions', async () => {
      const created = await ConnectionRepository.createConnection({
        tenantId: 'pg_user_A',
        providerId: 'demo',
        accountId: null,
        actorId: 'pg_user_A',
      });
      if (!created.ok) throw new Error('setup failed');
      const realForeignId = created.connection.id;

      const foreign = await resolveOwnedConnection(realForeignId, 'pg_user_B');
      const nonexistent = await resolveOwnedConnection('certainly-not-a-real-connection-id', 'pg_user_B');

      // IDENTICAL in every observable field.
      expect(foreign).toEqual(nonexistent);
      expect(foreign.ok).toBe(false);
      if (foreign.ok) return;
      expect(foreign.status).toBe(404);
      expect(foreign.code).toBe('CONNECTION_NOT_FOUND');
      expect(foreign.message).toBe(nonexistent.ok ? '' : (nonexistent as { message: string }).message);
      expect(foreign.message).toBe('Connection not found.');

      // The owner still resolves their own connection fine.
      const owned = await resolveOwnedConnection(realForeignId, 'pg_user_A');
      expect(owned.ok).toBe(true);
    });
  });
});
