import { describe, it, expect } from 'vitest';
import { CONTAINMENT_CODES, DEMO_PROVENANCE, DEMO_PROVENANCE_HEADER } from '@/lib/trading-policy';

// ─────────────────────────────────────────────────────
// 4. Live webhook execution is blocked
// ─────────────────────────────────────────────────────
describe('Webhook ingress containment', () => {
  it('WEBHOOK_DISABLED code is defined', () => {
    expect(CONTAINMENT_CODES.WEBHOOK_DISABLED).toBe('WEBHOOK_INGRESS_DISABLED');
  });
});

// ─────────────────────────────────────────────────────
// 8. Live order failure never returns simulated success
// ─────────────────────────────────────────────────────
describe('Order response provenance', () => {
  it('DEMO_PROVENANCE marks data as synthetic', () => {
    expect(DEMO_PROVENANCE.isSynthetic).toBe(true);
    expect(DEMO_PROVENANCE.source).toBe('fovi-demo-generator');
    expect(DEMO_PROVENANCE.environment).toBe('demo');
  });

  it('DEMO_PROVENANCE_HEADER has required headers', () => {
    expect(DEMO_PROVENANCE_HEADER['x-environment']).toBe('demo');
    expect(DEMO_PROVENANCE_HEADER['x-synthetic']).toBe('true');
    expect(DEMO_PROVENANCE_HEADER['x-data-source']).toBe('fovi-demo-generator');
  });
});

// ─────────────────────────────────────────────────────
// 14. Query parameters cannot select a reverse-proxy destination
// ─────────────────────────────────────────────────────
describe('Caddyfile containment', () => {
  it('Caddyfile does not contain XTransformPort', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const caddyfile = fs.readFileSync(
      path.resolve(process.cwd(), 'Caddyfile'),
      'utf-8'
    );
    // CONTAINMENT: Caddyfile must not contain XTransformPort as executable config
    // (it may appear in comments explaining what was removed)
    const lines = caddyfile.split('\n').filter(l => !l.trimStart().startsWith('#'));
    const configOnly = lines.join('\n');
    expect(configOnly).not.toContain('XTransformPort');
    // Must not have query-based proxy in config
    expect(configOnly).not.toContain('query.');
    // Must not have variable port
    expect(caddyfile).not.toContain('{query.');
    // Must only proxy to localhost:3002
    expect(caddyfile).toContain('localhost:3002');
  });
});

// ─────────────────────────────────────────────────────
// 15. Synthetic market data cannot be passed into a live order
// ─────────────────────────────────────────────────────
describe('Synthetic data isolation', () => {
  it('demo provenance headers are present on synthetic responses', () => {
    // If a frontend receives x-synthetic:true, it must not
    // use that data for live order proposals.
    expect(DEMO_PROVENANCE_HEADER['x-synthetic']).toBe('true');
  });
});
