import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

let _dbFailed = false;

let _db: PrismaClient | null = null;
if (!_dbFailed) {
  try {
    _db = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['error'] : [],
    });
  } catch (e) {
    _dbFailed = true;
    _db = null;
    console.warn('[DB] PrismaClient init failed — demo mode:', e instanceof Error ? e.message : e);
  }
}

export const db = _db;
export const dbAvailable = !_dbFailed;

/**
 * Check if a specific Prisma model is available on the db client.
 */
export function hasModel(modelName: string): boolean {
  if (!db) return false;
  return (db as unknown as Record<string, unknown>)[modelName] !== undefined;
}

export function isDbAvailable(): boolean {
  return !_dbFailed && db !== null;
}

// ============================================================
// Demo user — auto-created on first DB access to satisfy FK constraints
// ============================================================
export const DEMO_USER_ID = 'usr_demo_1';
const DEMO_USER_EMAIL = 'demo@fovi.ai';
let _demoUserEnsured = false;

/**
 * Ensure the demo user exists in the DB. Call this before any
 * write operation that references userId. Returns the userId on
 * success, null if DB is unavailable.
 *
 * Only runs the upsert once per process lifecycle.
 */
export async function ensureDemoUser(): Promise<string | null> {
  if (_demoUserEnsured) return DEMO_USER_ID;
  if (!db || !hasModel('user')) return null;
  try {
    await db.user.upsert({
      where: { email: DEMO_USER_EMAIL },
      create: { id: DEMO_USER_ID, email: DEMO_USER_EMAIL, name: 'Demo User', passwordHash: 'demo_no_login' },
      update: {},
    });
    _demoUserEnsured = true;
    return DEMO_USER_ID;
  } catch (e) {
    console.warn('[DB] Failed to ensure demo user:', e);
    return null;
  }
}
