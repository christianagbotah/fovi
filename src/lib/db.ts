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
 * This guards against cases where prisma generate was run with an older schema
 * (e.g. on VPS after pulling new code) and the model property is undefined.
 */
export function hasModel(modelName: string): boolean {
  if (!db) return false;
  return (db as unknown as Record<string, unknown>)[modelName] !== undefined;
}

export function isDbAvailable(): boolean {
  return !_dbFailed && db !== null;
}
