import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('Phase 2L novice AI decision explainability UI', () => {
  it('loads only persisted tenant-scoped decision history', () => {
    const component = source('src/components/trading/ai-decision-timeline.tsx');

    expect(component).toContain('/api/trading/bots/${encodeURIComponent(botId)}/decisions?limit=20');
    expect(component).toContain("cache: 'no-store'");
    expect(component).not.toContain("method: 'POST'");
    expect(component).not.toContain("method: 'PUT'");
    expect(component).not.toContain("method: 'DELETE'");
  });

  it('presents novice explanations before optional technical details', () => {
    const component = source('src/components/trading/ai-decision-timeline.tsx');

    expect(component).toContain('Why AI did this');
    expect(component).toContain('The AI recently opened a position and is waiting before considering another one.');
    expect(component).toContain('Recent losses reached the bot safety limit, so the AI paused new trades.');
    expect(component).toContain('The AI could not verify trustworthy fresh market data, so it did not trade.');
    expect(component).toContain('The strategy, market-data, autonomy, and risk checks all passed for this paper trade.');
    expect(component).toContain('<details className="mt-2">');
    expect(component).toContain('Technical details');
    expect(component).toContain('Decision code');
    expect(component).toContain('Risk engine');
    expect(component).toContain('Market data');
  });

  it('refreshes persisted reasoning without becoming a trading control surface', () => {
    const component = source('src/components/trading/ai-decision-timeline.tsx');

    expect(component).toContain('60_000');
    expect(component).toContain('Refresh');
    expect(component).not.toContain('Start AI Automation');
    expect(component).not.toContain('Stop AI Automation');
    expect(component).not.toContain('/toggle');
    expect(component).not.toContain('/engine/execute');
  });

  it('returns an explicit display-safe projection while preserving tenant filtering', () => {
    const route = source('src/app/api/trading/bots/[id]/decisions/route.ts');

    expect(route).toContain('where: { id: botId, userId }');
    expect(route).toContain('where: { botId, userId }');
    expect(route).toContain('select: {');
    expect(route).toContain('cycleId: true');
    expect(route).toContain('reason: true');
    expect(route).toContain('riskEngineVersion: true');
    expect(route).toContain('marketDataSource: true');

    const selectStart = route.indexOf('select: {', route.indexOf('aiDecisionJournal.findMany'));
    const selectEnd = route.indexOf('},\\n      orderBy:', selectStart);
    const projection = route.slice(selectStart, selectEnd);

    expect(projection).not.toContain('userId: true');
    expect(projection).not.toContain('accountId: true');
    expect(projection).not.toContain('contractVersion: true');
  });

  it('mounts reasoning only inside an expanded bot details panel', () => {
    const panel = source('src/components/trading/bots-panel.tsx');

    const expandedBlock = panel.indexOf('{expanded && (');
    const timeline = panel.indexOf('<AiDecisionTimeline botId={bot.id} botName={bot.name} />');

    expect(panel).toContain("import { AiDecisionTimeline }");
    expect(expandedBlock).toBeGreaterThan(-1);
    expect(timeline).toBeGreaterThan(expandedBlock);
  });
});
