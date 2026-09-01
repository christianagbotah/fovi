import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { revokeAllAuthSessionsForUser } from '@/lib/auth-session-revocation';

function source(path: string): string {
  return readFileSync(resolve(__dirname, path), 'utf8');
}

const changePassword = source('../../../src/app/api/auth/change-password/route.ts');
const resetPassword = source('../../../src/app/api/auth/reset-password/route.ts');
const adminUser = source('../../../src/app/api/admin/users/[id]/route.ts');
const apiFetch = source('../../../src/lib/api-fetch.ts');
const schema = source('../../../prisma/schema.prisma');

describe('Phase 3K credential-change session invalidation', () => {
  it('revokes only active refresh sessions for the target user with an explicit reason', async () => {
    const now = new Date('2026-09-01T00:00:00.000Z');
    const calls: unknown[] = [];
    const client = {
      authSession: {
        updateMany: async (args: unknown) => {
          calls.push(args);
          return { count: 3 };
        },
      },
    } as Parameters<typeof revokeAllAuthSessionsForUser>[0];

    const count = await revokeAllAuthSessionsForUser(client, 'user-123', 'PASSWORD_CHANGED', now);

    expect(count).toBe(3);
    expect(calls).toEqual([
      {
        where: { userId: 'user-123', revokedAt: null },
        data: { revokedAt: now, revokeReason: 'PASSWORD_CHANGED' },
      },
    ]);
  });

  it('changes a user password and revokes all refresh sessions atomically', () => {
    expect(changePassword).toContain('db!.$transaction(async (tx) =>');
    expect(changePassword).toContain("revokeAllAuthSessionsForUser(tx, user.id, 'PASSWORD_CHANGED')");
    expect(changePassword).toContain("'x-auth-session-invalidated': 'true'");
    expect(changePassword).toContain('clearRefreshCookie(response)');
    expect(changePassword).toContain("hasModel('authSession')");
  });

  it('completes reset-token password changes and session revocation in one transaction', () => {
    expect(resetPassword).toContain('db!.$transaction(async (tx) =>');
    expect(resetPassword).toContain("revokeAllAuthSessionsForUser(tx, user.id, 'PASSWORD_RESET')");
    expect(resetPassword).toContain('resetToken: null');
    expect(resetPassword).toContain('resetTokenExpiry: null');
    expect(resetPassword).toContain('clearRefreshCookie(response)');
    expect(resetPassword).toContain("hasModel('authSession')");
  });

  it('revokes sessions for admin password reset and every deactivation path', () => {
    expect(adminUser).toContain("revokeAllAuthSessionsForUser(tx, id, 'ADMIN_PASSWORD_RESET')");
    expect(adminUser.match(/revokeAllAuthSessionsForUser\(tx, id, 'ACCOUNT_INACTIVE'\)/g)?.length).toBe(2);
    expect(adminUser.match(/db\.\$transaction\(async \(tx\) =>/g)?.length).toBeGreaterThanOrEqual(3);
    expect(adminUser).toContain("hasModel('authSession')");
  });

  it('relies on database cascade to eliminate sessions on hard user deletion', () => {
    expect(schema).toContain('authSessions   AuthSession[]');
    expect(schema).toMatch(/user\s+User\s+@relation\(fields: \[userId\], references: \[id\], onDelete: Cascade\)/);
    expect(adminUser).toContain('await db.user.delete({ where: { id } })');
  });

  it('drops the current browser access token after self credential invalidation', () => {
    expect(apiFetch).toContain("res.headers.get('x-auth-session-invalidated') === 'true'");
    expect(apiFetch).toContain('clearBrowserAccessState();');
  });
});
