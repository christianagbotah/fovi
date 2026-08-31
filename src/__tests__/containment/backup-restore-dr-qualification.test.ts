import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const workflow = readFileSync(
  resolve(__dirname, '../../../.github/workflows/backup-restore-qualification.yml'),
  'utf8',
);

describe('Phase 3B backup/restore disaster-recovery qualification', () => {
  it('uses PostgreSQL native custom-format backup and restores into a different database', () => {
    expect(workflow).toContain('pg_dump');
    expect(workflow).toContain('--format=custom');
    expect(workflow).toContain('pg_restore');
    expect(workflow).toContain('fovi_restore');
    expect(workflow).toContain('DROP DATABASE IF EXISTS fovi_restore');
    expect(workflow).toContain('CREATE DATABASE fovi_restore OWNER fovi_ci');
  });

  it('proves schema, migration history, and application data survive restore exactly', () => {
    expect(workflow).toContain('source-schema.txt');
    expect(workflow).toContain('restored-schema.txt');
    expect(workflow).toContain('source-migrations.txt');
    expect(workflow).toContain('restored-migrations.txt');
    expect(workflow).toContain('source-data.txt');
    expect(workflow).toContain('restored-data.txt');
    expect(workflow.match(/cmp \.dr\/source-/g)?.length).toBe(3);
    expect(workflow).toContain("'dr-user-001'");
    expect(workflow).toContain("'dr-account-001'");
  });

  it('keeps the deterministic DR fixture demo-only and credential-free', () => {
    const tradingAccountSeed = workflow.match(/INSERT INTO "TradingAccount" \([\s\S]*?\n          \);/)?.[0];
    expect(tradingAccountSeed).toBeDefined();
    expect(tradingAccountSeed).toContain("'demo', 'demo', 'DR Probe', TRUE");
    expect(tradingAccountSeed).not.toContain('apiKey');
    expect(tradingAccountSeed).not.toContain('apiSecret');
    expect(tradingAccountSeed).not.toContain('passphrase');

    expect(workflow).toContain('apiKey');
    expect(workflow).toContain('apiSecret');
    expect(workflow).toContain('passphrase');
    expect(workflow).toContain("NF == 13 && $11 == \"\" && $12 == \"\" && $13 == \"\"");
    expect(workflow).toContain('docker run --rm -i --network host');

    expect(workflow).not.toMatch(/BINANCE_[A-Z_]*KEY/);
    expect(workflow).not.toMatch(/OKX_[A-Z_]*KEY/);
    expect(workflow).not.toMatch(/ALPACA_[A-Z_]*KEY/);
    expect(workflow).not.toMatch(/BROKER_API_(KEY|SECRET)/);
  });

  it('rejects a deliberately truncated backup instead of attempting recovery from it', () => {
    expect(workflow).toContain('fovi-corrupt.dump');
    expect(workflow).toContain('truncate -s 512');
    expect(workflow).toContain('corrupted backup unexpectedly passed pg_restore validation');
  });

  it('boots the contained runtime against the restored database', () => {
    expect(workflow).toContain('DATABASE_URL: ${{ env.RESTORE_DATABASE_URL }}');
    expect(workflow).toContain('next start --port 3002');
    expect(workflow).toContain('mini-services/market-service');
    expect(workflow).toContain('mini-services/auto-trade-engine');
    expect(workflow).toContain('mini-services/balance-sync');
    expect(workflow).toContain('.checks.database.ok == true');
  });

  it('keeps all execution, balance-sync, and credential-intake switches disabled', () => {
    expect(workflow).toContain("AUTOMATED_TRADING_ENABLED: 'false'");
    expect(workflow).toContain("PAPER_AUTOMATED_EXECUTION_ENABLED: 'false'");
    expect(workflow).toContain("ENABLE_BALANCE_SYNC: 'false'");
    expect(workflow).toContain("BALANCE_SYNC_ENABLED: 'false'");
    expect(workflow).toContain("ENABLE_BROKER_CREDENTIAL_INTAKE: 'false'");

    expect(workflow).not.toContain("AUTOMATED_TRADING_ENABLED: 'true'");
    expect(workflow).not.toContain("PAPER_AUTOMATED_EXECUTION_ENABLED: 'true'");
    expect(workflow).not.toContain("BALANCE_SYNC_ENABLED: 'true'");
    expect(workflow).not.toContain("ENABLE_BROKER_CREDENTIAL_INTAKE: 'true'");
  });

  it('does not retain the database backup as an Actions artifact', () => {
    expect(workflow).toContain('rm -f .dr/fovi.dump .dr/fovi-corrupt.dump');
    expect(workflow).not.toMatch(/path:\s*\.dr\//);
    expect(workflow).toContain('path: .runtime-logs/');
  });
});
