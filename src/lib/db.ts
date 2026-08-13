import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

/**
 * Determine the database URL. Supports SQLite (file:) and PostgreSQL.
 * If DATABASE_URL is not set, defaults to a local SQLite file.
 */
function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL || '';
  if (url.startsWith('file:') || url.startsWith('sqlite:') ||
      url.startsWith('postgresql://') || url.startsWith('postgres://')) {
    return url;
  }
  // No DATABASE_URL set — default to local SQLite in the db/ folder
  const defaultPath = 'file:./db/fovi.db';
  console.warn(`[DB] No DATABASE_URL set — defaulting to SQLite: ${defaultPath}`);
  return defaultPath;
}

let _dbFailed = false;
let _db: PrismaClient | null = null;

const dbUrl = getDatabaseUrl();
if (!_dbFailed) {
  try {
    _db = new PrismaClient({
      datasourceUrl: dbUrl,
      log: process.env.NODE_ENV === 'development' ? ['error'] : [],
    });
  } catch (e) {
    _dbFailed = true;
    _db = null;
    console.warn('[DB] PrismaClient init failed:', e instanceof Error ? e.message : e);
  }
}

export const db = _db;
export const dbAvailable = !_dbFailed;

/** Check if a specific Prisma model is available */
export function hasModel(modelName: string): boolean {
  if (!db) return false;
  return (db as unknown as Record<string, unknown>)[modelName] !== undefined;
}

export function isDbAvailable(): boolean {
  return !_dbFailed && db !== null;
}

/** Run a DB query with automatic fallback to demo mode */
export async function safeDbQuery<T>(fn: () => Promise<T>): Promise<T | undefined> {
  if (!db) return undefined;
  try {
    return await fn();
  } catch (e) {
    console.warn('[DB] Query failed — falling back to demo mode:', e instanceof Error ? e.message : e);
    return undefined;
  }
}

// ============================================================
// Demo user — auto-created on first DB access
// ============================================================
export const DEMO_USER_ID = 'usr_demo_1';
const DEMO_USER_EMAIL = 'demo@fovi.ai';
const DEMO_ACCOUNT_ID = 'acc_demo_1';
let _demoUserEnsured = false;

export async function ensureDemoUser(): Promise<string | null> {
  if (_demoUserEnsured) return DEMO_USER_ID;
  if (!db || !hasModel('user')) return null;
  try {
    await db.user.upsert({
      where: { email: DEMO_USER_EMAIL },
      create: { id: DEMO_USER_ID, email: DEMO_USER_EMAIL, name: 'Demo User', passwordHash: 'demo_no_login' },
      update: {},
    });
    if (hasModel('tradingAccount')) {
      await db.tradingAccount.upsert({
        where: { id: DEMO_ACCOUNT_ID },
        create: { id: DEMO_ACCOUNT_ID, userId: DEMO_USER_ID, broker: 'demo', accountType: 'demo', isDefault: true, balance: 100000, currency: 'USD', isActive: true },
        update: {},
      });
    }
    _demoUserEnsured = true;
    return DEMO_USER_ID;
  } catch (e) {
    console.warn('[DB] Failed to ensure demo user:', e);
    return null;
  }
}
