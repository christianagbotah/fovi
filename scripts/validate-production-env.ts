// ============================================================
// CLI: Production Environment Validator
// ============================================================
// Invoked by deploy.sh with NODE_ENV=production.
// Delegates to the shared TypeScript validator (src/lib/production-check.ts)
// so there is exactly ONE source of truth for production env policy.
//
// Exit 0 = all valid
// Exit 1 = fatal issues
// ============================================================

import { validateProductionEnvDry } from '../src/lib/production-check';

const { fatals, warnings } = validateProductionEnvDry();

if (fatals.length > 0) {
  console.error('');
  console.error('FATAL: Production environment validation FAILED.');
  console.error('');
  fatals.forEach(f => console.error('  x  ' + f));
  console.error('');
  process.exit(1);
}

if (warnings.length > 0) {
  console.warn('');
  console.warn('WARNINGS:');
  warnings.forEach(w => console.warn('  !  ' + w));
  console.warn('');
}

console.log('Production environment validation: PASSED');
process.exit(0);
