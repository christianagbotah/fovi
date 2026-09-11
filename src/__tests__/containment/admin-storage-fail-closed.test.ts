import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../..');
const USERS = resolve(ROOT, 'src/app/api/admin/users/route.ts');
const USER = resolve(ROOT, 'src/app/api/admin/users/[id]/route.ts');
const SUBSCRIPTIONS = resolve(ROOT, 'src/app/api/admin/subscriptions/route.ts');

describe('Phase 3AZ admin storage fail-closed semantics', () => {
  it('does not turn unavailable user storage into a successful empty list', () => {
    const source = readFileSync(USERS, 'utf8');

    expect(source).toContain("{ error: 'User storage is unavailable.' }");
    expect(source).toContain('{ status: 503 }');
    expect(source).toContain('const users = await db.user.findMany');
    expect(source).not.toContain('safeDbQuery');
    expect(source).not.toContain('{ users: [] }');
    expect(source).not.toContain('users || []');
  });

  it('distinguishes privileged user lookup failure from a genuine 404', () => {
    const source = readFileSync(USER, 'utf8');

    expect(source).toContain('const user = await db.user.findUnique({ where: { id } });');
    expect(source).toContain("{ error: 'User storage is unavailable.' }, { status: 503 }");
    expect(source).toContain("{ error: 'User not found.' }, { status: 404 }");
    expect(source).not.toContain('safeDbQuery');
  });

  it('does not turn unavailable subscription storage into empty business data', () => {
    const source = readFileSync(SUBSCRIPTIONS, 'utf8');

    expect(source).toContain("{ error: 'Subscription storage is unavailable.' }");
    expect(source).toContain('const subscriptions = await db.subscription.findMany');
    expect(source).not.toContain('{ subscriptions: [] }');
    expect(source).not.toContain('subscriptions || []');
  });

  it('does not collapse plan/user query failures or durable invoice writes through safeDbQuery', () => {
    const source = readFileSync(SUBSCRIPTIONS, 'utf8');

    expect(source).toContain('const plan = await db.subscriptionPlan.findUnique');
    expect(source).toContain('const user = await db.user.findUnique');
    expect(source).toContain('await db.subscription.update({');
    expect(source).not.toContain('safeDbQuery');
  });
});