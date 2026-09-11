import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../..');
const NEXT_CONFIG = resolve(ROOT, 'next.config.ts');

describe('Phase 3AY baseline application security headers', () => {
  it('applies the baseline policy at the application layer for every path', () => {
    const source = readFileSync(NEXT_CONFIG, 'utf8');

    expect(source).toContain('async headers()');
    expect(source).toContain('source: "/:path*"');
    expect(source).toContain('headers: securityHeaders.map');
  });

  it.each([
    ['X-Content-Type-Options', 'nosniff'],
    ['X-Frame-Options', 'DENY'],
    ['Referrer-Policy', 'strict-origin-when-cross-origin'],
    ['Permissions-Policy', 'camera=(), microphone=(), geolocation=()'],
    ['Strict-Transport-Security', 'max-age=31536000'],
    ['X-DNS-Prefetch-Control', 'off'],
  ] as const)('declares %s with the intended value', (key, value) => {
    const source = readFileSync(NEXT_CONFIG, 'utf8');
    expect(source).toContain(`key: "${key}"`);
    expect(source).toContain(`value: "${value}"`);
  });

  it('suppresses the framework disclosure header', () => {
    const source = readFileSync(NEXT_CONFIG, 'utf8');
    expect(source).toContain('poweredByHeader: false');
  });

  it('does not pretend CSP is qualified before client and websocket sources are inventoried', () => {
    const source = readFileSync(NEXT_CONFIG, 'utf8');
    expect(source).not.toContain('Content-Security-Policy');
    expect(source).not.toContain('Content-Security-Policy-Report-Only');
  });
});