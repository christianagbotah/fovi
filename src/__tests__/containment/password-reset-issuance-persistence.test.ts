import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const FORGOT = join(ROOT, 'src/app/api/auth/forgot-password/route.ts');

describe('Phase 3AS persistence-confirmed password reset issuance', () => {
  it('positively confirms reset-token persistence before sending recovery email', () => {
    const source = readFileSync(FORGOT, 'utf8');

    const persistIndex = source.indexOf('const persistedReset = await safeDbQuery(() =>');
    const confirmationIndex = source.indexOf('if (!persistedReset)');
    const emailIndex = source.indexOf('await sendEmail({');

    expect(persistIndex).toBeGreaterThanOrEqual(0);
    expect(confirmationIndex).toBeGreaterThan(persistIndex);
    expect(emailIndex).toBeGreaterThan(confirmationIndex);
    expect(source).toContain('select: { id: true }');
  });

  it('fails closed to the generic anti-enumeration response when persistence is unavailable', () => {
    const source = readFileSync(FORGOT, 'utf8');
    const confirmationIndex = source.indexOf('if (!persistedReset)');
    const emailIndex = source.indexOf('await sendEmail({');
    const confirmationBlock = source.slice(confirmationIndex, emailIndex);

    expect(confirmationIndex).toBeGreaterThanOrEqual(0);
    expect(confirmationBlock).toContain('return genericRecoveryResponse();');
    expect(confirmationBlock).not.toContain('sendEmail');
  });

  it('persists the hash and expiry, never the raw reset token', () => {
    const source = readFileSync(FORGOT, 'utf8');
    const persistIndex = source.indexOf('const persistedReset = await safeDbQuery(() =>');
    const confirmationIndex = source.indexOf('if (!persistedReset)');
    const persistenceBlock = source.slice(persistIndex, confirmationIndex);

    expect(persistenceBlock).toContain('resetToken: hashedToken');
    expect(persistenceBlock).toContain('resetTokenExpiry: expiry');
    expect(persistenceBlock).not.toContain('resetToken: resetToken');
  });

  it('preserves recovery abuse controls before account lookup and token issuance', () => {
    const source = readFileSync(FORGOT, 'utf8');

    const abuseCheck = source.indexOf('await getPasswordRecoveryAbuseStatus(emailLower)');
    const abuseRecord = source.indexOf('await recordPasswordRecoveryRequest(emailLower)');
    const lookup = source.indexOf('db!.user.findUnique({ where: { email: emailLower } })');
    const tokenIssue = source.indexOf('const resetToken = generateResetToken();');

    expect(abuseCheck).toBeGreaterThanOrEqual(0);
    expect(abuseRecord).toBeGreaterThan(abuseCheck);
    expect(lookup).toBeGreaterThan(abuseRecord);
    expect(tokenIssue).toBeGreaterThan(lookup);
  });
});
