import { createHmac, randomInt } from 'crypto';
import type { Prisma } from '@prisma/client';
import { db, hasModel, isDbAvailable } from '@/lib/db';
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
 * Hash a low-entropy OTP with the application pepper so a database-only leak
 * cannot be brute-forced by comparing all one million possible 6-digit codes.
 */
function hashOtpCode(code: string): string {
  const pepper = process.env.AUTH_PEPPER;
  if (!pepper || pepper.length < 16) {
    throw new Error('AUTH_PEPPER is required for OTP hashing.');
  }
  return createHmac('sha256', pepper).update(code).digest('hex');
}

async function acquireOtpIssueLock(
  tx: Prisma.TransactionClient,
  lockKey: string,
): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
}

// ============================================================
// SMS OTP
// ============================================================

/**
 * Generate an SMS OTP, deliver it, then persist exactly one active OTP for the
 * user+purpose. A new successful issuance supersedes every older active code.
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

  // Do not create a usable database record when delivery itself failed.
  const delivery = await sendOtpViaSms(phoneNumber, code);
  if (!delivery.success) {
    return { success: false, error: delivery.error };
  }

  try {
    await db.$transaction(async (tx) => {
      await acquireOtpIssueLock(tx, `sms-otp:${userId}:${purpose}`);

      await tx.smsOtp.updateMany({
        where: { userId, purpose, verified: false },
        data: { verified: true },
      });

      await tx.smsOtp.create({
        data: {
          userId,
          phoneNumber,
          code: hashedCode,
          purpose,
          expiresAt,
        },
      });
    });
  } catch {
    return { success: false, error: 'Failed to persist OTP' };
  }

  return { success: true };
}

/**
 * Atomically verify the newest active SMS OTP for user+purpose, require that
 * newest record to match the submitted phone and code, then retire every active
 * record for that user+purpose. FOR UPDATE serializes concurrent consumers.
 */
export async function verifySmsOtp(
  userId: string,
  phoneNumber: string,
  code: string,
  purpose: string = 'login'
): Promise<{ success: boolean; verified: boolean }> {
  if (!isDbAvailable() || !db || !hasModel('smsOtp')) {
    return { success: false, verified: false };
  }

  const hashedInput = hashOtpCode(code);

  try {
    const consumed = await db.$executeRaw`
      WITH candidate AS (
        SELECT "id", "code", "phoneNumber"
        FROM "SmsOtp"
        WHERE "userId" = ${userId}
          AND "purpose" = ${purpose}
          AND "verified" = FALSE
          AND "expiresAt" > CURRENT_TIMESTAMP
        ORDER BY "createdAt" DESC
        LIMIT 1
        FOR UPDATE
      )
      UPDATE "SmsOtp"
      SET "verified" = TRUE
      WHERE "userId" = ${userId}
        AND "purpose" = ${purpose}
        AND "verified" = FALSE
        AND "expiresAt" > CURRENT_TIMESTAMP
        AND EXISTS (
          SELECT 1
          FROM candidate
          WHERE candidate."phoneNumber" = ${phoneNumber}
            AND candidate."code" = ${hashedInput}
        )
    `;

    return { success: true, verified: consumed > 0 };
  } catch {
    return { success: false, verified: false };
  }
}

// ============================================================
// Email OTP
// ============================================================

/**
 * Generate an Email OTP, deliver it, then persist one active code. Authenticated
 * flows are superseded by user+purpose; anonymous signup flows by email+purpose.
 */
export async function generateEmailOtp(
  email: string,
  userId?: string,
  purpose: string = 'login'
): Promise<{ success: boolean; error?: string }> {
  if (!isDbAvailable() || !db || !hasModel('emailOtp')) {
    return { success: false, error: 'Database is not available' };
  }

  const normalizedEmail = email.toLowerCase().trim();
  const code = generateCode();
  const hashedCode = hashOtpCode(code);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  // Do not leave an active OTP behind when delivery failed.
  const delivery = await sendOtpViaEmail(normalizedEmail, code);
  if (!delivery.success) {
    return { success: false, error: delivery.error };
  }

  try {
    await db.$transaction(async (tx) => {
      const identityKey = userId ? `user:${userId}` : `email:${normalizedEmail}`;
      await acquireOtpIssueLock(tx, `email-otp:${identityKey}:${purpose}`);

      if (userId) {
        await tx.emailOtp.updateMany({
          where: { userId, purpose, verified: false },
          data: { verified: true },
        });
      } else {
        await tx.emailOtp.updateMany({
          where: { userId: null, email: normalizedEmail, purpose, verified: false },
          data: { verified: true },
        });
      }

      await tx.emailOtp.create({
        data: {
          userId: userId || null,
          email: normalizedEmail,
          code: hashedCode,
          purpose,
          expiresAt,
        },
      });
    });
  } catch {
    return { success: false, error: 'Failed to persist OTP' };
  }

  return { success: true };
}

/**
 * Atomically verify and consume the newest Email OTP. Authenticated flows first
 * choose the newest user+purpose row and require its email+code to match before
 * retiring all active user+purpose rows. Anonymous signup remains email-bound.
 */
export async function verifyEmailOtp(
  email: string,
  code: string,
  purpose: string = 'login',
  userId?: string | null,
): Promise<{ success: boolean; verified: boolean }> {
  if (!isDbAvailable() || !db || !hasModel('emailOtp')) {
    return { success: false, verified: false };
  }

  const hashedInput = hashOtpCode(code);
  const normalizedEmail = email.toLowerCase().trim();

  try {
    const consumed = userId
      ? await db.$executeRaw`
          WITH candidate AS (
            SELECT "id", "code", "email"
            FROM "EmailOtp"
            WHERE "userId" = ${userId}
              AND "purpose" = ${purpose}
              AND "verified" = FALSE
              AND "expiresAt" > CURRENT_TIMESTAMP
            ORDER BY "createdAt" DESC
            LIMIT 1
            FOR UPDATE
          )
          UPDATE "EmailOtp"
          SET "verified" = TRUE
          WHERE "userId" = ${userId}
            AND "purpose" = ${purpose}
            AND "verified" = FALSE
            AND "expiresAt" > CURRENT_TIMESTAMP
            AND EXISTS (
              SELECT 1
              FROM candidate
              WHERE candidate."email" = ${normalizedEmail}
                AND candidate."code" = ${hashedInput}
            )
        `
      : await db.$executeRaw`
          WITH candidate AS (
            SELECT "id", "code"
            FROM "EmailOtp"
            WHERE "userId" IS NULL
              AND "email" = ${normalizedEmail}
              AND "purpose" = ${purpose}
              AND "verified" = FALSE
              AND "expiresAt" > CURRENT_TIMESTAMP
            ORDER BY "createdAt" DESC
            LIMIT 1
            FOR UPDATE
          )
          UPDATE "EmailOtp"
          SET "verified" = TRUE
          WHERE "userId" IS NULL
            AND "email" = ${normalizedEmail}
            AND "purpose" = ${purpose}
            AND "verified" = FALSE
            AND "expiresAt" > CURRENT_TIMESTAMP
            AND EXISTS (
              SELECT 1
              FROM candidate
              WHERE candidate."code" = ${hashedInput}
            )
        `;

    return { success: true, verified: consumed > 0 };
  } catch {
    return { success: false, verified: false };
  }
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
    subject: 'Fovi AI Verification Code',
    html,
    text: `Your Fovi AI verification code is: ${code}. This code expires in ${OTP_EXPIRY_MINUTES} minutes. Do not share this code with anyone.`,
  });

  return { success: result.success };
}
