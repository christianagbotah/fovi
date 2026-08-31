import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const workflow = readFileSync(
  resolve(__dirname, '../../../.github/workflows/staging-runtime-qualification.yml'),
  'utf8',
);

describe('Phase 3A staging runtime qualification', () => {
  it('uses a real PostgreSQL service and production migrations', () => {
    expect(workflow).toContain('image: postgres:16-alpine');
    expect(workflow).toContain('bunx prisma migrate deploy');
    expect(workflow).toContain('bun run build');
    expect(workflow).toContain('NODE_ENV: production');
  });

  it('boots the real app and all three contained mini-services', () => {
    expect(workflow).toContain('next start --port 3002');
    expect(workflow).toContain('mini-services/market-service');
    expect(workflow).toContain('mini-services/auto-trade-engine');
    expect(workflow).toContain('mini-services/balance-sync');
  });

  it('keeps every execution and credential containment switch false', () => {
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

  it('verifies database health and fail-closed mutation endpoints', () => {
    expect(workflow).toContain('.checks.database.ok == true');
    expect(workflow).toContain('http://127.0.0.1:3012/cycle');
    expect(workflow).toContain('http://127.0.0.1:3013/sync');
    expect(workflow).toContain('PHASE1_LIVE_TRADING_DISABLED');
  });

  it('verifies engine restart recovery without enabling execution', () => {
    expect(workflow).toContain('Restart auto-trade engine and verify recovery');
    expect(workflow).toContain('.readiness == "disabled"');
    expect(workflow).toContain('.automatedTradingEnabled == false');
  });

  it('does not inject broker API credentials into the staging runtime', () => {
    expect(workflow).not.toMatch(/BINANCE_[A-Z_]*KEY/);
    expect(workflow).not.toMatch(/OKX_[A-Z_]*KEY/);
    expect(workflow).not.toMatch(/ALPACA_[A-Z_]*KEY/);
    expect(workflow).not.toMatch(/BROKER_API_(KEY|SECRET)/);
  });
});
