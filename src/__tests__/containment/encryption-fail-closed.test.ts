// ============================================================
// Containment behavioral tests — encryption fail-closed (Req 5)
// Tests that production never uses a repository-known fallback key.
// The module throws at load time in production (like auth.ts).
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ORIGINAL_ENV = process.env;

describe('encryption fail-closed in production', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('fails to import when ENCRYPTION_KEY is absent in production', async () => {
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'production',
    };
    delete process.env.ENCRYPTION_KEY;
    await expect(import('@/lib/encryption')).rejects.toThrow('ENCRYPTION_KEY is not set');
  });

  it('fails to import when ENCRYPTION_KEY is too short in production', async () => {
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'production',
      ENCRYPTION_KEY: 'short',
    };
    await expect(import('@/lib/encryption')).rejects.toThrow('ENCRYPTION_KEY is too short');
  });

  it('does NOT fail to import in test mode when ENCRYPTION_KEY is absent', async () => {
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
    };
    delete process.env.ENCRYPTION_KEY;
    const enc = await import('@/lib/encryption');
    expect(typeof enc.encrypt).toBe('function');
    expect(typeof enc.decrypt).toBe('function');
  });

  it('imports successfully with a valid ENCRYPTION_KEY in production', async () => {
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'production',
      ENCRYPTION_KEY: 'a'.repeat(32),
    };
    const enc = await import('@/lib/encryption');
    expect(typeof enc.encrypt).toBe('function');
    expect(typeof enc.decrypt).toBe('function');
  });

  it('adversarial: production with exactly 31 chars should fail', async () => {
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'production',
      ENCRYPTION_KEY: 'a'.repeat(31),
    };
    await expect(import('@/lib/encryption')).rejects.toThrow('ENCRYPTION_KEY is too short');
  });

  it('adversarial: production with empty ENCRYPTION_KEY should fail', async () => {
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'production',
      ENCRYPTION_KEY: '',
    };
    await expect(import('@/lib/encryption')).rejects.toThrow('ENCRYPTION_KEY is not set');
  });

  it('adversarial: production with whitespace-only ENCRYPTION_KEY should fail', async () => {
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'production',
      ENCRYPTION_KEY: '   ',
    };
    await expect(import('@/lib/encryption')).rejects.toThrow('ENCRYPTION_KEY is too short');
  });
});
