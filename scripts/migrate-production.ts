import { PrismaClient } from '@prisma/client';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { classifyProductionDatabaseState } from '../src/lib/production-migration-policy';

const BASELINE_SCHEMA = resolve(process.cwd(), 'prisma/baseline.pre-containment.prisma');
const CURRENT_SCHEMA = resolve(process.cwd(), 'prisma/schema.prisma');
const BASELINE_MIGRATION = '00000000000000_pre_containment_baseline';

interface DatabaseInspection {
  hasMigrationTable: boolean;
  applicationTableCount: number;
  tableNames: string[];
  appliedMigrationNames: string[];
}

function runPrisma(args: string[]): void {
  const result = spawnSync('bunx', ['prisma', ...args], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Prisma command failed with exit code ${result.status ?? 'unknown'}: prisma ${args.join(' ')}`);
  }
}

function historicalBaselineModelNames(): string[] {
  const schema = readFileSync(BASELINE_SCHEMA, 'utf8');
  return [...schema.matchAll(/^model\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/gm)].map((match) => match[1]);
}

function verifyHistoricalBaselineTables(tableNames: string[]): void {
  const present = new Set(tableNames);
  const expected = historicalBaselineModelNames();
  const missing = expected.filter((name) => !present.has(name));
  if (missing.length > 0) {
    throw new Error(
      `FATAL_BASELINE_SCHEMA_MISMATCH: historical baseline tables are missing: ${missing.join(', ')}. ` +
      'Automatic migration is refused.',
    );
  }
}

async function inspectDatabase(): Promise<DatabaseInspection> {
  const prisma = new PrismaClient();
  try {
    const tables = await prisma.$queryRawUnsafe<Array<{ tablename: string }>>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    );
    const tableNames = tables.map((row) => row.tablename);
    const hasMigrationTable = tableNames.includes('_prisma_migrations');
    const applicationTableCount = tableNames.filter((name) => name !== '_prisma_migrations').length;

    let appliedMigrationNames: string[] = [];
    if (hasMigrationTable) {
      const migrations = await prisma.$queryRawUnsafe<Array<{
        migration_name: string;
        finished_at: Date | null;
        rolled_back_at: Date | null;
      }>>(
        `SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at`,
      );
      appliedMigrationNames = migrations
        .filter((row) => row.finished_at !== null && row.rolled_back_at === null)
        .map((row) => row.migration_name);
    }

    return { hasMigrationTable, applicationTableCount, tableNames, appliedMigrationNames };
  } finally {
    await prisma.$disconnect();
  }
}

function markHistoricalBaselineApplied(): void {
  console.log(`[migration] Recording verified historical baseline as applied: ${BASELINE_MIGRATION}`);
  runPrisma(['migrate', 'resolve', '--applied', BASELINE_MIGRATION, '--schema', CURRENT_SCHEMA]);
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL || '';
  if (!databaseUrl.startsWith('postgresql://') && !databaseUrl.startsWith('postgres://')) {
    throw new Error('Production migration requires a PostgreSQL DATABASE_URL.');
  }
  if (!existsSync(BASELINE_SCHEMA)) {
    throw new Error(`Historical bootstrap schema is missing: ${BASELINE_SCHEMA}`);
  }
  if (!existsSync(CURRENT_SCHEMA)) {
    throw new Error(`Current Prisma schema is missing: ${CURRENT_SCHEMA}`);
  }

  const state = await inspectDatabase();
  const action = classifyProductionDatabaseState(state);

  console.log(
    `[migration] database state: applicationTables=${state.applicationTableCount}, ` +
    `prismaHistory=${state.hasMigrationTable ? 'present' : 'absent'}, action=${action}`,
  );

  if (action === 'bootstrap-empty') {
    const tempDir = mkdtempSync(join(tmpdir(), 'fovi-prisma-bootstrap-'));
    const sqlPath = join(tempDir, 'baseline.sql');

    try {
      console.log('[migration] Empty PostgreSQL database detected. Generating immutable pre-containment baseline SQL...');
      runPrisma([
        'migrate', 'diff',
        '--from-empty',
        '--to-schema-datamodel', BASELINE_SCHEMA,
        '--script',
        '--output', sqlPath,
      ]);

      console.log('[migration] Applying historical baseline DDL...');
      runPrisma(['db', 'execute', '--schema', CURRENT_SCHEMA, '--file', sqlPath]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }

    const bootstrapped = await inspectDatabase();
    verifyHistoricalBaselineTables(bootstrapped.tableNames);
    if (bootstrapped.hasMigrationTable) {
      throw new Error(
        'FATAL_BOOTSTRAP_HISTORY_UNEXPECTED: _prisma_migrations appeared during baseline DDL execution. Automatic migration is refused.',
      );
    }
    markHistoricalBaselineApplied();
  } else {
    verifyHistoricalBaselineTables(state.tableNames);
    if (!state.appliedMigrationNames.includes(BASELINE_MIGRATION)) {
      markHistoricalBaselineApplied();
    }
  }

  console.log('[migration] Applying committed migrations...');
  runPrisma(['migrate', 'deploy', '--schema', CURRENT_SCHEMA]);

  console.log('[migration] Verifying migration status...');
  runPrisma(['migrate', 'status', '--schema', CURRENT_SCHEMA]);
  console.log('[migration] Production migration gate passed.');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[migration] FATAL: ${message}`);
  process.exit(1);
});
