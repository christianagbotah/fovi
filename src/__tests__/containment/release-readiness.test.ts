import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../../..');
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
  scripts?: Record<string, string>;
};
const deployScript = readFileSync(resolve(root, 'deploy.sh'), 'utf8');
const ciWorkflow = readFileSync(resolve(root, '.github/workflows/phase1-ci.yml'), 'utf8');
const gitignore = readFileSync(resolve(root, '.gitignore'), 'utf8');

describe('Phase 2J release-readiness invariants', () => {
  it('keeps containment-only and soak as individually runnable CI gates', () => {
    expect(packageJson.scripts?.['test:containment-only']).toContain('src/__tests__/containment/');
    expect(packageJson.scripts?.['test:soak']).toContain('src/__tests__/soak/');
    expect(ciWorkflow).toContain('bun run test:containment-only');
    expect(ciWorkflow).toContain('bun run test:soak');
  });

  it('makes the deploy containment command include the deterministic soak gate', () => {
    const deploymentGate = packageJson.scripts?.['test:containment'] ?? '';
    expect(deploymentGate).toContain('bun run test:containment-only');
    expect(deploymentGate).toContain('bun run test:soak');
    expect(deployScript).toContain('bun run test:containment');
  });

  it('does not ship the stale local SQLite database in the release tree', () => {
    expect(existsSync(resolve(root, 'db/custom.db'))).toBe(false);
  });

  it('ignores future local database artifacts under db/', () => {
    expect(gitignore).toContain('/db/*.db');
    expect(gitignore).toContain('/db/*.db-journal');
  });
});
