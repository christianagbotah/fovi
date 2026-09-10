import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const HEALTH = join(ROOT, 'src/app/api/health/route.ts');
const PROXY = join(ROOT, 'src/proxy.ts');
const STAGING = join(ROOT, '.github/workflows/staging-runtime-qualification.yml');

describe('Phase 3AW public health response minimization', () => {
  it('keeps the health endpoint intentionally public for deployment probes', () => {
    const proxy = readFileSync(PROXY, 'utf8');
    expect(proxy).toContain("'/api/health',");
  });

  it('preserves only the readiness fields required by staging qualification', () => {
    const health = readFileSync(HEALTH, 'utf8');
    const staging = readFileSync(STAGING, 'utf8');

    expect(health).toContain("status: allOk ? 'healthy' : 'degraded'");
    expect(health).toContain('checks,');
    expect(health).toContain('checks.database = { ok: true };');
    expect(health).toContain('checks.database = { ok: false };');
    expect(staging).toContain("jq -e '.status == \"healthy\" and .checks.database.ok == true'");
  });

  it('does not expose database error text or deployment fingerprinting details', () => {
    const health = readFileSync(HEALTH, 'utf8');

    expect(health).not.toContain('err.message');
    expect(health).not.toContain('detail:');
    expect(health).not.toContain('latencyMs');
    expect(health).not.toContain('process.uptime()');
    expect(health).not.toContain('npm_package_version');
    expect(health).not.toContain("'DB not connected (demo mode)'");
  });

  it('retains no-store and degraded 503 semantics', () => {
    const health = readFileSync(HEALTH, 'utf8');

    expect(health).toContain("headers: { 'Cache-Control': 'no-store' }");
    expect(health).toContain('status: allOk ? 200 : 503');
  });
});
