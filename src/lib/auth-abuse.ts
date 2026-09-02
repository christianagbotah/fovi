import { createHmac } from 'crypto';
import { db, hasModel, isDbAvailable } from '@/lib/db';

const SIGNIN_ABUSE_PREFIX = 'auth-abuse:signin:';
const TWO_FACTOR_ABUSE_PREFIX = 'auth-abuse:two-factor:';
const PASSWORD_RECOVERY_ABUSE_PREFIX = 'auth-abuse:password-recovery:';
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const COOLDOWN_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const RETENTION_MS = 24 * 60 * 60 * 1000;

type StoredSigninAbuseState = {
  failedAttempts: number;
  windowStartedAt: string;
  lockedUntil: string | null;
};

export type AuthAbuseStatus =
  | { available: true; locked: false }
  | { available: true; locked: true; retryAfterMs: number }
  | { available: false; locked: true; retryAfterMs: number };

export type SigninAbuseStatus = AuthAbuseStatus;

function getPepper(): string {
  const pepper = process.env.AUTH_PEPPER;
  if (!pepper || pepper.length < 16) {
    throw new Error('AUTH_PEPPER is required for authentication abuse controls.');
  }
  return pepper;
}

function abuseKey(prefix: string, identifier: string): string {
  const normalized = identifier.toLowerCase().trim();
  const digest = createHmac('sha256', getPepper()).update(normalized).digest('hex');
  return `${prefix}${digest}`;
}

function parseState(config: string): StoredSigninAbuseState | null {
  try {
    const parsed = JSON.parse(config) as Partial<StoredSigninAbuseState>;
    if (
      typeof parsed.failedAttempts !== 'number' ||
      typeof parsed.windowStartedAt !== 'string' ||
      (parsed.lockedUntil !== null && typeof parsed.lockedUntil !== 'string')
    ) {
      return null;
    }
    return parsed as StoredSigninAbuseState;
  } catch {
    return null;
  }
}

function unavailableStatus(): AuthAbuseStatus {
  return { available: false, locked: true, retryAfterMs: 60_000 };
}

async function getAbuseStatus(prefix: string, identifier: string): Promise<AuthAbuseStatus> {
  if (!isDbAvailable() || !db || !hasModel('systemConfig')) {
    return unavailableStatus();
  }

  try {
    const row = await db.systemConfig.findUnique({ where: { key: abuseKey(prefix, identifier) } });
    if (!row) return { available: true, locked: false };

    const state = parseState(row.config);
    if (!state?.lockedUntil) return { available: true, locked: false };

    const retryAfterMs = new Date(state.lockedUntil).getTime() - Date.now();
    if (retryAfterMs <= 0) return { available: true, locked: false };

    return { available: true, locked: true, retryAfterMs };
  } catch {
    return unavailableStatus();
  }
}

async function recordAbuseFailure(prefix: string, identifier: string): Promise<AuthAbuseStatus> {
  if (!isDbAvailable() || !db || !hasModel('systemConfig')) {
    return unavailableStatus();
  }

  const key = abuseKey(prefix, identifier);

  try {
    const status = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;

      const now = new Date();
      const existing = await tx.systemConfig.findUnique({ where: { key } });
      const state = existing ? parseState(existing.config) : null;
      const windowStartedAt = state ? new Date(state.windowStartedAt) : null;
      const existingLock = state?.lockedUntil ? new Date(state.lockedUntil) : null;

      if (existingLock && existingLock.getTime() > now.getTime()) {
        return {
          available: true as const,
          locked: true as const,
          retryAfterMs: existingLock.getTime() - now.getTime(),
        };
      }

      const windowExpired = !windowStartedAt || now.getTime() - windowStartedAt.getTime() >= FAILURE_WINDOW_MS;
      const failedAttempts = windowExpired ? 1 : (state?.failedAttempts ?? 0) + 1;
      const nextWindowStartedAt = windowExpired ? now : (windowStartedAt ?? now);
      const lockedUntil = failedAttempts >= MAX_FAILURES
        ? new Date(now.getTime() + COOLDOWN_MS)
        : null;

      const nextState: StoredSigninAbuseState = {
        failedAttempts,
        windowStartedAt: nextWindowStartedAt.toISOString(),
        lockedUntil: lockedUntil?.toISOString() ?? null,
      };

      await tx.systemConfig.upsert({
        where: { key },
        create: { key, config: JSON.stringify(nextState) },
        update: { config: JSON.stringify(nextState) },
      });

      if (lockedUntil) {
        return {
          available: true as const,
          locked: true as const,
          retryAfterMs: lockedUntil.getTime() - now.getTime(),
        };
      }

      return { available: true as const, locked: false as const };
    });

    void db.systemConfig.deleteMany({
      where: {
        key: { startsWith: prefix },
        updatedAt: { lt: new Date(Date.now() - RETENTION_MS) },
      },
    }).catch(() => undefined);

    return status;
  } catch {
    return unavailableStatus();
  }
}

async function clearAbuseFailures(prefix: string, identifier: string): Promise<boolean> {
  if (!isDbAvailable() || !db || !hasModel('systemConfig')) return false;

  try {
    await db.systemConfig.deleteMany({ where: { key: abuseKey(prefix, identifier) } });
    return true;
  } catch {
    return false;
  }
}

export function getSigninAbuseStatus(identifier: string): Promise<AuthAbuseStatus> {
  return getAbuseStatus(SIGNIN_ABUSE_PREFIX, identifier);
}

export function recordSigninFailure(identifier: string): Promise<AuthAbuseStatus> {
  return recordAbuseFailure(SIGNIN_ABUSE_PREFIX, identifier);
}

export function clearSigninFailures(identifier: string): Promise<boolean> {
  return clearAbuseFailures(SIGNIN_ABUSE_PREFIX, identifier);
}

export function getTwoFactorAbuseStatus(userId: string): Promise<AuthAbuseStatus> {
  return getAbuseStatus(TWO_FACTOR_ABUSE_PREFIX, userId);
}

export function recordTwoFactorFailure(userId: string): Promise<AuthAbuseStatus> {
  return recordAbuseFailure(TWO_FACTOR_ABUSE_PREFIX, userId);
}

export function clearTwoFactorFailures(userId: string): Promise<boolean> {
  return clearAbuseFailures(TWO_FACTOR_ABUSE_PREFIX, userId);
}

export function getPasswordRecoveryAbuseStatus(email: string): Promise<AuthAbuseStatus> {
  return getAbuseStatus(PASSWORD_RECOVERY_ABUSE_PREFIX, email);
}

export function recordPasswordRecoveryRequest(email: string): Promise<AuthAbuseStatus> {
  return recordAbuseFailure(PASSWORD_RECOVERY_ABUSE_PREFIX, email);
}
