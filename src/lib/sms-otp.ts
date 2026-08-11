import { createHash, randomInt } from 'crypto';
import { db, hasModel, isDbAvailable, safeDbQuery } from '@/lib/db';
import { sendSms } from '@/lib/hubtel';
import { sendEmail, isEmailConfigured } from '@/lib/email';

// ============================================================
// OTP generation helpers
// ============================================================

const OTP_LENGTH = 6;
const OTP_EXPIRY_MINUTES = 10;

/**
 * Generate a random numeric OTP of OTP_LENGTH digits.
 */
function generateCode(): string {
  let code = '';
  for (let i = 0; i < OTP_LENGTH; i++) {
    code += randomInt(0, 10).toString();
  }
  return code;
}

/**
 * Hash an OTP code for secure storage.
 */
function hashOtpCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

// ============================================================
// SMS OTP
// ============================================================

/**
 * Generate an SMS OTP, store it hashed, and send via Hubtel SMS.
 * Returns { success, error? }.
 */
export async function generateSmsOtp(
  userId: string,
  phoneNumber: string,
  purpose: string = 'login'
): Promise<{ success: boolean; error?: string }> {
  if (!isDbAvailable() || !db || !hasModel('smsOtp')) {
    return { success: false, error: 'Database is not available' };
  }

  const code = generateCode();
  const hashedCode = hashOtpCode(code);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  // Store the hashed OTP in the database
  await db.smsOtp.create({
    data: {
      userId,
      phoneNumber,
      code: hashedCode,
      purpose,
      expiresAt,
    },
  });

  // Send the plain-text OTP via SMS
  const result = await sendOtpViaSms(phoneNumber, code);
  if (!result.success) {
    return { success: false, error: result.error };
  }

  return { success: true };
}

/**
 * Verify an SMS OTP code.
 * Returns { success, verified }.
 */
export async function verifySmsOtp(
  userId: string,
  code: string,
  purpose: string = 'login'
): Promise<{ success: boolean; verified: boolean }> {
  if (!isDbAvailable() || !db || !hasModel('smsOtp')) {
    return { success: false, verified: false };
  }

  const hashedInput = hashOtpCode(code);
  const now = new Date();

  // Find the latest unexpired, unverified OTP for this user+purpose
  const otp = await safeDbQuery(() =>
    db!.smsOtp.findFirst({
      where: {
        userId,
        purpose,
        verified: false,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
    })
  );

  if (!otp) {
    return { success: true, verified: false };
  }

  if (otp.code !== hashedInput) {
    return { success: true, verified: false };
  }

  // Mark as verified
  await safeDbQuery(() =>
    db!.smsOtp.update({
      where: { id: otp!.id },
      data: { verified: true },
    })
  );

  return { success: true, verified: true };
}

// ============================================================
// Email OTP
// ============================================================

/**
 * Generate an Email OTP, store it hashed, and send via email.
 * Returns { success, error? }.
 */
export async function generateEmailOtp(
  email: string,
  userId?: string,
  purpose: string = 'login'
): Promise<{ success: boolean; error?: string }> {
  if (!isDbAvailable() || !db || !hasModel('emailOtp')) {
    return { success: false, error: 'Database is not available' };
  }

  const code = generateCode();
  const hashedCode = hashOtpCode(code);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  // Store the hashed OTP in the database
  await db.emailOtp.create({
    data: {
      userId: userId || null,
      email: email.toLowerCase().trim(),
      code: hashedCode,
      purpose,
      expiresAt,
    },
  });

  // Send the plain-text OTP via email
  const result = await sendOtpViaEmail(email, code);
  if (!result.success) {
    return { success: false, error: result.error };
  }

  return { success: true };
}

/**
 * Verify an Email OTP code.
 * Returns { success, verified }.
 */
export async function verifyEmailOtp(
  email: string,
  code: string,
  purpose: string = 'login'
): Promise<{ success: boolean; verified: boolean }> {
  if (!isDbAvailable() || !db || !hasModel('emailOtp')) {
    return { success: false, verified: false };
  }

  const hashedInput = hashOtpCode(code);
  const now = new Date();
  const normalizedEmail = email.toLowerCase().trim();

  // Find the latest unexpired, unverified OTP for this email+purpose
  const otp = await safeDbQuery(() =>
    db!.emailOtp.findFirst({
      where: {
        email: normalizedEmail,
        purpose,
        verified: false,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
    })
  );

  if (!otp) {
    return { success: true, verified: false };
  }

  if (otp.code !== hashedInput) {
    return { success: true, verified: false };
  }

  // Mark as verified
  await safeDbQuery(() =>
    db!.emailOtp.update({
      where: { id: otp!.id },
      data: { verified: true },
    })
  );

  return { success: true, verified: true };
}

// ============================================================
// Send helpers
// ============================================================

/**
 * Format and send an OTP via Hubtel SMS.
 */
export async function sendOtpViaSms(
  phoneNumber: string,
  code: string
): Promise<{ success: boolean; error?: string }> {
  const message = `Your Fovi AI verification code is: ${code}. This code expires in ${OTP_EXPIRY_MINUTES} minutes. Do not share this code with anyone.`;

  const result = await sendSms(phoneNumber, message);
  if (!result.success) {
    console.error('[SMS OTP] Failed to send:', result.error);
  }

  return result;
}

/**
 * Send an OTP via email using the email service.
 */
export async function sendOtpViaEmail(
  email: string,
  code: string
): Promise<{ success: boolean; error?: string }> {
  if (!(await isEmailConfigured())) {
    console.warn('[Email OTP] SMTP not configured — OTP email not sent.');
    return { success: false, error: 'Email service is not configured. Please set up SMTP in admin settings.' };
  }

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color: #111;">Fovi AI — Verification Code</h2>
      <p style="color: #555; font-size: 16px;">Your verification code is:</p>
      <div style="background: #f5f5f5; padding: 16px 24px; border-radius: 8px; text-align: center; margin: 24px 0;">
        <span style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #111;">${code}</span>
      </div>
      <p style="color: #888; font-size: 14px;">This code expires in ${OTP_EXPIRY_MINUTES} minutes. Do not share this code with anyone.</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
      <p style="color: #aaa; font-size: 12px;">If you did not request this code, please ignore this email.</p>
    </div>
  `;

  const result = await sendEmail({
    to: email,
    subject: `Fovi AI Verification Code: ${code}`,
    html,
    text: `Your Fovi AI verification code is: ${code}. This code expires in ${OTP_EXPIRY_MINUTES} minutes. Do not share this code with anyone.`,
  });

  return { success: result.success };
}
