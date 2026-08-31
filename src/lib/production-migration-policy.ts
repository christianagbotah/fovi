export type ProductionMigrationAction = 'bootstrap-empty' | 'migrate-existing';

export interface ProductionDatabaseState {
  hasMigrationTable: boolean;
  applicationTableCount: number;
}

/**
 * Decide whether production migration may proceed automatically.
 *
 * Safety policy:
 * - Truly empty database: bootstrap the immutable historical PostgreSQL baseline,
 *   then let Prisma apply committed migrations normally.
 * - Non-empty database with Prisma history: run normal migrate deploy.
 * - Non-empty database without Prisma history: STOP. This may be a historical
 *   db-push/manual database and must be reconciled explicitly before mutation.
 * - Migration table without application tables: STOP. This indicates an
 *   incomplete, failed, or otherwise inconsistent migration state.
 */
export function classifyProductionDatabaseState(
  state: ProductionDatabaseState,
): ProductionMigrationAction {
  const { hasMigrationTable, applicationTableCount } = state;

  if (!Number.isInteger(applicationTableCount) || applicationTableCount < 0) {
    throw new Error('Invalid application table count while classifying production database state.');
  }

  if (!hasMigrationTable && applicationTableCount === 0) {
    return 'bootstrap-empty';
  }

  if (hasMigrationTable && applicationTableCount > 0) {
    return 'migrate-existing';
  }

  if (!hasMigrationTable && applicationTableCount > 0) {
    throw new Error(
      'FATAL_UNBASELINED_DATABASE: PostgreSQL is non-empty but has no _prisma_migrations table. ' +
      'Automatic migration is refused. Reconcile the existing schema and migration history explicitly before deployment.',
    );
  }

  throw new Error(
    'FATAL_INCONSISTENT_MIGRATION_STATE: _prisma_migrations exists but no application tables were found. ' +
    'Automatic migration is refused until the failed/incomplete migration state is investigated.',
  );
}
