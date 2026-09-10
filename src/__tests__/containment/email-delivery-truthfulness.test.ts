import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const EMAIL = join(ROOT, 'src/lib/email.ts');
const OTP = join(ROOT, 'src/lib/sms-otp.ts');

describe('Phase 3AT truthful email delivery contract', () => {
  it('reports SMTP absence as delivery failure rather than fabricated success', () => {
    const source = readFileSync(EMAIL, 'utf8');
    const missingTransport = source.indexOf('if (!transporter)');
    const sendAttempt = source.indexOf('await transporter.sendMail({');
    const block = source.slice(missingTransport, sendAttempt);

    expect(missingTransport).toBeGreaterThanOrEqual(0);
    expect(block).toContain('return { success: false };');
    expect(block).not.toContain('return { success: true };');
  });

  it('reports SMTP send exceptions as delivery failure without exposing transport details', () => {
    const source = readFileSync(EMAIL, 'utf8');
    const catchIndex = source.indexOf('} catch (err) {');
    const catchBlock = source.slice(catchIndex);

    expect(catchIndex).toBeGreaterThanOrEqual(0);
    expect(catchBlock).toContain("console.warn('[Email] Failed to send email:'");
    expect(catchBlock).toContain('return { success: false };');
    expect(catchBlock).not.toContain('return { success: true }; // Don\'t expose email failures to the user');
  });

  it('preserves positive success only after transporter.sendMail resolves', () => {
    const source = readFileSync(EMAIL, 'utf8');
    const sendAttempt = source.indexOf('await transporter.sendMail({');
    const success = source.indexOf('return { success: true };', sendAttempt);

    expect(sendAttempt).toBeGreaterThanOrEqual(0);
    expect(success).toBeGreaterThan(sendAttempt);
  });

  it('keeps email OTP persistence conditional on truthful delivery success', () => {
    const source = readFileSync(OTP, 'utf8');
    const emailFunction = source.indexOf('export async function generateEmailOtp(');
    const delivery = source.indexOf('const delivery = await sendOtpViaEmail(normalizedEmail, code);', emailFunction);
    const failureCheck = source.indexOf('if (!delivery.success)', delivery);
    const transaction = source.indexOf('await db.$transaction(async (tx) => {', delivery);

    expect(emailFunction).toBeGreaterThanOrEqual(0);
    expect(delivery).toBeGreaterThan(emailFunction);
    expect(failureCheck).toBeGreaterThan(delivery);
    expect(transaction).toBeGreaterThan(failureCheck);
  });
});
