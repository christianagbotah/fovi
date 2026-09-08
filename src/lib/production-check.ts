// ============================================================
// Production Environment Validation — SINGLE SOURCE OF TRUTH
// ============================================================
// This module is the authoritative policy for production env.
// It is used by:
//   1. instrumentation.ts — at Next.js startup
//   2. scripts/validate-production-env.ts — CLI for deploy.sh
// ============================================================

const PLACEHOLDER_PREFIXES = ['change-me', 'example', 'placeholder', 'todo', 'fixme', 'your-'];
const EXAMPLE_HOSTNAMES = ['yourdomain.com', 'example.com', 'localhost', '127.0.0.1', '0.0.0.0'];
const DB_PLACEHOLDER_TOKENS = [
  'user', 'username', 'password', 'pass',
  'host', 'database', 'database_name', 'db_name', 'example',
];

function isPlaceholder(value: string): boolean {
  const lower = value.toLowerCase().trim();
  return PLACEHOLDER_PREFIXES.some(p => lower.startsWith(p));
}

function hasInvalidSecretWhitespace(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length === 0 || trimmed !== value;
}

/**
 * Match the effective key bytes used by src/lib/encryption.ts without changing
 * the established derivation. WebCrypto AES-256 requires exactly 32 bytes.
 */
function hasInvalidEncryptionKeyByteLength(value: string): boolean {
  return new TextEncoder().encode(value.slice(0, 32)).byteLength !== 32;
}

function isExampleHostname(value: string): boolean {
  const lower = value.toLowerCase();
  return EXAMPLE_HOSTNAMES.some(h => lower.includes(h));
}

function isValidHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

function detectDatabasePlaceholder(url: string): string | null {
  try {
    const parsed = new URL(url);
    const username = decodeURIComponent(parsed.username).toLowerCase().trim();
    const password = decodeURIComponent(parsed.password).toLowerCase().trim();
    const hostname = parsed.hostname.toLowerCase().trim();
    const dbName = (parsed.pathname.split('/').pop() || '').toLowerCase().trim();

    for (const token of DB_PLACEHOLDER_TOKENS) {
      if (username === token || password === token || hostname === token || dbName === token) {
        return `DATABASE_URL contains a placeholder component (${token}). Replace it with real values.`;
      }
    }

    for (const comp of [username, password, hostname, dbName]) {
      if (isPlaceholder(comp)) {
        return 'DATABASE_URL contains a placeholder component. Replace it with real values.';
      }
    }

    if (
      username === 'user' &&
      password === 'password' &&
      hostname === 'host' &&
      dbName === 'database_name'
    ) {
      return 'DATABASE_URL matches the repository template. Replace it with real values.';
    }

    return null;
  } catch {
    return 'DATABASE_URL could not be parsed. Check the format.';
  }
}

function validateInternalServiceSecret(value: string): string | null {
  if (!value || value.trim().length === 0) {
    return 'INTERNAL_SERVICE_SECRET is not set. Generate with: openssl rand -hex 32';
  }
  if (value.trim() !== value || value.length === 0) {
    return 'INTERNAL_SERVICE_SECRET is whitespace-only or empty. Generate a real secret.';
  }
  if (value.length < 32) {
    return `INTERNAL_SERVICE_SECRET is too short (${value.length} chars). It must be at least 32 characters.`;
  }
  if (isPlaceholder(value)) {
    return 'INTERNAL_SERVICE_SECRET appears to contain a placeholder value. Replace it with a cryptographically random secret.';
  }
  return null;
}

type NamedSecret = readonly [name: string, value: string | undefined];

function detectCriticalSecretReuse(secrets: readonly NamedSecret[]): string[] {
  const errors: string[] = [];

  for (let i = 0; i < secrets.length; i++) {
    const [leftName, leftValue] = secrets[i];
    if (!leftValue) continue;

    for (let j = i + 1; j < secrets.length; j++) {
      const [rightName, rightValue] = secrets[j];
      if (!rightValue || leftValue !== rightValue) continue;

      errors.push(
        `${leftName} and ${rightName} must be different independently generated secrets. Do not reuse secret material across trust boundaries.`,
      );
    }
  }

  return errors;
}

