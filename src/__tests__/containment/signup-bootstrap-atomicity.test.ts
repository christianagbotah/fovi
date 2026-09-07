import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SIGNUP_ROUTE = resolve(__dirname, '../../../src/app/api/auth/signup/route.ts');

describe('Phase 3AB atomic signup bootstrap', () => {
  it('requires both user and userSettings models before registration', () => {
    const source = readFileSync(SIGNUP_ROUTE, 'utf8');

    expect(source).toContain("hasModel('user') && hasModel('userSettings')");
  });

  it('creates the required user and settings records in one transaction', () => {
    const source = readFileSync(SIGNUP_ROUTE, 'utf8');
    const transactionIndex = source.indexOf('const user = await db.$transaction(async (tx) => {');
    const userCreateIndex = source.indexOf('const createdUser = await tx.user.create({');
    const settingsCreateIndex = source.indexOf('await tx.userSettings.create({');
    const optionalDemoAccountIndex = source.indexOf('await db.tradingAccount.create({');

    expect(transactionIndex).toBeGreaterThan(-1);
    expect(userCreateIndex).toBeGreaterThan(transactionIndex);
    expect(settingsCreateIndex).toBeGreaterThan(userCreateIndex);
    expect(optionalDemoAccountIndex).toBeGreaterThan(settingsCreateIndex);
    expect(source).not.toContain('await db.user.create({');
    expect(source).not.toContain('await db.userSettings.create({');
  });

  it('validates fullName through the signup schema instead of reading raw request data', () => {
    const source = readFileSync(SIGNUP_ROUTE, 'utf8');

    expect(source).toContain('fullName: z.string().min(1).optional()');
    expect(source).toContain('const { email, password, name: schemaName, fullName } = parsed.data;');
    expect(source).toContain("const name = schemaName || fullName || '';");
    expect(source).not.toContain('body.fullName');
  });

  it('keeps the demo-account bootstrap explicitly non-critical and outside the required transaction', () => {
    const source = readFileSync(SIGNUP_ROUTE, 'utf8');

    expect(source).toContain("console.warn('[signup] Failed to create demo trading account (non-critical):', accErr);");
    expect(source).toContain("if (hasModel('tradingAccount')) {");
  });
});
