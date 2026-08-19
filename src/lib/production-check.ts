// ============================================================
// Production Environment Validation
// Logs warnings on startup if non-critical issues are found.
// HARD-BLOCKS startup if critical secrets are
// missing, using insecure defaults, or malformed.
// ============================================================

const PLACEHOLDER_PREFIXES = ['change-me', 'example', 'placeholder', 'todo', 'fixme', 'your-'];
const EXAMPLE_URLS = ['yourdomain.com', 'example.com', 'localhost', '127.0.0.1'];

/**
 * Check if a value looks like a placeholder that was never replaced.
 */
function isPlaceholder(value: string): boolean {
  const lower = value.toLowerCase().trim();
  return PLACEHOLDER_PREFIXES.some(p => lower.startsWith(p));
}

/**
 * Check if a URL is a valid HTTPS URL (required for APP_URL / NEXT_PUBLIC_APP_URL in production).
 */
function isValidHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function validateProductionEnv(): void {
  if (process.env.NODE_ENV !== 'production') return;

  const warnings: string[] = [];
  const fatals: string[] = [];

  // --- Critical secret checks (FATAL) ---

  // DATABASE_URL: must exist and be a PostgreSQL connection string
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    fatals.push('DATABASE_URL is not set. Set it to a valid postgresql:// or postgres:// connection string.');
  } else if (!databaseUrl.startsWith('postgresql://') && !databaseUrl.startsWith('postgres://')) {
    fatals.push('DATABASE_URL is not a PostgreSQL connection string. Production must use PostgreSQL.');
  } else if (isPlaceholder(databaseUrl)) {
    fatals.push('DATABASE_URL appears to contain a placeholder value. Replace it with a real PostgreSQL connection string.');
  }

  // JWT_SECRET: must exist, >= 32 chars, not a placeholder
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    fatals.push('JWT_SECRET is not set. Generate a strong random secret and set it as an environment variable.');
  } else if (jwtSecret.length < 32) {
    fatals.push('JWT_SECRET is too short (' + jwtSecret.length + ' chars). It must be at least 32 characters.');
  } else if (isPlaceholder(jwtSecret)) {
    fatals.push('JWT_SECRET appears to contain a placeholder value. Replace it with a cryptographically random secret.');
  }

  // AUTH_PEPPER: must exist, >= 16 chars, not a placeholder
  const authPepper = process.env.AUTH_PEPPER;
  if (!authPepper) {
    fatals.push('AUTH_PEPPER is not set. Generate a strong random pepper and set it as an environment variable.');
  } else if (authPepper.length < 16) {
    fatals.push('AUTH_PEPPER is too short (' + authPepper.length + ' chars). It must be at least 16 characters.');
  } else if (isPlaceholder(authPepper)) {
    fatals.push('AUTH_PEPPER appears to contain a placeholder value. Replace it with a cryptographically random pepper.');
  }

  // ENCRYPTION_KEY: must exist, >= 32 chars, not a placeholder
  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (!encryptionKey) {
    fatals.push('ENCRYPTION_KEY is not set. Generate a random key (>= 32 chars) and set it as an environment variable.');
  } else if (encryptionKey.length < 32) {
    fatals.push('ENCRYPTION_KEY is too short (' + encryptionKey.length + ' chars). It must be at least 32 characters.');
  } else if (isPlaceholder(encryptionKey)) {
    fatals.push('ENCRYPTION_KEY appears to contain a placeholder value. Replace it with a cryptographically random key.');
  }

  // INTERNAL_SERVICE_SECRET: must exist and not be a placeholder
  const internalSecret = process.env.INTERNAL_SERVICE_SECRET;
  if (!internalSecret) {
    fatals.push('INTERNAL_SERVICE_SECRET is not set. Mini-services require this to authenticate with the Next.js API.');
  } else if (isPlaceholder(internalSecret)) {
    fatals.push('INTERNAL_SERVICE_SECRET appears to contain a placeholder value. Replace it with a cryptographically random secret.');
  }

  // APP_URL: must be a valid HTTPS URL in production
  const appUrl = process.env.APP_URL;
  if (!appUrl) {
    warnings.push('  - APP_URL is not set. OAuth callbacks and email links may not work correctly.');
  } else if (!isValidHttpsUrl(appUrl)) {
    fatals.push('APP_URL is not a valid HTTPS URL. Production requires a valid HTTPS base URL.');
  } else if (EXAMPLE_URLS.some(u => appUrl.includes(u))) {
    warnings.push('  - APP_URL contains an example domain. Verify this is the correct production domain.');
  }

  // NEXT_PUBLIC_APP_URL: must be a valid HTTPS URL in production
  const publicAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!publicAppUrl) {
    warnings.push('  - NEXT_PUBLIC_APP_URL is not set. Client-side links may not work correctly.');
  } else if (!isValidHttpsUrl(publicAppUrl)) {
    fatals.push('NEXT_PUBLIC_APP_URL is not a valid HTTPS URL. Production requires a valid HTTPS base URL.');
  } else if (EXAMPLE_URLS.some(u => publicAppUrl.includes(u))) {
    warnings.push('  - NEXT_PUBLIC_APP_URL contains an example domain. Verify this is the correct production domain.');
  }

  // --- Hard-block on fatal errors ---

  if (fatals.length > 0) {
    console.error('');
    console.error('FATAL: Production configuration is missing or insecure. The application cannot start.');
    console.error('');
    console.error('   Fix the following before deploying:');
    fatals.forEach(f => console.error('   x  ' + f));
    console.error('');
    console.error('   Set the correct values in your environment and restart.');
    console.error('');
    // Hard-block the process. Throw for testability, then attempt process.exit.
    const err = new Error('Production configuration fatal: ' + fatals.join('; '));
    if (typeof process !== 'undefined' && typeof process.exit === 'function') {
      try { process.exit(1); } catch { /* Edge runtime swallows process.exit */ }
    }
    throw err;
  }

  // --- Non-critical warnings (do NOT block) ---

  if (warnings.length > 0) {
    console.warn('');
    console.warn('PRODUCTION WARNINGS:');
    console.warn('   The following need attention:');
    warnings.forEach(w => console.warn(w));
    console.warn('');
  }
}
