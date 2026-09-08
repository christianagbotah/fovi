import { NextRequest } from 'next/server';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Keep attacker-controlled forwarded-address cardinality from growing the
// process-local limiter map without bound. When capacity is exhausted, new
// keys fail closed until expired entries are reclaimed.
const MAX_RATE_LIMIT_ENTRIES = 10_000;
const MAX_CLIENT_IP_LENGTH = 64;
const IP_LITERAL_PATTERN = /^[0-9a-f:.]+$/i;

// Auto-cleanup expired entries every 5 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let _cleanupTimer: ReturnType<typeof setInterval> | null = null;

function cleanupExpiredEntries(now: number): void {
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) store.delete(key);
  }
}

function ensureCleanup() {
  if (_cleanupTimer) return;
  _cleanupTimer = setInterval(() => {
    cleanupExpiredEntries(Date.now());
  }, CLEANUP_INTERVAL_MS);
  // Don't prevent the process from exiting
  if (typeof _cleanupTimer === 'object' && 'unref' in _cleanupTimer) {
    _cleanupTimer.unref();
  }
}

function normalizeClientIp(value: string | null | undefined): string | null {
  if (!value) return null;
  const candidate = value.trim();
  if (
    !candidate ||
    candidate.length > MAX_CLIENT_IP_LENGTH ||
    !IP_LITERAL_PATTERN.test(candidate)
  ) {
    return null;
  }
  return candidate.toLowerCase();
}

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const forwardedIp = normalizeClientIp(forwarded.split(',')[0]);
    if (forwardedIp) return forwardedIp;
  }

  const realIp = normalizeClientIp(request.headers.get('x-real-ip'));
  if (realIp) return realIp;
  return 'unknown';
}

function canAllocateNewKey(now: number): boolean {
  if (store.size < MAX_RATE_LIMIT_ENTRIES) return true;
  cleanupExpiredEntries(now);
  return store.size < MAX_RATE_LIMIT_ENTRIES;
}

export function rateLimit(options: {
  windowMs: number;
  maxRequests: number;
  keyPrefix: string;
}) {
  const { windowMs, maxRequests, keyPrefix } = options;

  return function check(
    request: NextRequest
  ):
    | { allowed: true; remaining: number; resetAt: number }
    | { allowed: false; retryAfterMs: number } {
    ensureCleanup();

    const ip = getClientIp(request);
    const key = `${keyPrefix}:${ip}`;
    const now = Date.now();

    const entry = store.get(key);

    if (!entry || entry.resetAt <= now) {
      if (!entry && !canAllocateNewKey(now)) {
        return { allowed: false, retryAfterMs: windowMs };
      }

      const resetAt = now + windowMs;
      store.set(key, { count: 1, resetAt });
      return { allowed: true, remaining: maxRequests - 1, resetAt };
    }

    entry.count += 1;

    if (entry.count > maxRequests) {
      return {
        allowed: false,
        retryAfterMs: entry.resetAt - now,
      };
    }

    return {
      allowed: true,
      remaining: maxRequests - entry.count,
      resetAt: entry.resetAt,
    };
  };
}
