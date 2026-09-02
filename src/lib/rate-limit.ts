import { NextRequest } from 'next/server';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

type RateLimitResult =
  | { allowed: true; remaining: number; resetAt: number }
  | { allowed: false; retryAfterMs: number };

const store = new Map<string, RateLimitEntry>();

// Auto-cleanup expired entries every 5 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let _cleanupTimer: ReturnType<typeof setInterval> | null = null;

function ensureCleanup() {
  if (_cleanupTimer) return;
  _cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.resetAt <= now) store.delete(key);
    }
  }, CLEANUP_INTERVAL_MS);
  // Don't prevent the process from exiting
  if (typeof _cleanupTimer === 'object' && 'unref' in _cleanupTimer) {
    _cleanupTimer.unref();
  }
}

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  return 'unknown';
}

function consumeRateLimit(
  key: string,
  windowMs: number,
  maxRequests: number,
): RateLimitResult {
  ensureCleanup();

  const now = Date.now();
  const entry = store.get(key);

  if (!entry || entry.resetAt <= now) {
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
}

export function rateLimit(options: {
  windowMs: number;
  maxRequests: number;
  keyPrefix: string;
}) {
  const { windowMs, maxRequests, keyPrefix } = options;

  return function check(request: NextRequest): RateLimitResult {
    const ip = getClientIp(request);
    return consumeRateLimit(`${keyPrefix}:ip:${ip}`, windowMs, maxRequests);
  };
}

/**
 * Secondary limiter for authenticated identities or normalized recovery targets.
 * Use this in addition to the request/IP limiter so one account or destination
 * cannot bypass throttling simply by changing source IPs.
 */
export function rateLimitByKey(options: {
  windowMs: number;
  maxRequests: number;
  keyPrefix: string;
}) {
  const { windowMs, maxRequests, keyPrefix } = options;

  return function check(identity: string): RateLimitResult {
    const normalized = identity.trim().toLowerCase();
    return consumeRateLimit(`${keyPrefix}:identity:${normalized}`, windowMs, maxRequests);
  };
}
