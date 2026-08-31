import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const workflow = readFileSync(
  resolve(__dirname, '../../../.github/workflows/runtime-fault-recovery.yml'),
  'utf8',
);
const balanceStartup = readFileSync(
  resolve(__dirname, '../../../mini-services/balance-sync/index.ts'),
  'utf8',
);
const balanceCore = readFileSync(
  resolve(__dirname, '../../../mini-services/balance-sync/core.ts'),
  'utf8',
);

describe('Phase 3C runtime dependency-loss and recovery qualification', () => {
  it('actively probes PostgreSQL instead of trusting the DATABASE_URL shape', () => {
    expect(balanceStartup).toContain('await sql`SELECT 1`');
    expect(balanceStartup).toContain('DB_PROBE_INTERVAL_MS');
    expect(balanceStartup).toContain('getDbReady: () => dbReady');
    expect(balanceCore).toContain("status: dbReady ? 'ok' : 'degraded'");
    expect(balanceCore).toContain('{ status: dbReady ? 200 : 503 }');
  });

  it('deliberately stops and restarts the PostgreSQL service container', () => {
    expect(workflow).toContain('docker stop "$DB_CONTAINER"');
    expect(workflow).toContain('docker start "$DB_CONTAINER"');
    expect(workflow).toContain('pg_isready -U fovi_ci -d fovi_ci');
  });

  it('requires Next.js and balance-sync to fail closed during database loss', () => {
    expect(workflow).toContain('wait_for_degraded next');
    expect(workflow).toContain('wait_for_degraded balance');
    expect(workflow).toContain(".checks.database.ok == false");
    expect(workflow).toContain(".dbReady == false and .balanceSyncEnabled == false");
  });

  it('requires automatic health recovery and unchanged migration history', () => {
    expect(workflow).toContain('wait_for_recovered next');
    expect(workflow).toContain('wait_for_recovered balance');
    expect(workflow).toContain(".checks.database.ok == true");
    expect(workflow).toContain(".dbReady == true and .balanceSyncEnabled == false");
    expect(workflow).toContain('cmp .fault/migrations-before.txt .fault/migrations-after.txt');
  });

  it('keeps execution and balance synchronization blocked before, during, and after recovery', () => {
    expect(workflow).toContain("AUTOMATED_TRADING_ENABLED: 'false'");
    expect(workflow).toContain("PAPER_AUTOMATED_EXECUTION_ENABLED: 'false'");
    expect(workflow).toContain("ENABLE_BALANCE_SYNC: 'false'");
    expect(workflow).toContain("BALANCE_SYNC_ENABLED: 'false'");
    expect(workflow).toContain("ENABLE_BROKER_CREDENTIAL_INTAKE: 'false'");
    expect(workflow.match(/PHASE1_LIVE_TRADING_DISABLED/g)?.length).toBeGreaterThanOrEqual(2);
    expect(workflow.match(/test \"\$engine_status\" = '403'/g)?.length).toBe(2);
    expect(workflow.match(/test \"\$balance_status\" = '403'/g)?.length).toBe(2);

    expect(workflow).not.toContain("AUTOMATED_TRADING_ENABLED: 'true'");
    expect(workflow).not.toContain("PAPER_AUTOMATED_EXECUTION_ENABLED: 'true'");
    expect(workflow).not.toContain("BALANCE_SYNC_ENABLED: 'true'");
    expect(workflow).not.toContain("ENABLE_BROKER_CREDENTIAL_INTAKE: 'true'");
  });
});
