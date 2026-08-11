import { db, hasModel, isDbAvailable, safeDbQuery } from '@/lib/db';

// ============================================================
// Types
// ============================================================

interface CachedConfig<T> {
  data: T;
  expiresAt: number;
}

// ============================================================
// In-memory config cache (5 min TTL)
// ============================================================

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const configCache = new Map<string, CachedConfig<unknown>>();

function getCached<T>(key: string): T | null {
  const entry = configCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    configCache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCache<T>(key: string, data: T): void {
  configCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL });
}

/**
 * Invalidate the in-memory cache for a specific key or all keys.
 */
export function invalidateSystemConfigCache(key?: string): void {
  if (key) {
    configCache.delete(key);
  } else {
    configCache.clear();
  }
}

// ============================================================
// Generic SystemConfig read / write
// ============================================================

/**
 * Read a system config by key from the SystemConfig DB table.
 * Returns null if the key doesn't exist or the DB is unavailable.
 * Results are cached in-memory for 5 minutes.
 */
export async function getSystemConfig<T = unknown>(key: string): Promise<T | null> {
  const cached = getCached<T>(key);
  if (cached !== null) return cached;

  if (!isDbAvailable() || !db || !hasModel('systemConfig')) return null;

  const row = await safeDbQuery(() =>
    db!.systemConfig.findUnique({ where: { key } })
  );

  if (!row) return null;

  try {
    const parsed = JSON.parse(row.config) as T;
    setCache(key, parsed);
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Save (upsert) a system config by key to the SystemConfig DB table.
 * Also invalidates the cache for that key.
 */
export async function saveSystemConfig(key: string, config: unknown): Promise<void> {
  if (!isDbAvailable() || !db || !hasModel('systemConfig')) {
    throw new Error('Database is not available');
  }

  await db.systemConfig.upsert({
    where: { key },
    create: { key, config: JSON.stringify(config) },
    update: { config: JSON.stringify(config) },
  });

  invalidateSystemConfigCache(key);
}

// ============================================================
// Specific config helpers
// ============================================================

export interface TradingSystemConfig {
  defaultAdminLevyPercent?: number;
  defaultMaxPositions?: number;
  defaultStopLossPercent?: number;
  defaultTakeProfitPercent?: number;
  defaultMaxPositionSizePercent?: number;
}

/**
 * Get the global admin levy percent from the 'trading' system config.
 * Defaults to 10 if not configured.
 */
export async function getGlobalAdminLevy(): Promise<number> {
  try {
    const config = await getSystemConfig<TradingSystemConfig>('trading');
    return config?.defaultAdminLevyPercent ?? 10;
  } catch {
    return 10;
  }
}
