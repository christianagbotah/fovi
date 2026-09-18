import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('Phase 2K durable AI decision journal containment', () => {
  it('uses a fixed-field journal instead of arbitrary secret-bearing metadata', () => {
    const schema = source('prisma/schema.prisma');
    const migration = source('prisma/migrations/20260918124500_ai_decision_journal/migration.sql');

    expect(schema).toContain('model AiDecisionJournal');
    expect(schema).toContain('marketDataSource');
    expect(schema).not.toMatch(/model AiDecisionJournal[\s\S]*?metadata\s+String/);
    expect(migration).toContain('CREATE TABLE "AiDecisionJournal"');
    expect(migration).not.toContain('"metadata"');
    expect(migration).not.toContain('"payload"');
  });

  it('keeps the engine writer internal-only, append-only, tenant-bound, and idempotent', () => {
    const writer = source('src/app/api/trading/engine/decisions/route.ts');
    const proxy = source('src/proxy.ts');

    expect(proxy).toContain("'/api/trading/engine/decisions'");
    expect(writer).toContain('enforceInternalAuth');
    expect(writer).toContain('id: entry.botId');
    expect(writer).toContain('userId: entry.userId');
    expect(writer).toContain('accountId: entry.accountId');
    expect(writer).toContain('aiDecisionJournal.findUnique');
    expect(writer).toContain('aiDecisionJournal.create');
    expect(writer).not.toContain('aiDecisionJournal.update');
    expect(writer).not.toContain('aiDecisionJournal.delete');
  });

  it('scopes user-visible decision history to both user and bot', () => {
    const reader = source('src/app/api/trading/bots/[id]/decisions/route.ts');

    expect(reader).toContain('getUserIdSync');
    expect(reader).toContain('where: { id: botId, userId }');
    expect(reader).toContain('where: { botId, userId }');
    expect(reader).toContain('Math.min(100');
  });

  it('requires durable trade approval journaling before any new paper execution call', () => {
    const core = source('mini-services/auto-trade-engine/process-bot-core.ts');

    const approval = core.indexOf("code: 'TRADE_APPROVED'");
    const persist = core.indexOf('await persistDecision(config, deps, {', approval - 300);
    const execute = core.indexOf('await deps.executeTrade(config', approval);

    expect(approval).toBeGreaterThan(-1);
    expect(persist).toBeGreaterThan(-1);
    expect(execute).toBeGreaterThan(approval);
    expect(persist).toBeLessThan(execute);
  });

  it('keeps protective position settlement ahead of new-exposure journal gating', () => {
    const core = source('mini-services/auto-trade-engine/process-bot-core.ts');

    const closeLoop = core.indexOf('for (const pos of botPositions)');
    const closeCall = core.indexOf('await deps.closePosition', closeLoop);
    const newDecisionJournal = core.indexOf("stage: 'strategy'", closeCall);

    expect(closeLoop).toBeGreaterThan(-1);
    expect(closeCall).toBeGreaterThan(closeLoop);
    expect(newDecisionJournal).toBeGreaterThan(closeCall);
  });

  it('makes decision-journal POST retries safe through deterministic IDs', () => {
    const reliability = source('mini-services/auto-trade-engine/engine-reliability.ts');
    const engine = source('mini-services/auto-trade-engine/index.ts');

    expect(reliability).toContain("'/api/trading/engine/decisions'");
    expect(engine).toContain("'/api/trading/engine/decisions'");
    expect(engine).toContain('decisionCycleId');
  });
});
