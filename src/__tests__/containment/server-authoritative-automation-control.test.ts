import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('Phase 2J server-authoritative automation control', () => {
  it('removes browser-side autonomous execution from the legacy AI dashboard', () => {
    const dashboard = source('src/components/trading/ai-trading-dashboard.tsx');

    expect(dashboard).toContain('<BotsPanel />');
    expect(dashboard).toContain('Server Authoritative');
    expect(dashboard).not.toContain('Math.random');
    expect(dashboard).not.toContain('simulateTrade');
    expect(dashboard).not.toContain('setAIOpenPositions');
    expect(dashboard).not.toContain("method: 'PATCH'");
    expect(dashboard).not.toContain('/api/trading/accounts/');
  });

  it('uses explicit Start and Stop controls with user confirmation instead of an ON/OFF switch', () => {
    const panel = source('src/components/trading/bots-panel.tsx');

    expect(panel).not.toContain('<Switch');
    expect(panel).toContain('Start AI Automation?');
    expect(panel).toContain('Stop AI Automation?');
    expect(panel).toContain('Confirm Start');
    expect(panel).toContain('Confirm Stop');
    expect(panel).toContain('Any open AI-created paper positions will be closed at verified market prices');
    expect(panel).toContain('This control does not close or modify live-broker positions.');
  });

  it('uses a two-phase stopping lifecycle and refuses unexpected non-paper exposure', () => {
    const route = source('src/app/api/trading/bots/[id]/toggle/route.ts');

    expect(route).toContain("'stopping'");
    expect(route).toContain("position.id.startsWith('ppos_')");
    expect(route).toContain('NON_PAPER_AI_EXPOSURE_REQUIRES_REVIEW');
    expect(route).toContain('closePending');
    expect(route).toContain('isExplicitlyDemo');
    expect(route).toContain('validateAutomatedBotConfiguration');
  });

  it('keeps stopping bots and their paper positions visible to the engine until settlement completes', () => {
    const botsRoute = source('src/app/api/trading/engine/bots/route.ts');
    const positionsRoute = source('src/app/api/trading/engine/positions/route.ts');

    for (const text of [botsRoute, positionsRoute]) {
      expect(text).toContain("'stopping'");
      expect(text).toContain('enabled === false');
    }
  });

  it('finalizes stopped only after durable storage proves no open exposure remains', () => {
    const finalizer = source('src/app/api/trading/engine/stop-complete/route.ts');

    expect(finalizer).toContain('enforceInternalAuth');
    expect(finalizer).toContain("status: 'open'");
    expect(finalizer).toContain('PAPER_EXPOSURE_REMAINS');
    expect(finalizer).toContain("status: 'stopped'");
    expect(finalizer).not.toContain('getBroker');
    expect(finalizer).not.toContain('placeOrder');
  });

  it('extends only the deterministic paper close contract for operator Stop', () => {
    const contract = source('src/lib/trading-intelligence/position-reconciliation.ts');
    const closeRoute = source('src/app/api/trading/engine/close/route.ts');

    expect(contract).toContain("'automation_stopped'");
    expect(contract).toContain("intent.marketData.environment !== 'live'");
    expect(contract).toContain('intent.marketData.isSynthetic');
    expect(closeRoute).toContain("'automation_stopped'");
    expect(closeRoute).toContain('validatePaperCloseIntent');
    expect(closeRoute).toContain('validatePaperCloseAgainstPosition');
  });
});
