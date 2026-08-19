// ============================================================
// Containment behavioral tests — deploy script safety (Req 6,7,8,12)
// Tests that the deploy script uses correct repo, ref safety,
// migration safety, and proper deployment order.
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const deployScript = readFileSync(resolve(__dirname, '../../../deploy.sh'), 'utf8');

const REQUIRED_DEPLOY_ORDER = [
  'resolve.*ref|resolve_deploy_sha',
  'clean.*source|git status',
  'preserve.*env|setup_env',
  'validate.*env|validate_env',
  'frozen.lockfile|install_deps',
  'prisma generate',
  'typecheck|tsc',
  'containment.*test|test:containment',
  'build',
  'migrate deploy',
  'pm2.*restart|pm2 start',
  'health.*check',
];

describe('deploy script safety', () => {
  it('uses the correct repository (christianagbotah/fovi)', () => {
    expect(deployScript).toContain('christianagbotah/fovi.git');
  });

  it('does NOT contain the old nii-kofi repo', () => {
    expect(deployScript).not.toContain('nii-kofi/fovi');
  });

  it('defaults to phase-1-emergency-containment as deploy ref', () => {
    expect(deployScript).toContain('phase-1-emergency-containment');
  });

  it('supports FOVI_DEPLOY_REF override', () => {
    expect(deployScript).toContain('FOVI_DEPLOY_REF');
  });

  it('does NOT use git pull origin main', () => {
    expect(deployScript).not.toMatch(/git pull origin main/);
  });

  it('does NOT use prisma db push as a migration command', () => {
    expect(deployScript).not.toMatch(/prisma\s+db\s+push/);
    expect(deployScript).toContain('migrate deploy');
  });

  it('does NOT use git stash in update flow', () => {
    // The update flow should reject dirty trees, not stash them
    const updateSection = deployScript.split('update_deploy()')[1]?.split('first_deploy')[0] ?? '';
    expect(updateSection).not.toContain('git stash');
  });

  it('rejects dirty source trees in update flow', () => {
    expect(deployScript).toContain('dirty');
    expect(deployScript).toContain('uncommitted');
  });

  it('preserves .env and never overwrites it', () => {
    expect(deployScript).toContain('NOT be overwritten');
  });

  it('prints the deployed SHA', () => {
    expect(deployScript).toContain('Deployed ref');
    expect(deployScript).toContain('DEPLOY_SHA');
  });

  it('runs health checks', () => {
    expect(deployScript).toContain('health_check');
    expect(deployScript).toContain('127.0.0.1:3002');
    expect(deployScript).toContain('127.0.0.1:3003');
    expect(deployScript).toContain('127.0.0.1:3012');
    expect(deployScript).toContain('127.0.0.1:3013');
  });

  it('verifies containment in health checks', () => {
    expect(deployScript).toContain('automatedTradingEnabled');
    expect(deployScript).toContain('balanceSyncEnabled');
  });

  it('uses set -euo pipefail', () => {
    expect(deployScript).toContain('set -euo pipefail');
  });

  it('validates environment before build', () => {
    // Check validate_env is called before build in update_deploy
    const updateSection = deployScript.split('update_deploy()')[1]?.split('first_deploy')[0] ?? '';
    const validatePos = updateSection.indexOf('validate_env');
    const buildPos = updateSection.indexOf('build_app');
    expect(validatePos).toBeGreaterThan(-1);
    expect(buildPos).toBeGreaterThan(validatePos);
  });

  it('runs typecheck before build', () => {
    const updateSection = deployScript.split('update_deploy()')[1]?.split('first_deploy')[0] ?? '';
    const typecheckPos = updateSection.indexOf('typecheck_gate');
    const buildPos = updateSection.indexOf('build_app');
    expect(typecheckPos).toBeGreaterThan(-1);
    expect(buildPos).toBeGreaterThan(typecheckPos);
  });

  it('runs containment tests before build', () => {
    const updateSection = deployScript.split('update_deploy()')[1]?.split('first_deploy')[0] ?? '';
    const containmentPos = updateSection.indexOf('run_containment_tests');
    const buildPos = updateSection.indexOf('build_app');
    expect(containmentPos).toBeGreaterThan(-1);
    expect(buildPos).toBeGreaterThan(containmentPos);
  });
});
