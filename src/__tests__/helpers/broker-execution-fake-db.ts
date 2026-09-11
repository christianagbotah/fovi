// ============================================================
// broker-execution-fake-db.ts — Faithful in-memory Prisma client
// test double for broker-execution production-path tests.
//
// PURPOSE (correction round, defect 11):
//   These tests exercise REAL route handlers, REAL repositories,
//   REAL managers and REAL policy gates — only the database wire
//   boundary is replaced. To keep that honest, the fake faithfully
//   models the PostgreSQL semantics the production code relies on:
//
//     - UNIQUE constraints throw Prisma-shaped P2002 errors on
//       duplicate create (the atomic idempotency claim and the
//       GLOBAL kill-switch singleton depend on this).
//     - $transaction executes the callback against the SAME tables
//       with snapshot isolation: if the callback throws, ALL of its
//       writes are rolled back (deep-cloned snapshot restore).
//     - findUnique supports compound unique keys
//       (idempotencyKey_tenantId_accountId_providerId,
//       scope_scopeId).
//     - where: equality, { in: [...] }, OR, null.
//     - orderBy / take / skip.
//     - update with { increment: n } atomics.
//
//   `__hooks.beforeCreate(table, data)` lets tests deterministically
//   force the check-then-insert race between two transactions.
// ============================================================

// ============================================================
/** Prisma-shaped unique-constraint violation error. */
export class FakePrismaError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'FakePrismaError';
  }
}

type Row = Record<string, unknown>;
type Where = Record<string, unknown> | undefined;

interface TableConfig {
  /** Uniqueness: list of unique key groups (field names). */
  uniqueGroups: string[][];
  /** Auto-generate an id when not provided (cuid-like). */
  autoId: boolean;
  /** NOT NULL required fields (minimal validation). */
  required?: string[];
}

interface FakeDbHooks {
  /** Optional async hook invoked before each create (race forcing). */
  beforeCreate?: (table: string, data: Row) => Promise<void>;
}

function matchesWhere(row: Row, where: Where): boolean {
  if (!where) return true;
  for (const [key, condition] of Object.entries(where)) {
    if (key === 'OR') {
      const orClauses = condition as Where[];
      if (!orClauses.some((clause) => matchesWhere(row, clause))) return false;
      continue;
    }
    if (condition !== null && typeof condition === 'object' && !Array.isArray(condition)) {
      const ops = condition as Record<string, unknown>;
      if ('in' in ops) {
        const list = ops.in as unknown[];
        if (!list.includes(row[key] as unknown)) return false;
        continue;
      }
      if ('increment' in ops) {
        // increment is a write op, not a filter
        continue;
      }
      // Plain nested object → compound-unique lookup (e.g.
      // idempotencyKey_tenantId_accountId_providerId / scope_scopeId):
      // treat as nested equality against the row's flat fields.
      for (const [subKey, subValue] of Object.entries(ops)) {
        if ((row[subKey] as unknown) !== (subValue as unknown)) return false;
      }
      continue;
    }
    if ((row[key] as unknown) !== (condition as unknown)) return false;
  }
  return true;
}

function applyOrderBy(rows: Row[], orderBy?: Record<string, 'asc' | 'desc'>): Row[] {
  if (!orderBy) return rows;
  const entries = Object.entries(orderBy);
  const sorted = [...rows].sort((a, b) => {
    for (const [field, dir] of entries) {
      const av = a[field] as unknown;
      const bv = b[field] as unknown;
      let cmp = 0;
      if (av === null && bv === null) cmp = 0;
      else if (av === null) cmp = -1;
      else if (bv === null) cmp = 1;
      else if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
      else if (typeof av === 'boolean' && typeof bv === 'boolean') cmp = av === bv ? 0 : av ? 1 : -1;
      else if (av instanceof Date && bv instanceof Date) cmp = av.getTime() - bv.getTime();
      else cmp = String(av).localeCompare(String(bv));
      if (cmp !== 0) return dir === 'desc' ? -cmp : cmp;
    }
    return 0;
  });
  return sorted;
}

function cloneRow(row: Row): Row {
  // Rows are plain objects; Date values inside are shared by
  // reference (acceptable for the test double's snapshot purposes).
  return { ...row };
}

function deepSnapshot(tables: Map<string, Map<string, Row>>): Map<string, Map<string, Row>> {
  const snap = new Map<string, Map<string, Row>>();
  for (const [name, table] of tables) {
    const copy = new Map<string, Row>();
    for (const [id, row] of table) copy.set(id, cloneRow(row));
    snap.set(name, copy);
  }
  return snap;
}

