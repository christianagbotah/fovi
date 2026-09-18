'use client';

// ============================================================
// AITradingDashboard — server-authoritative automation surface
// ------------------------------------------------------------
// Phase 2J removes the former browser-side random trading simulator.
// This component is now intentionally thin: all strategy decisions,
// risk sizing, paper opens/closes, settlement, lifecycle transitions,
// and activity truth come from the server-authoritative Bot engine.
//
// There is no browser-generated trading randomness, local position execution,
// browser balance mutation, or duplicate BotConfig execution brain here.
// ============================================================

import { Bot, ShieldCheck, ServerCog } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { BotsPanel } from '@/components/trading/bots-panel';

export function AITradingDashboard() {
  return (
    <div className="space-y-4">
      <Card className="border-primary/20 overflow-hidden">
        <CardContent className="p-4 lg:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                <ServerCog className="h-5 w-5 text-primary" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-base font-bold">AI Automation Control</h1>
                  <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600">
                    Server Authoritative
                  </Badge>
                  <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-600">
                    Paper Trading
                  </Badge>
                </div>
                <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
                  Fovi&apos;s server engine is the single source of truth for AI strategy decisions,
                  risk controls, paper execution, settlement, and Start/Stop lifecycle state.
                  Browser-side simulated execution has been removed.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
              <span>Live-money execution remains disabled</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <BotsPanel />

      <div className="flex items-center justify-center gap-2 text-[11px] text-muted-foreground">
        <Bot className="h-3.5 w-3.5" />
        <span>
          Start/Stop controls, engine activity, strategy settings, and paper performance are all shown from persisted server state.
        </span>
      </div>
    </div>
  );
}
