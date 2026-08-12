// ============================================================
// Production Environment Validation
// Logs warnings on startup if non-critical issues are found.
// HARD-BLOCKS startup (process.exit(1)) if critical secrets are
// missing or still using insecure default values.
// ============================================================

const INSECURE_DEFAULTS: Record<string, string> = {
  JWT_SECRET: 'fovi-dev-jwt-secret-change-in-production',
  AUTH_PEPPER: 'fovi-ai-pepper-2024',
};

export function validateProductionEnv(): void {
  if (process.env.NODE_ENV !== 'production') return;

  const warnings: string[] = [];
  const fatals: string[] = [];

  // --- Critical secret checks (FATAL) ---

  // JWT_SECRET: must exist, must not be empty, must not be the default
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret || jwtSecret === INSECURE_DEFAULTS.JWT_SECRET) {
    fatals.push(
      `JWT_SECRET is ${!jwtSecret ? 'not set' : 'using the insecure default value'}. ` +
      'Generate a strong random secret (e.g. `openssl rand -hex 32`) and set it as an environment variable.'
    );
  }

  // AUTH_PEPPER: must exist, must not be empty, must not be the default
  const authPepper = process.env.AUTH_PEPPER;
  if (!authPepper || authPepper === INSECURE_DEFAULTS.AUTH_PEPPER) {
    fatals.push(
      `AUTH_PEPPER is ${!authPepper ? 'not set' : 'using the insecure default value'}. ` +
      'Generate a strong random pepper (e.g. `openssl rand -hex 32`) and set it as an environment variable.'
    );
  }

  // ENCRYPTION_KEY: must exist and be at least 32 characters
  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (!encryptionKey) {
    fatals.push(
      'ENCRYPTION_KEY is not set. ' +
      'Generate a cryptographically random key of at least 32 characters ' +
      '(e.g. `openssl rand -base64 32`) and set it as an environment variable.'
    );
  } else if (encryptionKey.length < 32) {
    fatals.push(
      `ENCRYPTION_KEY is too short (${encryptionKey.length} chars). It must be at least 32 characters. ` +
      'Regenerate it with a longer value (e.g. `openssl rand -base64 32`).'   );
  }

  // DATABASE_URL: must be a PostgreSQL connection string
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || (!databaseUrl.startsWith('postgresql://') && !databaseUrl.startsWith('postgres://'))) {
    fatals.push(
      `DATABASE_URL is ${!databaseUrl ? 'not set' : 'not a PostgreSQL connection string'}. ` +
      'Set it to a valid postgresql:// or postgres:// connection string.'
    );
  }

  // --- Hard-block on fatal errors ---

  if (fatals.length > 0) {
    console.error('');
    console.error('██  FATAL: Production secrets are missing or insecure. The application cannot start.');
    console.error('');
    console.error('   Fix the following before deploying:');
    fatals.forEach(f => console.error(`   ✖  ${f}`));
    console.error('');
    console.error('   Set the correct values in your environment (.env file, secrets manager, or CI/CD config) and restart.');
    console.error('');
    // Only process.exit in Node.js runtime — not available in Edge
    if (typeof process !== 'undefined' && typeof process.exit === 'function') {
      try { process.exit(1); } catch { /* ignore in Edge runtime */ }
    }
    return;
  }

  // --- Non-critical warnings (do NOT block) ---

  // INTERNAL_SERVICE_SECRET: recommended but not fatal
  // Mini-services will work without it but internal API calls won't be authenticated
  const internalSecret = process.env.INTERNAL_SERVICE_SECRET;
  if (!internalSecret || internalSecret.startsWith('change-me')) {
    warnings.push('  - INTERNAL_SERVICE_SECRET is not set or uses the default value. Mini-services will not be authenticated. Generate with: openssl rand -hex 32');
  }

  if (warnings.length > 0) {
    console.warn('');
    console.warn('⚠️  PRODUCTION SECURITY WARNINGS:');
    console.warn('   The following environment variables need attention:');
    warnings.forEach(w => console.warn(w));
    console.warn('');
  }
}
