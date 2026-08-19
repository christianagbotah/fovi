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

/**
 * Check if a value looks like a placeholder that was never replaced.
 */
function isPlaceholder(value: string): boolean {
  const lower = value.toLowerCase().trim();
  return PLACEHOLDER_PREFIXES.some(p => lower.startsWith(p));
}

/**
 * Check if a URL contains an example/placeholder hostname.
 */
function isExampleHostname(value: string): boolean {
  const lower = value.toLowerCase();
  return EXAMPLE_HOSTNAMES.some(h => lower.includes(h));
}

/**
 * Check if a URL is a valid HTTPS URL.
 */
function isValidHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Parse a PostgreSQL URL and check for placeholder components.
 * Returns null if valid, or an error string if a placeholder is detected.
 */
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

    // Also reject if any component starts with known placeholder prefixes
    for (const comp of [username, password, hostname, dbName]) {
      if (isPlaceholder(comp)) {
        return `DATABASE_URL contains a placeholder component. Replace it with real values.`;
      }
    }

    // Reject the exact template from .env.example
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

/**
 * Validate INTERNAL_SERVICE_SECRET strength.
 * Returns null if valid, or an error string.
 */
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

export interface ValidationResult {
  fatals: string[];
  warnings: string[];
}

/**
 * Validate production environment and return results.
 * Does NOT exit — caller decides what to do with the result.
 */
export function validateProductionEnvDry(): ValidationResult {
  const fatals: string[] = [];
  const warnings: string[] = [];

  // --- DATABASE_URL ---
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    fatals.push('DATABASE_URL is not set. Set it to a valid postgresql:// or postgres:// connection string.');
  } else if (!databaseUrl.startsWith('postgresql://') && !databaseUrl.startsWith('postgres://')) {
    fatals.push('DATABASE_URL is not a PostgreSQL connection string. Production must use PostgreSQL.');
  } else {
    const dbErr = detectDatabasePlaceholder(databaseUrl);
    if (dbErr) fatals.push(dbErr);
  }

  // --- JWT_SECRET ---
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    fatals.push('JWT_SECRET is not set. Generate a strong random secret and set it as an environment variable.');
  } else if (jwtSecret.length < 32) {
    fatals.push(`JWT_SECRET is too short (${jwtSecret.length} chars). It must be at least 32 characters.`);
  } else if (isPlaceholder(jwtSecret)) {
    fatals.push('JWT_SECRET appears to contain a placeholder value. Replace it with a cryptographically random secret.');
  }

  // --- AUTH_PEPPER ---
  const authPepper = process.env.AUTH_PEPPER;
  if (!authPepper) {
    fatals.push('AUTH_PEPPER is not set. Generate a strong random pepper and set it as an environment variable.');
  } else if (authPepper.length < 16) {
    fatals.push(`AUTH_PEPPER is too short (${authPepper.length} chars). It must be at least 16 characters.`);
  } else if (isPlaceholder(authPepper)) {
    fatals.push('AUTH_PEPPER appears to contain a placeholder value. Replace it with a cryptographically random pepper.');
  }

  // --- ENCRYPTION_KEY ---
  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (!encryptionKey) {
    fatals.push('ENCRYPTION_KEY is not set. Generate a random key (>= 32 chars) and set it as an environment variable.');
  } else if (encryptionKey.length < 32) {
    fatals.push(`ENCRYPTION_KEY is too short (${encryptionKey.length} chars). It must be at least 32 characters.`);
  } else if (isPlaceholder(encryptionKey)) {
    fatals.push('ENCRYPTION_KEY appears to contain a placeholder value. Replace it with a cryptographically random key.');
  }

  // --- INTERNAL_SERVICE_SECRET (>= 32 chars, no placeholders) ---
  const internalSecret = process.env.INTERNAL_SERVICE_SECRET;
  const secretErr = validateInternalServiceSecret(internalSecret || '');
  if (secretErr) {
    fatals.push(secretErr);
  }

  // --- APP_URL (REQUIRED, HTTPS, no example domains) ---
  const appUrl = process.env.APP_URL;
  if (!appUrl) {
    fatals.push('APP_URL is not set. Production requires a valid HTTPS base URL for OAuth callbacks, email links, etc.');
  } else if (!isValidHttpsUrl(appUrl)) {
    fatals.push('APP_URL must be a valid HTTPS URL in production (got: ' + appUrl + ')');
  } else if (isExampleHostname(appUrl)) {
    fatals.push('APP_URL contains a known example/placeholder domain. Replace it with the real production domain.');
  }

  // --- NEXT_PUBLIC_APP_URL (REQUIRED, HTTPS, no example domains) ---
  const publicAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!publicAppUrl) {
    fatals.push('NEXT_PUBLIC_APP_URL is not set. Production requires a valid HTTPS base URL for client-side links.');
  } else if (!isValidHttpsUrl(publicAppUrl)) {
    fatals.push('NEXT_PUBLIC_APP_URL must be a valid HTTPS URL in production (got: ' + publicAppUrl + ')');
  } else if (isExampleHostname(publicAppUrl)) {
    fatals.push('NEXT_PUBLIC_APP_URL contains a known example/placeholder domain. Replace it with the real production domain.');
  }

  return { fatals, warnings };
}

/**
 * Validate production environment.
 * HARD-BLOCKS startup if critical secrets are missing, using insecure
 * defaults, or malformed. Called from instrumentation.ts.
 */
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
