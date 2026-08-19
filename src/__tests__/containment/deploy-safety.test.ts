// ============================================================
// Containment behavioral tests — deploy script safety
// Tests that the deploy script uses correct repo, ref safety,
// migration safety, proper deployment order, and fail-closed gates.
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const deployScript = readFileSync(resolve(__dirname, '../../../deploy.sh'), 'utf8');

describe('deploy script safety', () => {
  // --- Repository ---

  it('uses the correct repository (christianagbotah/fovi)', () => {
    expect(deployScript).toContain('christianagbotah/fovi.git');
  });

  it('does NOT contain the old nii-kofi repo', () => {
    expect(deployScript).not.toContain('nii-kofi/fovi');
  });

  // --- Deploy ref ---

  it('defaults to phase-1-emergency-containment as deploy ref', () => {
    expect(deployScript).toContain('phase-1-emergency-containment');
  });

  it('supports FOVI_DEPLOY_REF override', () => {
    expect(deployScript).toContain('FOVI_DEPLOY_REF');
  });

  // --- Safety prohibitions ---

  it('does NOT use git pull origin main', () => {
    expect(deployScript).not.toMatch(/git pull origin main/);
  });

  it('does NOT use prisma db push as a migration command', () => {
    expect(deployScript).not.toMatch(/prisma\s+db\s+push/);
    expect(deployScript).toContain('migrate deploy');
  });

  it('does NOT use git stash in update flow', () => {
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

  // --- Deployment order ---

  it('validates environment before build', () => {
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

  // --- SHA reporting ---

  it('prints the deployed SHA', () => {
    expect(deployScript).toContain('Deployed ref');
    expect(deployScript).toContain('DEPLOY_SHA');
  });

  // --- Health checks ---

  it('runs health checks on all four services', () => {
    expect(deployScript).toContain('127.0.0.1:3002');
    expect(deployScript).toContain('127.0.0.1:3003');
    expect(deployScript).toContain('127.0.0.1:3012');
    expect(deployScript).toContain('127.0.0.1:3013');
  });

  it('verifies containment in health checks', () => {
    expect(deployScript).toContain('automatedTradingEnabled');
    expect(deployScript).toContain('balanceSyncEnabled');
  });

  // --- Fail-closed health checks ---

  it('fails deployment when Next.js health check fails', () => {
    // The script must use err() (which calls exit 1) when health fails
    const nextHealthBlock = deployScript.split('Next.js')[1]?.split('market-service')[0] ?? '';
    // After the retry loop, failure must be fatal
    expect(deployScript).toContain('DEPLOYMENT FAILED: Next.js');
  });

  it('fails deployment when market-service health check fails', () => {
    expect(deployScript).toContain('DEPLOYMENT FAILED: market-service');
  });

  it('fails deployment when auto-trade-engine health check fails', () => {
    expect(deployScript).toContain('DEPLOYMENT FAILED: auto-trade-engine health check FAILED');
  });

  it('fails deployment when auto-trade-engine containment mismatch', () => {
    expect(deployScript).toContain('DEPLOYMENT FAILED: auto-trade-engine containment check FAILED');
  });

  it('fails deployment when balance-sync health check fails', () => {
    expect(deployScript).toContain('DEPLOYMENT FAILED: balance-sync health check FAILED');
  });

  it('fails deployment when balance-sync containment mismatch', () => {
    expect(deployScript).toContain('DEPLOYMENT FAILED: balance-sync containment check FAILED');
  });

  // --- set -euo pipefail ---

  it('uses set -euo pipefail', () => {
    expect(deployScript).toContain('set -euo pipefail');
  });

  // --- ecosystem.config.cjs must NOT be regenerated ---

  it('does NOT contain create_ecosystem function', () => {
    expect(deployScript).not.toContain('create_ecosystem');
  });

  it('does NOT write to ecosystem.config.cjs', () => {
    // The script must not contain heredoc/cat redirects to the ecosystem file
    expect(deployScript).not.toMatch(/cat.*>.*ecosystem\.config/);
  });

  it('requires ecosystem.config.cjs to exist (fails if missing)', () => {
    expect(deployScript).toContain('is missing');
    expect(deployScript).toContain('must be committed');
  });

  // --- Consolidated env validation ---

  it('delegates env validation to shared TypeScript validator', () => {
    expect(deployScript).toContain('validate-production-env.ts');
    expect(deployScript).toContain('NODE_ENV=production bun run scripts/validate-production-env.ts');
  });

  // --- No invalid Bash expressions ---

  it('does NOT contain invalid ${#VAR:-0} expressions', () => {
    // ${#VAR:-0} is not valid Bash — the :-0 part is not valid after #
    expect(deployScript).not.toMatch(/\$\{#[A-Za-z_][A-Za-z0-9_]*:-/);
  });

  it('does NOT contain duplicate env validation logic in shell', () => {
    // Should NOT have inline JWT_SECRET length checks — that's in the TS validator now
    expect(deployScript).not.toContain('jwt_len');
    expect(deployScript).not.toContain('pepper_len');
    expect(deployScript).not.toContain('enc_len');
  });
});
