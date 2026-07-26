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

export function isDbAvailable(): boolean {
  return !_dbFailed && db !== null;
}
