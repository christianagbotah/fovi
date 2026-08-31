import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('auto-trade engine control-plane containment', () => {
  it('does not directly connect to PostgreSQL or query Bot rows', () => {
    const enginePath = join(process.cwd(), 'mini-services/auto-trade-engine/index.ts');
    const source = readFileSync(enginePath, 'utf8');

    expect(source).not.toContain("from 'postgres'");
    expect(source).not.toContain('postgres(');
    expect(source).not.toContain('SELECT');
    expect(source).not.toContain('UPDATE "Bot"');
    expect(source).toContain("callNextJSApi('GET', '/api/trading/engine/bots')");
    expect(source).toMatch(/callNextJSApi\(\s*'POST',\s*'\/api\/trading\/engine\/execute'/);
  });

  it('has no postgres runtime dependency in the mini-service manifest', () => {
    const packagePath = join(process.cwd(), 'mini-services/auto-trade-engine/package.json');
    const manifest = JSON.parse(readFileSync(packagePath, 'utf8')) as { dependencies?: Record<string, string> };
    expect(manifest.dependencies?.postgres).toBeUndefined();
  });
});
