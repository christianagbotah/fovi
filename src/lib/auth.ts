import { createHash, randomBytes, pbkdf2Sync } from 'crypto';
import { SignJWT, jwtVerify } from 'jose';
import { NextRequest } from 'next/server';

const PEPPER = process.env.AUTH_PEPPER || 'fovi-ai-pepper-2024';
const KEY_LENGTH = 64;
const ITERATIONS = 100000;
const DIGEST = 'sha512';

const JWT_SECRET = process.env.JWT_SECRET || 'fovi-dev-jwt-secret-change-in-production';

// Encode the secret as Uint8Array for jose
function getSecretKey(): Uint8Array {
  return new TextEncoder().encode(JWT_SECRET);
}

// ============================================================
// Password utilities (unchanged)
// ============================================================

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = pbkdf2Sync(password, salt + PEPPER, ITERATIONS, KEY_LENGTH, DIGEST).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, hash] = storedHash.split(':');
  if (!salt || !hash) return false;
  const computedHash = pbkdf2Sync(password, salt + PEPPER, ITERATIONS, KEY_LENGTH, DIGEST).toString('hex');
  return hash === computedHash;
}

// ============================================================
// Token utilities (unchanged)
// ============================================================

export function generateResetToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// ============================================================
// JWT utilities (replacing random hex generateToken)
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

export interface RefreshTokenPayload {
  sub: string;
  type: 'refresh';
  iat?: number;
  exp?: number;
}

export type JwtPayload = AccessTokenPayload | RefreshTokenPayload;

/**
 * Create a JWT access token with 24h expiry.
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
    .setExpirationTime('24h')
    .sign(getSecretKey());
}

/**
 * Create a JWT refresh token with 7d expiry.
 */
export async function generateRefreshToken(userId: string): Promise<string> {
  return new SignJWT({ sub: userId, type: 'refresh' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
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
