import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyProductionDatabaseState } from '@/lib/production-migration-policy';

const baselinePath = resolve(__dirname, '../../../prisma/baseline.pre-containment.prisma');
const migrationScriptPath = resolve(__dirname, '../../../scripts/migrate-production.ts');
const baseline = readFileSync(baselinePath, 'utf8');
const migrationScript = readFileSync(migrationScriptPath, 'utf8');

function gitBlobSha(content: string): string {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1')
    .update(Buffer.from(`blob ${bytes.length}\0`, 'utf8'))
    .update(bytes)
    .digest('hex');
}

describe('production database bootstrap safety', () => {
  it('preserves the exact historical pre-containment Prisma schema blob', () => {
    expect(gitBlobSha(baseline)).toBe('ae7654e01067d463cec2ec171641afff2c397fa7');
    expect(baseline).toContain('model TradingAccount');
    expect(baseline).not.toContain('isDemo          Boolean');
    expect(baseline).not.toContain('model PaperTradeSettlement');
  });

  it('bootstraps only a truly empty database', () => {
    expect(classifyProductionDatabaseState({
      hasMigrationTable: false,
      applicationTableCount: 0,
    })).toBe('bootstrap-empty');
  });

  it('uses normal migrations for a non-empty Prisma-managed database', () => {
    expect(classifyProductionDatabaseState({
      hasMigrationTable: true,
      applicationTableCount: 12,
    })).toBe('migrate-existing');
  });

  it('rejects a non-empty database without Prisma migration history', () => {
    expect(() => classifyProductionDatabaseState({
      hasMigrationTable: false,
      applicationTableCount: 12,
    })).toThrow('FATAL_UNBASELINED_DATABASE');
  });

  it('rejects a migration-history-only inconsistent database', () => {
    expect(() => classifyProductionDatabaseState({
      hasMigrationTable: true,
      applicationTableCount: 0,
    })).toThrow('FATAL_INCONSISTENT_MIGRATION_STATE');
  });

  it('generates baseline SQL from empty, executes it, then deploys committed migrations', () => {
    expect(migrationScript).toContain("'--from-empty'");
    expect(migrationScript).toContain('baseline.pre-containment.prisma');
    expect(migrationScript).toContain("'db', 'execute'");
    expect(migrationScript).toContain("'migrate', 'deploy'");
    expect(migrationScript).toContain("'migrate', 'status'");
    expect(migrationScript).not.toContain('db push');
    expect(migrationScript).not.toContain("'migrate', 'resolve'");
  });
});