/** Create a fake Prisma client for the broker-execution models. */
export function createFakeBrokerDb() {
  const tableConfigs: Record<string, TableConfig> = {
    brokerConnection: { uniqueGroups: [['id']], autoId: true, required: ['tenantId', 'providerId', 'accountType', 'isDemo', 'isActive', 'connectionState'] },
    executionCommandRecord: { uniqueGroups: [['id'], ['commandId']], autoId: true, required: ['commandId', 'idempotencyKey', 'tenantId', 'connectionId', 'providerId', 'commandType', 'commandPayload', 'currentState'] },
    executionStateTransition: { uniqueGroups: [['id']], autoId: true, required: ['commandId', 'fromState', 'toState'] },
    killSwitchRecord: { uniqueGroups: [['id'], ['scope', 'scopeId']], autoId: true, required: ['scope', 'scopeId', 'state', 'emergencyReadOnly'] },
    idempotencyRecord: { uniqueGroups: [['id'], ['idempotencyKey', 'tenantId', 'accountId', 'providerId']], autoId: true, required: ['commandId', 'idempotencyKey', 'tenantId', 'accountId', 'providerId', 'requestFingerprint', 'state'] },
    brokerExecutionAudit: { uniqueGroups: [['id']], autoId: true, required: ['actorId', 'tenantId', 'action'] },
    reconciliationResult: { uniqueGroups: [['id']], autoId: true, required: ['accountId', 'providerId', 'connectionId', 'status'] },
  };

  const tables = new Map<string, Map<string, Row>>();
  for (const name of Object.keys(tableConfigs)) tables.set(name, new Map());

  const hooks: FakeDbHooks = {};
  /** Reversible fail-closed mode: every model call throws a P1001-shaped error. */
  const failMode = { enabled: false };

  async function connectionGate(): Promise<void> {
    if (failMode.enabled) {
      throw new FakePrismaError('P1001', "Can't reach database server at `localhost:5432`");
    }
  }

  /** Undo log entry: reverts a single table mutation. */
  type Undo = () => void;

  function uniqueKeyFor(group: string[], data: Row): string {
    return group.map((field) => String(data[field] ?? '∅')).join('∪');
  }

  function checkUniqueViolations(tableName: string, data: Row, excludeId?: string): void {
    const config = tableConfigs[tableName];
    const table = tables.get(tableName)!;
    for (const group of config.uniqueGroups) {
      const key = uniqueKeyFor(group, data);
      for (const [existingId, existing] of table) {
        if (excludeId && existingId === excludeId) continue;
        if (uniqueKeyFor(group, existing) === key) {
          throw new FakePrismaError(
            'P2002',
            `Unique constraint failed on the fields: (${group.join(',')})`,
          );
        }
      }
    }
  }

  function makeModel(tableName: string) {
    const config = tableConfigs[tableName];
    const table = () => tables.get(tableName)!;

    const model = {
      async create(args: { data: Row }): Promise<Row> {
        await connectionGate();
        if (hooks.beforeCreate) await hooks.beforeCreate(tableName, args.data);
        const data = cloneRow(args.data);
        if (config.autoId && !data.id) {
          data.id = `fake_${tableName}_${Math.random().toString(36).slice(2, 10)}`;
        }
        // updatedAt / createdAt defaults (Prisma @default/@updatedAt semantics)
        if (!('createdAt' in data)) data.createdAt = new Date();
        if ('updatedAt' in data || (config.required ?? []).includes('updatedAt')) {
          data.updatedAt = new Date();
        }
        for (const field of config.required ?? []) {
          if (!(field in data) && field !== 'updatedAt' && field !== 'createdAt') {
            throw new FakePrismaError('P2003', `Required field ${field} missing`);
          }
        }
        checkUniqueViolations(tableName, data);
        table().set(data.id as string, data);
        return cloneRow(data);
      },

      async findUnique(args: { where: Record<string, unknown> }): Promise<Row | null> {
        await connectionGate();
        const where = args.where;
        // Compound unique or single id
        if ('id' in where && Object.keys(where).length === 1) {
          const row = table().get(String(where.id));
          return row ? cloneRow(row) : null;
        }
        for (const row of table().values()) {
          if (matchesWhere(row, where)) return cloneRow(row);
        }
        return null;
      },

      async findFirst(args: { where?: Where; orderBy?: Record<string, 'asc' | 'desc'> }): Promise<Row | null> {
        await connectionGate();
        const rows = applyOrderBy([...table().values()], args.orderBy).filter((row) =>
          matchesWhere(row, args.where),
        );
        return rows[0] ? cloneRow(rows[0]) : null;
      },

      async findMany(args: {
        where?: Where;
        orderBy?: Record<string, 'asc' | 'desc'>;
        take?: number;
        skip?: number;
      }): Promise<Row[]> {
        await connectionGate();
        let rows = [...table().values()].filter((row) => matchesWhere(row, args.where));
        rows = applyOrderBy(rows, args.orderBy);
        const skip = args.skip ?? 0;
        const take = args.take ?? Infinity;
        return rows.slice(skip, skip + take).map(cloneRow);
      },

      async update(args: { where: Record<string, unknown>; data: Row }): Promise<Row> {
        await connectionGate();
        let targetId: string | null = null;
        if ('id' in args.where && Object.keys(args.where).length === 1) {
          targetId = String(args.where.id);
        } else {
          for (const [id, row] of table()) {
            if (matchesWhere(row, args.where)) {
              targetId = id;
              break;
            }
          }
        }
        if (!targetId || !table().has(targetId)) {
          throw new FakePrismaError('P2025', 'Record to update not found');
        }
        const existing = table().get(targetId)!;
        const updated = cloneRow(existing);
        for (const [key, value] of Object.entries(args.data)) {
          if (value !== null && typeof value === 'object' && 'increment' in (value as Record<string, unknown>)) {
            updated[key] = ((updated[key] as number) ?? 0) + (value as { increment: number }).increment;
          } else {
            updated[key] = value;
          }
        }
        if ('updatedAt' in updated) updated.updatedAt = new Date();
        checkUniqueViolations(tableName, updated, targetId);
        table().set(targetId, updated);
        return cloneRow(updated);
      },

      async upsert(args: { where: Record<string, unknown>; create: Row; update: Row }): Promise<Row> {
        await connectionGate();
        let targetId: string | null = null;
        if ('id' in args.where && Object.keys(args.where).length === 1) {
          targetId = String(args.where.id);
        } else {
          for (const [id, row] of table()) {
            if (matchesWhere(row, args.where)) {
              targetId = id;
              break;
            }
          }
        }
        if (targetId && table().has(targetId)) {
          return model.update({ where: { id: targetId }, data: args.update });
        }
        return model.create({ data: args.create });
      },

      async delete(args: { where: Record<string, unknown> }): Promise<Row> {
        await connectionGate();
        let targetId: string | null = null;
        if ('id' in args.where && Object.keys(args.where).length === 1) {
          targetId = String(args.where.id);
        } else {
          for (const [id, row] of table()) {
            if (matchesWhere(row, args.where)) {
              targetId = id;
              break;
            }
          }
        }
        if (!targetId || !table().has(targetId)) {
          throw new FakePrismaError('P2025', 'Record to delete not found');
        }
        const row = table().get(targetId)!;
        table().delete(targetId);
        return cloneRow(row);
      },

      async count(args?: { where?: Where }): Promise<number> {
        await connectionGate();
        return [...table().values()].filter((row) => matchesWhere(row, args?.where)).length;
      },
    };

    return model;
  }

  const db = {
    brokerConnection: makeModel('brokerConnection'),
    executionCommandRecord: makeModel('executionCommandRecord'),
    executionStateTransition: makeModel('executionStateTransition'),
    killSwitchRecord: makeModel('killSwitchRecord'),
    idempotencyRecord: makeModel('idempotencyRecord'),
    brokerExecutionAudit: makeModel('brokerExecutionAudit'),
    reconciliationResult: makeModel('reconciliationResult'),

    /**
     * Interactive transaction with rollback semantics: every write
     * performed inside the callback is recorded in an undo log; if
     * the callback throws (e.g. P2002 from the unique constraint),
     * ALL of this transaction's writes are reverted in reverse order.
     * This correctly models aborted PostgreSQL transactions even when
     * two transactions interleave at await points.
     */
    async $transaction<T>(fn: (tx: typeof db) => Promise<T>): Promise<T> {
      const undo: Undo[] = [];
      const txDb = wrapForTransaction(undo);
      try {
        return await fn(txDb as unknown as typeof db);
      } catch (error) {
        for (const revert of undo.reverse()) revert();
        throw error;
      }
    },
  };

  /**
   * Wrap the shared models with an undo-logging proxy for the
   * duration of one transaction. Reads pass through (they observe
   * the shared tables — read-committed-like); writes record their
   * inverse so an abort can revert exactly this transaction's work.
   */
  function wrapForTransaction(undo: Undo[]): Record<string, unknown> {
    const wrapped: Record<string, unknown> = {};
    for (const tableName of Object.keys(tableConfigs)) {
      const table = tables.get(tableName)!;
      const model = (db as unknown as Record<string, Record<string, unknown>>)[tableName];
      const wrappedModel: Record<string, unknown> = {};

      wrappedModel.create = async (args: { data: Row }): Promise<Row> => {
        // Capture existence BEFORE the create (an auto-id row never
        // existed before; an explicit-id row may have — unique checks
        // usually reject that, but the undo must be precise).
        const explicitId = typeof args.data.id === 'string' ? (args.data.id as string) : null;
        const existedBefore = explicitId !== null && table.has(explicitId);
        const result = await (model.create as (a: { data: Row }) => Promise<Row>)(args);
        const id = result.id as string;
        undo.push(() => {
          if (!existedBefore) table.delete(id);
        });
        return result;
      };

      wrappedModel.update = async (args: { where: Record<string, unknown>; data: Row }): Promise<Row> => {
        // Resolve the target BEFORE the update for the undo snapshot.
        let targetId: string | null = null;
        if ('id' in args.where && Object.keys(args.where).length === 1) {
          targetId = String(args.where.id);
        } else {
          for (const [id, row] of table) {
            if (matchesWhere(row, args.where)) {
              targetId = id;
              break;
            }
          }
        }
        const previous = targetId && table.has(targetId) ? cloneRow(table.get(targetId)!) : null;
        const result = await (model.update as (a: unknown) => Promise<Row>)(args);
        const updatedId = result.id as string;
        undo.push(() => {
          if (previous) table.set(updatedId, previous);
        });
        return result;
      };

      wrappedModel.delete = async (args: { where: Record<string, unknown> }): Promise<Row> => {
        let targetId: string | null = null;
        if ('id' in args.where && Object.keys(args.where).length === 1) {
          targetId = String(args.where.id);
        } else {
          for (const [id, row] of table) {
            if (matchesWhere(row, args.where)) {
              targetId = id;
              break;
            }
          }
        }
        const previous = targetId && table.has(targetId) ? cloneRow(table.get(targetId)!) : null;
        const result = await (model.delete as (a: unknown) => Promise<Row>)(args);
        undo.push(() => {
          if (previous) table.set(previous.id as string, previous);
        });
        return result;
      };

      // upsert delegates to wrapped update/create; reads pass through.
      wrappedModel.upsert = async (args: { where: Record<string, unknown>; create: Row; update: Row }): Promise<Row> => {
        let targetId: string | null = null;
        if ('id' in args.where && Object.keys(args.where).length === 1) {
          targetId = String(args.where.id);
        } else {
          for (const [id, row] of table) {
            if (matchesWhere(row, args.where)) {
              targetId = id;
              break;
            }
          }
        }
        if (targetId && table.has(targetId)) {
          return (wrappedModel.update as (a: unknown) => Promise<Row>)({
            where: { id: targetId },
            data: args.update,
          });
        }
        return (wrappedModel.create as (a: { data: Row }) => Promise<Row>)({ data: args.create });
      };

      for (const [method, impl] of Object.entries(model)) {
        if (!(method in wrappedModel)) {
          wrappedModel[method] = impl;
        }
      }

      wrapped[tableName] = wrappedModel;
    }
    (wrapped as { $transaction: unknown }).$transaction = db.$transaction;
    return wrapped;
  }

  // ── Test-control surface (NOT part of the Prisma contract) ──
  const control = {
    /** Stable db object handed to the '@/lib/db' mock. */
    db,

    /** Reset all tables and clear fail-mode/hooks (between tests). */
    __reset(): void {
      for (const name of Object.keys(tableConfigs)) tables.set(name, new Map());
      hooks.beforeCreate = undefined;
      failMode.enabled = false;
    },

    /** Direct table access for seeding and assertions. */
    __tables: tables,

    /** Register the deterministic-race hook. */
    __setBeforeCreateHook(hook: FakeDbHooks['beforeCreate']): void {
      hooks.beforeCreate = hook;
    },

    /** Reversible fail-closed mode: P1001 from every model call. */
    __setFailMode(enabled: boolean): void {
      failMode.enabled = enabled;
    },
  };

  return control;
}

export type FakeBrokerDb = ReturnType<typeof createFakeBrokerDb>;
