// ============================================================
// auth.ts — JWT & password utilities
// Phase 1 CR2: Production fails closed when JWT_SECRET or AUTH_PEPPER
// are absent. Repository-known defaults are NEVER used in production.
// Test mode (NODE_ENV=test) still works with explicit env vars.
// ============================================================

import { createHash, randomBytes, pbkdf2Sync, timingSafeEqual } from 'crypto';
import { SignJWT, jwtVerify } from 'jose';
import { NextRequest } from 'next/server';

// ── Production-safe secret loading ──
// In test mode, we allow explicit env vars (set by vitest setup).
// In production (NODE_ENV=production or any non-test env), missing
// secrets cause immediate failure — no fallback to repository-known values.

const PEPPER_RAW = process.env.AUTH_PEPPER;
const JWT_SECRET_RAW = process.env.JWT_SECRET;

let _pepper: string;
let _jwtSecret: string;

if (!PEPPER_RAW || PEPPER_RAW.length < 16) {
  if (process.env.NODE_ENV === 'test') {
    // In tests, we only accept explicitly set env vars.
    // Tests that need auth must set AUTH_PEPPER in their setup.
    _pepper = PEPPER_RAW || '';
  } else {
    // Production: fail closed. Do not log the secret value.
    throw new Error(
      'AUTH_PEPPER is not configured or too short (min 16 chars). ' +
      'Set this environment variable before starting the application.'
    );
  }
} else {
  _pepper = PEPPER_RAW;
}

if (!JWT_SECRET_RAW || JWT_SECRET_RAW.length < 32) {
  if (process.env.NODE_ENV === 'test') {
    _jwtSecret = JWT_SECRET_RAW || '';
  } else {
    throw new Error(
      'JWT_SECRET is not configured or too short (min 32 chars). ' +
      'Set this environment variable before starting the application.'
    );
  }
} else {
  _jwtSecret = JWT_SECRET_RAW;
}

const KEY_LENGTH = 64;
const ITERATIONS = 100000;
const DIGEST = 'sha512';
export const ACCESS_TOKEN_TTL = '15m';

// Encode the secret as Uint8Array for jose
function getSecretKey(): Uint8Array {
  return new TextEncoder().encode(_jwtSecret);
}

// ============================================================
// Password utilities
// ============================================================

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = pbkdf2Sync(password, salt + _pepper, ITERATIONS, KEY_LENGTH, DIGEST).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, hash] = storedHash.split(':');
  if (!salt || !hash) return false;

  const computedHash = pbkdf2Sync(password, salt + _pepper, ITERATIONS, KEY_LENGTH, DIGEST);

  let stored: Buffer;
  try {
    stored = Buffer.from(hash, 'hex');
  } catch {
    return false;
  }

  if (stored.length !== computedHash.length) return false;
  return timingSafeEqual(stored, computedHash);
}

// ============================================================
// Token utilities
// ============================================================

export function generateResetToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// ============================================================
// JWT utilities
// ============================================================

export interface AccessTokenPayload {
  sub: string;
  email: string;
  name?: string;
  role?: string;
  type: 'access';
  iat?: number;
  exp?: number;
}

export interface TwoFactorChallengePayload {
  sub: string;
  email: string;
  type: 'two_factor';
  iat?: number;
  exp?: number;
}

export type JwtPayload = AccessTokenPayload | TwoFactorChallengePayload;

/**
 * Create a short-lived JWT access token.
 *
 * Phase 3H shortens the bearer-token exposure window now that browser callers
 * are enforced through the refresh-aware boundary. Long-lived continuity is
 * provided by the revocable HttpOnly refresh session, not by the access JWT.
 */
export async function generateAccessToken(
  userId: string,
  email: string,
  name?: string,
  role?: string
): Promise<string> {
  const payload: Omit<AccessTokenPayload, 'iat' | 'exp'> = {
    sub: userId,
    email,
    type: 'access',
  };
  if (name) payload.name = name;
  if (role) payload.role = role;

  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .sign(getSecretKey());
}

/**
 * Create a short-lived challenge after password verification. The public
 * 2FA completion endpoint must require this token so a TOTP cannot act as
 * an alternative single-factor login credential.
 */
export async function generateTwoFactorChallenge(userId: string, email: string): Promise<string> {
  const payload: Omit<TwoFactorChallengePayload, 'iat' | 'exp'> = {
    sub: userId,
    email,
    type: 'two_factor',
  };

  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(getSecretKey());
}

/**
 * Verify a JWT and return its payload, or null if invalid/expired.
 */
export async function verifyToken(token: string): Promise<JwtPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    return payload as unknown as JwtPayload;
  } catch {
    return null;
  }
}

/**
 * Extract the Bearer token from an Authorization header.
 */
export function extractBearerToken(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  return authHeader.slice(7).trim();
}
