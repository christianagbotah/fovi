import { PrismaClient } from '@prisma/client';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { classifyProductionDatabaseState } from '@/lib/production-migration-policy';

const BASELINE_SCHEMA = resolve(process.cwd(), 'prisma/baseline.pre-containment.prisma');
const CURRENT_SCHEMA = resolve(process.cwd(), 'prisma/schema.prisma');

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

async function inspectDatabase(): Promise<{
  hasMigrationTable: boolean;
  applicationTableCount: number;
}> {
  const prisma = new PrismaClient();
  try {
    const tables = await prisma.$queryRawUnsafe<Array<{ tablename: string }>>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    );
    const hasMigrationTable = tables.some((row) => row.tablename === '_prisma_migrations');
    const applicationTableCount = tables.filter((row) => row.tablename !== '_prisma_migrations').length;
    return { hasMigrationTable, applicationTableCount };
  } finally {
    await prisma.$disconnect();
  }
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
        '--to-schema', BASELINE_SCHEMA,
        '--script',
        '--output', sqlPath,
      ]);

      console.log('[migration] Applying historical baseline without altering Prisma migration history...');
      runPrisma(['db', 'execute', '--schema', CURRENT_SCHEMA, '--file', sqlPath]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
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
