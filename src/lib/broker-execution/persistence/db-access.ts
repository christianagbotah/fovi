// ============================================================
// db-access.ts — Fail-closed database access for the
// broker-execution boundary.
//
// SECURITY CONTRACT:
//   - requireDb() NEVER returns null: an unavailable database
//     throws ServiceUnavailableError (fail-closed). Components
//     in this boundary must NOT silently fall back to in-memory
//     state — security-relevant truth lives in PostgreSQL only.
//   - isUniqueViolation() identifies Prisma P2002 errors, used
//     by the atomic idempotency claim.
//   - isDbUnavailableError() classifies connection/runtime DB
//     failures so routes can map them to 503 without leaking
//     internals.
// ============================================================

import { db, isDbAvailable } from '@/lib/db';

/** Thrown when the authoritative PostgreSQL store cannot be reached. Fail-closed. */
export class ServiceUnavailableError extends Error {
  readonly code = 'SERVICE_UNAVAILABLE';

  constructor(component: string, detail?: string) {
    super(
      `Fail-closed: the authoritative PostgreSQL store is unavailable for ${component}.` +
        (detail ? ` (${detail})` : ''),
    );
    this.name = 'ServiceUnavailableError';
  }
}

/** Prisma-shaped known request error (code-carrying). */
interface PrismaKnownErrorShape {
  code?: string;
  message?: string;
}

/** Prisma client handle type (never null when returned from requireDb). */
type DbClient = NonNullable<typeof db>;

/**
 * Return the Prisma client or throw ServiceUnavailableError.
 * All broker-execution persistence MUST go through this gate.
 */
export function requireDb(component: string): DbClient {
  if (!db || !isDbAvailable()) {
    throw new ServiceUnavailableError(component, 'Prisma client is not initialized');
  }
  return db;
}

/**
 * True when the error is a Prisma unique-constraint violation (P2002).
 * Used to implement atomic "exactly one record wins" semantics.
 */
export function isUniqueViolation(error: unknown): boolean {
  const candidate = error as PrismaKnownErrorShape | null;
  return !!candidate && typeof candidate.code === 'string' && candidate.code === 'P2002';
}

/**
 * True when the error represents an unavailable/failed database
 * (connection refused, timeout, engine runtime failure, or an
 * explicit fail-closed unavailability signal such as
 * ServiceUnavailableError / KillSwitchEvaluationUnavailableError).
 * Routes map this to 503.
 */
export function isDbUnavailableError(error: unknown): boolean {
  if (error instanceof ServiceUnavailableError) return true;
  const candidate = error as PrismaKnownErrorShape | null;
  if (!candidate) return false;
  const code = typeof candidate.code === 'string' ? candidate.code : '';
  // Explicit fail-closed unavailability signals from this boundary
  if (code === 'SERVICE_UNAVAILABLE' || code === 'KILL_SWITCH_UNAVAILABLE') return true;
  // Prisma connection/initialization error codes: P1001..P1008, P1014, P1017
  if (/^P10(0[1-8]|1[47])$/.test(code)) return true;
  const message = typeof candidate.message === 'string' ? candidate.message : '';
  return /database|connection|timeout|unavailable/i.test(message) && code.startsWith('P1');
}

/**
 * Map a persistence-layer failure to an HTTP status code.
 * 503 for unavailable DB, 500 otherwise. Never leaks internals.
 */
export function persistenceErrorStatus(error: unknown): 500 | 503 {
  return isDbUnavailableError(error) ? 503 : 500;
}
