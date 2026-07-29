import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

let _dbFailed = false;

function isDatabaseUrlValid(): boolean {
  const url = process.env.DATABASE_URL || '';
  return url.startsWith('postgresql://') || url.startsWith('postgres://') || url.startsWith('file:') || url.startsWith('sqlite:');
}

let _db: PrismaClient | null = null;
if (!_dbFailed && isDatabaseUrlValid()) {
  try {
    _db = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['error'] : [],
    });
  } catch (e) {
    _dbFailed = true;
    _db = null;
    console.warn('[DB] PrismaClient init failed — demo mode:', e instanceof Error ? e.message : e);
  }
} else {
  _dbFailed = true;
  console.warn('[DB] No valid DATABASE_URL — running in demo mode');
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
const DEMO_ACCOUNT_ID = 'acc_demo_1';
let _demoUserEnsured = false;

/**
 * Ensure the demo user AND a default trading account exist.
 * Returns the userId on success, null if DB is unavailable.
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

    // Also ensure a default trading account exists for FK constraints
    if (hasModel('tradingAccount')) {
      await db.tradingAccount.upsert({
        where: { id: DEMO_ACCOUNT_ID },
        create: {
          id: DEMO_ACCOUNT_ID,
          userId: DEMO_USER_ID,
          broker: 'demo',
          accountType: 'demo',
          isDefault: true,
          balance: 100000,
          currency: 'USD',
          isActive: true,
        },
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
