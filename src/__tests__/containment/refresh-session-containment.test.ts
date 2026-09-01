import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const refreshRoute = readFileSync(
  resolve(__dirname, '../../../src/app/api/auth/refresh/route.ts'),
  'utf8',
);

describe('Phase 3E refresh-session containment', () => {
  it('fails closed until revocable server-side refresh sessions exist', () => {
    expect(refreshRoute).toContain("code: 'REFRESH_SESSIONS_DISABLED'");
    expect(refreshRoute).toContain("remediationPhase: 'session-hardening'");
    expect(refreshRoute).toContain('{ status: 503 }');
  });

  it('does not verify or mint stateless JWT refresh credentials', () => {
    expect(refreshRoute).not.toContain('verifyToken');
    expect(refreshRoute).not.toContain('generateAccessToken');
    expect(refreshRoute).not.toContain('generateRefreshToken');
    expect(refreshRoute).not.toContain('refreshToken');
  });
});
