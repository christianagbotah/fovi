// ============================================================
// Containment behavioral tests — auth secrets (Req 12)
// Tests that missing production secrets fail closed.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ORIGINAL_ENV = process.env;

describe('auth secrets production safety', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('fails to import when JWT_SECRET is absent in production', async () => {
    process.env = { ...ORIGINAL_ENV, NODE_ENV: 'production', AUTH_PEPPER: 'a'.repeat(16) };
    delete process.env.JWT_SECRET;
    await expect(import('@/lib/auth')).rejects.toThrow();
  });

  it('fails to import when AUTH_PEPPER is absent in production', async () => {
    process.env = { ...ORIGINAL_ENV, NODE_ENV: 'production', JWT_SECRET: 'b'.repeat(32) };
    delete process.env.AUTH_PEPPER;
    await expect(import('@/lib/auth')).rejects.toThrow();
  });

  it('fails to import when JWT_SECRET is too short', async () => {
    process.env = { ...ORIGINAL_ENV, NODE_ENV: 'production', AUTH_PEPPER: 'a'.repeat(16), JWT_SECRET: 'short' };
    await expect(import('@/lib/auth')).rejects.toThrow();
  });

  it('fails to import when AUTH_PEPPER is too short', async () => {
    process.env = { ...ORIGINAL_ENV, NODE_ENV: 'production', JWT_SECRET: 'b'.repeat(32), AUTH_PEPPER: 'tiny' };
    await expect(import('@/lib/auth')).rejects.toThrow();
  });
});

describe('auth token operations with test env', () => {
  let auth: typeof import('@/lib/auth');
  const TEST_JWT = 'test-jwt-secret-32chars-minimum!!';
  const TEST_PEPPER = 'test-pepper-16chars-minimum';

  beforeEach(async () => {
    vi.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
      JWT_SECRET: TEST_JWT,
      AUTH_PEPPER: TEST_PEPPER,
      ENABLE_DEMO_AUTH: 'true',
    };
    auth = await import('@/lib/auth');
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('can generate and verify an explicitly enabled local demo access token', async () => {
    const token = await auth.generateAccessToken(
      'demo-user',
      'demo@fovi.ai',
      auth.LOCAL_DEMO_SESSION_FAMILY,
      'Demo User',
    );
    expect(token).toBeDefined();
    const payload = await auth.verifyToken(token);
    expect(payload).not.toBeNull();
    expect(payload!.sub).toBe('demo-user');
    expect(payload!.type).toBe('access');
    if (payload && payload.type === 'access') {
      expect(payload.email).toBe('demo@fovi.ai');
      expect(payload.sid).toBe(auth.LOCAL_DEMO_SESSION_FAMILY);
    }
  });

  it('does not expose legacy stateless refresh-token minting', () => {
    expect('generateRefreshToken' in auth).toBe(false);
  });

  it('rejects invalid token', async () => {
    const payload = await auth.verifyToken('not-a-valid-token');
    expect(payload).toBeNull();
  });

  it('rejects token signed with wrong secret', async () => {
    const { SignJWT } = await import('jose');
    const token = await new SignJWT({ sub: 'user1', type: 'access', sid: 'fake-family' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('wrong-secret-value-32chars!!'));
    const payload = await auth.verifyToken(token);
    expect(payload).toBeNull();
  });

  it('environment changes do not leak between tests', async () => {
    const token = await auth.generateAccessToken(
      'demo-user',
      'demo@fovi.ai',
      auth.LOCAL_DEMO_SESSION_FAMILY,
      'Demo User',
    );
    const payload = await auth.verifyToken(token);
    expect(payload!.sub).toBe('demo-user');
  });
});
