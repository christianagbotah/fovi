import { validateProductionEnv } from '@/lib/production-check';

export async function register() {
  validateProductionEnv();
}
