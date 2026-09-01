import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  AUTH_SESSION_POST_EXPIRY_RETENTION_MS,
  authSessionCleanupCutoff,
  cleanupExpiredAuthSessionHistory,
} from '@/lib/auth-session-retention';

const authSessionsSource = readFileSync(
  resolve(__dirname, '../../../src/lib/auth-sessions.ts'),
  'utf8',
);

describe('Phase 3L refresh-session retention', () => {
  it('retains session-family history for 30 days beyond absolute expiry', () => {
    expect(AUTH_SESSION_POST_EXPIRY_RETENTION_MS).toBe(30 * 24 * 60 * 60 * 1000);

    const now = new Date('2026-09-01T12:00:00.000Z');
    expect(authSessionCleanupCutoff(now).toISOString()).toBe('2026-08-02T12:00:00.000Z');
  });

  it('deletes only rows whose absolute expiry is older than the retention cutoff', async () => {
    const calls: unknown[] = [];
    const client = {
      authSession: {
        deleteMany: async (args: unknown) => {
          calls.push(args);
          return { count: 17 };
        },
      },
    } as Parameters<typeof cleanupExpiredAuthSessionHistory>[0];
    const now = new Date('2026-09-01T12:00:00.000Z');

    const count = await cleanupExpiredAuthSessionHistory(client, now);

    expect(count).toBe(17);
    expect(calls).toEqual([
      {
        where: {
          expiresAt: { lt: new Date('2026-08-02T12:00:00.000Z') },
        },
      },
    ]);
  });

  it('runs cleanup from both session creation and rotation but throttles attempts', () => {
    expect(authSessionsSource).toContain('const AUTH_SESSION_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;');
    expect(authSessionsSource).toContain('if (nowMs < nextAuthSessionCleanupAt) return;');
    expect(authSessionsSource).toContain('nextAuthSessionCleanupAt = nowMs + AUTH_SESSION_CLEANUP_INTERVAL_MS;');
    expect(authSessionsSource.match(/await maybeCleanupExpiredAuthSessions\(\);/g)?.length).toBe(2);
  });

  it('keeps retention cleanup best-effort so authentication never fails because of housekeeping', () => {
    expect(authSessionsSource).toContain('Retention cleanup is best-effort and must never interrupt authentication.');
    expect(authSessionsSource).toContain('await cleanupExpiredAuthSessionHistory(db, new Date(nowMs));');
  });
});
