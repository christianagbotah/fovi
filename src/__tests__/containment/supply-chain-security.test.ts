import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const workflowsDir = resolve(__dirname, '../../../.github/workflows');
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const workflows = workflowFiles.map((name) => ({
  name,
  content: readFileSync(resolve(workflowsDir, name), 'utf8'),
}));

const SHA_PINNED_ACTION = /uses:\s+[^\s@]+@([0-9a-f]{40})(?:\s+#.*)?$/i;
const UNPINNED_POSTGRES = /postgres:16-alpine(?!@sha256:[0-9a-f]{64})/i;

describe('Phase 3D supply-chain security policy', () => {
  it('keeps every GitHub Action dependency pinned to a full immutable commit SHA', () => {
    expect(workflows.length).toBeGreaterThan(0);

    for (const { name, content } of workflows) {
      const actionLines = content
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('uses:'));

      for (const line of actionLines) {
        expect(line, `${name}: action reference must use a 40-character commit SHA`).toMatch(SHA_PINNED_ACTION);
      }
    }
  });

  it('does not allow mutable ubuntu-latest runners or pull_request_target', () => {
    for (const { name, content } of workflows) {
      expect(content, `${name}: mutable ubuntu-latest runner is forbidden`).not.toContain('ubuntu-latest');
      expect(content, `${name}: pull_request_target is forbidden`).not.toContain('pull_request_target:');
    }
  });

  it('keeps workflow permissions read-only and checkout credentials non-persistent', () => {
    for (const { name, content } of workflows) {
      expect(content, `${name}: workflow must declare read-only contents permission`).toContain(
        'permissions:\n  contents: read',
      );

      if (content.includes('actions/checkout@')) {
        expect(content, `${name}: checkout credentials must not persist`).toContain('persist-credentials: false');
      }
    }
  });

  it('pins every PostgreSQL 16 Alpine image reference by sha256 digest', () => {
    for (const { name, content } of workflows) {
      expect(content, `${name}: PostgreSQL image must be immutable`).not.toMatch(UNPINNED_POSTGRES);
    }
  });

  it('pins the approved action provenance to the verified repositories and commits', () => {
    const combined = workflows.map(({ content }) => content).join('\n');

    expect(combined).toContain('actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1');
    expect(combined).toContain('oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6');

    for (const { content } of workflows) {
      expect(content).not.toMatch(/actions\/checkout@v\d/i);
      expect(content).not.toMatch(/oven-sh\/setup-bun@v\d/i);
      expect(content).not.toMatch(/actions\/upload-artifact@v\d/i);
    }
  });

  it('audits the root and all three mini-service lockfiles at high severity', () => {
    const workflow = readFileSync(resolve(workflowsDir, 'supply-chain-security.yml'), 'utf8');

    expect(workflow).toContain("test \"$(bun --version)\" = '1.3.4'");
    expect(workflow).toContain('bun.lock');
    expect(workflow).toContain('mini-services/auto-trade-engine/bun.lock');
    expect(workflow).toContain('mini-services/balance-sync/bun.lock');
    expect(workflow).toContain('mini-services/market-service/bun.lock');
    expect(workflow).toContain('mini-services/auto-trade-engine');
    expect(workflow).toContain('mini-services/balance-sync');
    expect(workflow).toContain('mini-services/market-service');
    expect(workflow).toContain('bun audit --audit-level=high');
    expect(workflow).toContain('bun install --frozen-lockfile');
  });

  it('keeps the PostgreSQL runtime qualification image on the approved digest', () => {
    const approved = 'postgres:16-alpine@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685';
    const runtimeWorkflows = [
      'staging-runtime-qualification.yml',
      'backup-restore-qualification.yml',
      'runtime-fault-recovery.yml',
    ];

    for (const name of runtimeWorkflows) {
      const workflow = readFileSync(resolve(workflowsDir, name), 'utf8');
      expect(workflow, `${name}: PostgreSQL digest drifted`).toContain(approved);
    }
  });
});
