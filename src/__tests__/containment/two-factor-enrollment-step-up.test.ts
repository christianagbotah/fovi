import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../..');
const SETUP = resolve(ROOT, 'src/app/api/auth/two-factor/setup/route.ts');
const API_FETCH = resolve(ROOT, 'src/lib/api-fetch.ts');
const STEP_UP = resolve(ROOT, 'src/lib/two-factor-step-up.ts');

describe('Phase 3AH password step-up for 2FA enrollment', () => {
  it('keeps the read-only 2FA status probe ahead of the password requirement', () => {
    const source = readFileSync(SETUP, 'utf8');

    const authIndex = source.indexOf('const bearerToken = extractBearerToken(request);');
    const bodyIndex = source.indexOf('const body = await request.json().catch(() => ({}));');
    const checkIndex = source.indexOf('if (body._check) {', bodyIndex);
    const schemaIndex = source.indexOf('const parsed = setupSchema.safeParse(body);', checkIndex);

    expect(authIndex).toBeGreaterThan(-1);
    expect(bodyIndex).toBeGreaterThan(authIndex);
    expect(checkIndex).toBeGreaterThan(bodyIndex);
    expect(schemaIndex).toBeGreaterThan(checkIndex);
  });

  it('requires and verifies the current password before generating any authenticator secret', () => {
    const source = readFileSync(SETUP, 'utf8');

    expect(source).toContain("import { extractBearerToken, verifyPassword, verifyToken } from '@/lib/auth';");
    expect(source).toContain("currentPassword: z.string().min(1)");
    expect(source).toContain('select: { id: true, email: true, passwordHash: true }');
    expect(source).toContain("{ error: 'Current password is required.' }");
    expect(source).toContain("{ error: 'Current password is incorrect.' }");

    const parseIndex = source.indexOf('const parsed = setupSchema.safeParse(body);');
    const userIndex = source.indexOf('const user = await safeDbQuery', parseIndex);
    const passwordIndex = source.indexOf('!verifyPassword(currentPassword, user.passwordHash)', userIndex);
    const otplibIndex = source.indexOf("const otplib = await import('otplib');", passwordIndex);
    const secretIndex = source.indexOf('const secret = otplib.generateSecret();', otplibIndex);
    const transactionIndex = source.indexOf('db!.$transaction(async (tx) => {', secretIndex);

    expect(userIndex).toBeGreaterThan(parseIndex);
    expect(passwordIndex).toBeGreaterThan(userIndex);
    expect(otplibIndex).toBeGreaterThan(passwordIndex);
    expect(secretIndex).toBeGreaterThan(otplibIndex);
    expect(transactionIndex).toBeGreaterThan(secretIndex);
  });

  it('collects the password only in an ephemeral masked browser dialog', () => {
    const source = readFileSync(STEP_UP, 'utf8');

    expect(source).toContain("input.type = 'password';");
    expect(source).toContain("input.autocomplete = 'current-password';");
    expect(source).toContain("input.name = 'currentPassword';");
    expect(source).toContain("body: JSON.stringify({ currentPassword })");
    expect(source).toContain("input.value = '';");
    expect(source).toContain('dialog.remove();');
    expect(source).not.toContain('localStorage');
    expect(source).not.toContain('sessionStorage');
  });

  it('does not interfere with the existing {_check:true} status request', () => {
    const source = readFileSync(STEP_UP, 'utf8');

    expect(source).toContain('return options.body == null;');
    expect(source).toContain("if (!url.includes('/api/auth/two-factor/setup')) return false;");
    expect(source).toContain("if ((options.method || 'GET').toUpperCase() !== 'POST') return false;");
  });

  it('prepares step-up before network transmission and reuses the prepared body for an auth refresh retry', () => {
    const source = readFileSync(API_FETCH, 'utf8');

    const prepareIndex = source.indexOf('const prepared = await prepareTwoFactorStepUp(url, options);');
    const cancelIndex = source.indexOf('if (prepared.cancelled) {', prepareIndex);
    const optionsIndex = source.indexOf('const requestOptions = prepared.options;', cancelIndex);
    const firstFetchIndex = source.indexOf('let res = await fetch(url, {', optionsIndex);
    const retryIndex = source.indexOf('res = await fetch(url, {', firstFetchIndex + 1);

    expect(prepareIndex).toBeGreaterThan(-1);
    expect(cancelIndex).toBeGreaterThan(prepareIndex);
    expect(optionsIndex).toBeGreaterThan(cancelIndex);
    expect(firstFetchIndex).toBeGreaterThan(optionsIndex);
    expect(retryIndex).toBeGreaterThan(firstFetchIndex);
    expect(source.slice(firstFetchIndex, retryIndex)).toContain('...requestOptions');
    expect(source.slice(retryIndex)).toContain('...requestOptions');
  });
});
