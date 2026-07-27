import { createHash, randomBytes, pbkdf2Sync } from 'crypto';

const PEPPER = process.env.AUTH_PEPPER || 'fovi-ai-pepper-2024';
const KEY_LENGTH = 64;
const ITERATIONS = 100000;
const DIGEST = 'sha512';

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

export function generateToken(): string {
  return randomBytes(32).toString('hex');
}

export function generateResetToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
