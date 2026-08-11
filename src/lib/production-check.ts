// ============================================================
// Production Environment Validation
// Logs warnings on startup if critical secrets are using defaults.
// Does NOT block the app — just warns.
// ============================================================

const DEFAULTS: Record<string, string> = {
  JWT_SECRET: 'fovi-dev-jwt-secret-change-in-production',
  AUTH_PEPPER: 'fovi-ai-pepper-2024',
};

export function validateProductionEnv(): void {
  if (process.env.NODE_ENV !== 'production') return;

  const warnings: string[] = [];

  for (const [key, defaultValue] of Object.entries(DEFAULTS)) {
    if (process.env[key] === defaultValue || !process.env[key]) {
      warnings.push(`  - ${key} is using the default value. Set a strong random value in production.`);
    }
  }

  if (!process.env.DATABASE_URL?.startsWith('postgresql://') &&
      !process.env.DATABASE_URL?.startsWith('postgres://')) {
    warnings.push('  - DATABASE_URL is not a PostgreSQL connection string. The app will run in demo-only mode.');
  }

  if (warnings.length > 0) {
    console.warn('');
    console.warn('⚠️  PRODUCTION SECURITY WARNINGS:');
    console.warn('   The following environment variables need attention:');
    warnings.forEach(w => console.warn(w));
    console.warn('');
  }
}
