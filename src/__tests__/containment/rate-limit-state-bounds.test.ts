import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RATE_LIMIT = resolve(__dirname, '../../../src/lib/rate-limit.ts');

function source(): string {
  return readFileSync(RATE_LIMIT, 'utf8');
}

describe('Phase 3AQ bounded generic rate-limit state', () => {
  it('bounds attacker-controlled limiter key cardinality and fails closed at capacity', () => {
    const code = source();

    expect(code).toContain('const MAX_RATE_LIMIT_ENTRIES = 10_000;');
    expect(code).toContain('function canAllocateNewKey(now: number): boolean');
    expect(code).toContain('cleanupExpiredEntries(now);');
    expect(code).toContain('if (!entry && !canAllocateNewKey(now))');
    expect(code).toContain('return { allowed: false, retryAfterMs: windowMs };');

    const capacityCheck = code.indexOf('if (!entry && !canAllocateNewKey(now))');
    const storeWrite = code.indexOf('store.set(key, { count: 1, resetAt });', capacityCheck);
    expect(capacityCheck).toBeGreaterThan(-1);
    expect(storeWrite).toBeGreaterThan(capacityCheck);
  });

  it('bounds and normalizes forwarded address keys before using them', () => {
    const code = source();

    expect(code).toContain('const MAX_CLIENT_IP_LENGTH = 64;');
    expect(code).toContain('const IP_LITERAL_PATTERN = /^[0-9a-f:.]+$/i;');
    expect(code).toContain('candidate.length > MAX_CLIENT_IP_LENGTH');
    expect(code).toContain('!IP_LITERAL_PATTERN.test(candidate)');
    expect(code).toContain('return candidate.toLowerCase();');
    expect(code).toContain("normalizeClientIp(forwarded.split(',')[0])");
    expect(code).toContain("normalizeClientIp(request.headers.get('x-real-ip'))");
    expect(code).toContain("return 'unknown';");
  });

  it('reuses one cleanup path for periodic cleanup and capacity reclamation', () => {
    const code = source();
    const helper = code.indexOf('function cleanupExpiredEntries(now: number): void');
    const periodic = code.indexOf('cleanupExpiredEntries(Date.now());', helper);
    const capacity = code.indexOf('cleanupExpiredEntries(now);', periodic);

    expect(helper).toBeGreaterThan(-1);
    expect(periodic).toBeGreaterThan(helper);
    expect(capacity).toBeGreaterThan(periodic);
  });
});
