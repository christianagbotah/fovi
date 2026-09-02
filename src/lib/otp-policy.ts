import { z } from 'zod/v4';

export const OTP_PURPOSES = ['login', 'signup'] as const;

export const otpPurposeSchema = z.enum(OTP_PURPOSES).optional().default('login');

export type OtpPurpose = (typeof OTP_PURPOSES)[number];

export function isSignupOtpPurpose(purpose: OtpPurpose): boolean {
  return purpose === 'signup';
}