function isTrueLike(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

export interface ValidationResult {
  fatals: string[];
  warnings: string[];
}

export function validateProductionEnvDry(): ValidationResult {
  const fatals: string[] = [];
  const warnings: string[] = [];

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    fatals.push('DATABASE_URL is not set. Set it to a valid postgresql:// or postgres:// connection string.');
  } else if (!databaseUrl.startsWith('postgresql://') && !databaseUrl.startsWith('postgres://')) {
    fatals.push('DATABASE_URL is not a PostgreSQL connection string. Production must use PostgreSQL.');
  } else {
    const dbErr = detectDatabasePlaceholder(databaseUrl);
    if (dbErr) fatals.push(dbErr);
  }

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    fatals.push('JWT_SECRET is not set. Generate a strong random secret and set it as an environment variable.');
  } else if (hasInvalidSecretWhitespace(jwtSecret)) {
    fatals.push('JWT_SECRET must not be whitespace-only or contain leading/trailing whitespace.');
  } else if (jwtSecret.length < 32) {
    fatals.push(`JWT_SECRET is too short (${jwtSecret.length} chars). It must be at least 32 characters.`);
  } else if (isPlaceholder(jwtSecret)) {
    fatals.push('JWT_SECRET appears to contain a placeholder value. Replace it with a cryptographically random secret.');
  }

  const authPepper = process.env.AUTH_PEPPER;
  if (!authPepper) {
    fatals.push('AUTH_PEPPER is not set. Generate a strong random pepper and set it as an environment variable.');
  } else if (hasInvalidSecretWhitespace(authPepper)) {
    fatals.push('AUTH_PEPPER must not be whitespace-only or contain leading/trailing whitespace.');
  } else if (authPepper.length < 16) {
    fatals.push(`AUTH_PEPPER is too short (${authPepper.length} chars). It must be at least 16 characters.`);
  } else if (isPlaceholder(authPepper)) {
    fatals.push('AUTH_PEPPER appears to contain a placeholder value. Replace it with a cryptographically random pepper.');
  }

  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (!encryptionKey) {
    fatals.push('ENCRYPTION_KEY is not set. Generate a random key (>= 32 chars) and set it as an environment variable.');
  } else if (hasInvalidSecretWhitespace(encryptionKey)) {
    fatals.push('ENCRYPTION_KEY must not be whitespace-only or contain leading/trailing whitespace.');
  } else if (encryptionKey.length < 32) {
    fatals.push(`ENCRYPTION_KEY is too short (${encryptionKey.length} chars). It must be at least 32 characters.`);
  } else if (hasInvalidEncryptionKeyByteLength(encryptionKey)) {
    fatals.push(
      'ENCRYPTION_KEY effective AES-256 key material must encode to exactly 32 bytes. Use ASCII-safe random secret material.',
    );
  } else if (isPlaceholder(encryptionKey)) {
    fatals.push('ENCRYPTION_KEY appears to contain a placeholder value. Replace it with a cryptographically random key.');
  }

  const internalSecret = process.env.INTERNAL_SERVICE_SECRET;
  const secretErr = validateInternalServiceSecret(internalSecret || '');
  if (secretErr) fatals.push(secretErr);

  fatals.push(...detectCriticalSecretReuse([
    ['JWT_SECRET', jwtSecret],
    ['AUTH_PEPPER', authPepper],
    ['ENCRYPTION_KEY', encryptionKey],
    ['INTERNAL_SERVICE_SECRET', internalSecret],
  ]));

  const appUrl = process.env.APP_URL;
  if (!appUrl) {
    fatals.push('APP_URL is not set. Production requires a valid HTTPS base URL for OAuth callbacks, email links, etc.');
  } else if (!isValidHttpsUrl(appUrl)) {
    fatals.push('APP_URL must be a valid HTTPS URL in production (got: ' + appUrl + ')');
  } else if (isExampleHostname(appUrl)) {
    fatals.push('APP_URL contains a known example/placeholder domain. Replace it with the real production domain.');
  }

  const publicAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!publicAppUrl) {
    fatals.push('NEXT_PUBLIC_APP_URL is not set. Production requires a valid HTTPS base URL for client-side links.');
  } else if (!isValidHttpsUrl(publicAppUrl)) {
    fatals.push('NEXT_PUBLIC_APP_URL must be a valid HTTPS URL in production (got: ' + publicAppUrl + ')');
  } else if (isExampleHostname(publicAppUrl)) {
    fatals.push('NEXT_PUBLIC_APP_URL contains a known example/placeholder domain. Replace it with the real production domain.');
  }

  // Phase 2D paper execution containment remains fail-closed in production.
  if (isTrueLike(process.env.PAPER_AUTOMATED_EXECUTION_ENABLED)) {
    fatals.push(
      'PAPER_AUTOMATED_EXECUTION_ENABLED must remain false in production until durable close/restart reconciliation is approved.',
    );
  }

  return { fatals, warnings };
}

export function validateProductionEnv(): void {
  if (process.env.NODE_ENV !== 'production') return;

  const { fatals, warnings } = validateProductionEnvDry();

  if (fatals.length > 0) {
    console.error('');
    console.error('FATAL: Production configuration is missing or insecure. The application cannot start.');
    console.error('');
    console.error('   Fix the following before deploying:');
    fatals.forEach(f => console.error('   x  ' + f));
    console.error('');
    console.error('   Set the correct values in your environment and restart.');
    console.error('');
    const err = new Error('Production configuration fatal: ' + fatals.join('; '));
    if (typeof process !== 'undefined' && typeof process.exit === 'function') {
      try { process.exit(1); } catch { /* Edge runtime swallows process.exit */ }
    }
    throw err;
  }

  if (warnings.length > 0) {
    console.warn('');
    console.warn('PRODUCTION WARNINGS:');
    warnings.forEach(w => console.warn('   ' + w));
    console.warn('');
  }
}
