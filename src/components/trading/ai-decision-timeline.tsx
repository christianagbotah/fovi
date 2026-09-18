'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Target,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface AiDecisionEntry {
  id: string;
  cycleId: string;
  stage: 'autonomy' | 'strategy' | 'market_data' | 'risk' | 'execution';
  outcome: 'hold' | 'suspend' | 'reject' | 'approve';
  code: string;
  reason: string;
  symbol: string | null;
  side: string | null;
  confidence: number | null;
  strategy: string | null;
  timeframe: string | null;
  strategyVersion: string | null;
  riskEngineVersion: string | null;
  supervisorVersion: string | null;
  positionNotional: number | null;
  riskAmount: number | null;
  riskPercentOfAllocation: number | null;
  riskReward: number | null;
  marketDataEnvironment: string | null;
  marketDataSynthetic: boolean | null;
  marketDataSource: string | null;
  marketObservedAt: string | null;
  createdAt: string;
}

interface DecisionResponse {
  botId: string;
  decisions: AiDecisionEntry[];
}

function timeAgo(value: string): string {
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms)) return 'recently';
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function plainLanguage(decision: AiDecisionEntry): string {
  switch (decision.code) {
    case 'NEW_EXPOSURE_COOLDOWN':
      return 'The AI recently opened a position and is waiting before considering another one.';
    case 'POSITION_LIMIT_REACHED':
      return 'The bot already has the maximum number of open positions allowed by its safety settings.';
    case 'DRAWDOWN_CIRCUIT_BREAKER':
      return 'Recent losses reached the bot safety limit, so the AI paused new trades.';
    case 'ENGINE_FAILURE_CIRCUIT_BREAKER':
      return 'The trading engine had repeated failures, so the AI paused new trades until the system is healthy again.';
    case 'NO_VALID_CANDIDATE':
    case 'NO_STRATEGY_DECISION':
      return 'The market setup did not meet this strategy’s rules strongly enough to trade.';
    case 'NO_SYMBOLS_AVAILABLE':
      return 'Every configured symbol already has exposure or is unavailable for a new position.';
    case 'UNSUPPORTED_VERIFIED_TIMEFRAME':
      return 'This bot is not using the verified timeframe required for autonomous decisions.';
    case 'MARKET_DATA_UNAVAILABLE':
    case 'UNVERIFIED_MARKET_DATA':
      return 'The AI could not verify trustworthy fresh market data, so it did not trade.';
    case 'AUTOMATED_PAPER_EXECUTION_DISABLED':
      return 'The strategy and risk checks passed, but automatic paper execution is currently disabled.';
    case 'TRADE_APPROVED':
      return 'The strategy, market-data, autonomy, and risk checks all passed for this paper trade.';
    case 'ANALYSIS_ERROR':
      return 'The AI could not safely complete its analysis, so it did not open a new position.';
    default:
      return decision.reason;
  }
}

function titleFor(decision: AiDecisionEntry): string {
  if (decision.stage === 'execution' && decision.outcome === 'approve') return 'AI approved a paper trade';
  if (decision.stage === 'risk' && decision.outcome === 'reject') return 'Trade blocked by risk rules';
  if (decision.stage === 'market_data') return 'AI skipped this market check';
  if (decision.stage === 'autonomy' && decision.outcome === 'suspend') return 'AI paused new trades';
  if (decision.stage === 'autonomy') return 'AI waited before trading';
  if (decision.stage === 'execution') return 'Execution stayed off';
  return 'No trade setup passed';
}

function outcomeClasses(outcome: AiDecisionEntry['outcome']): string {
  if (outcome === 'approve') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
  if (outcome === 'suspend') return 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400';
  if (outcome === 'reject') return 'border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-400';
  return 'border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400';
}

function DecisionIcon({ decision }: { decision: AiDecisionEntry }) {
  if (decision.outcome === 'approve') return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  if (decision.stage === 'risk') return <ShieldCheck className="h-4 w-4 text-orange-500" />;
  if (decision.outcome === 'suspend') return <AlertTriangle className="h-4 w-4 text-red-500" />;
  if (decision.stage === 'strategy') return <Target className="h-4 w-4 text-blue-500" />;
  return <Bot className="h-4 w-4 text-muted-foreground" />;
}

export function AiDecisionTimeline({
  botId,
  botName,
}: {
  botId: string;
  botName: string;
}) {
  const [decisions, setDecisions] = useState<AiDecisionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/trading/bots/${encodeURIComponent(botId)}/decisions?limit=20`,
        { cache: 'no-store' },
      );
      const body = await res.json().catch(() => null) as DecisionResponse | { error?: string } | null;
      if (!res.ok) {
        throw new Error(body && 'error' in body && body.error ? body.error : 'Could not load AI decision history.');
      }
      const list = body && 'decisions' in body && Array.isArray(body.decisions)
        ? body.decisions
        : [];
      setDecisions(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load AI decision history.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [botId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  return (
    <div className="rounded-xl border border-border/40 bg-muted/[0.18] overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-3 py-2.5 border-b border-border/40">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Bot className="h-3.5 w-3.5 text-primary" />
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Why AI did this
            </p>
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Persisted explanations from {botName}&apos;s autonomous decision engine.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void load(true)}
          disabled={refreshing}
          className="h-7 px-2 text-[10px] cursor-pointer"
        >
          {refreshing ? (
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3 mr-1" />
          )}
          Refresh
        </Button>
      </div>

      <div className="p-3">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-5 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading AI reasoning…
          </div>
        ) : error ? (
          <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/[0.05] p-2.5">
            <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-red-600 dark:text-red-400">
                Decision history unavailable
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{error}</p>
            </div>
          </div>
        ) : decisions.length === 0 ? (
          <div className="text-center py-5">
            <Bot className="h-5 w-5 mx-auto text-muted-foreground/50 mb-1.5" />
            <p className="text-xs font-medium">No AI decisions recorded yet</p>
            <p className="text-[10px] text-muted-foreground mt-1">
              Start the bot or wait for an engine cycle. Decisions will appear here and remain after restarts.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {decisions.map((decision) => (
              <div
                key={decision.id}
                className="rounded-lg border border-border/30 bg-background/70 p-2.5"
              >
                <div className="flex items-start gap-2.5">
                  <div className="mt-0.5 shrink-0">
                    <DecisionIcon decision={decision} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-[11px] font-semibold">{titleFor(decision)}</p>
                      <Badge
                        variant="outline"
                        className={`h-4 px-1.5 text-[9px] ${outcomeClasses(decision.outcome)}`}
                      >
                        {decision.outcome.toUpperCase()}
                      </Badge>
                      {decision.symbol && (
                        <Badge variant="secondary" className="h-4 px-1.5 text-[9px]">
                          {decision.symbol}
                        </Badge>
                      )}
                      {decision.confidence !== null && (
                        <span className="text-[9px] text-muted-foreground">
                          {decision.confidence.toFixed(0)}% confidence
                        </span>
                      )}
                    </div>

                    <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                      {plainLanguage(decision)}
                    </p>

                    <div className="flex items-center gap-1 mt-1.5 text-[9px] text-muted-foreground/70">
                      <Clock className="h-2.5 w-2.5" />
                      <span>{timeAgo(decision.createdAt)}</span>
                      <span>·</span>
                      <span className="capitalize">{decision.stage.replace('_', ' ')}</span>
                    </div>

                    <details className="mt-2">
                      <summary className="text-[9px] font-medium text-muted-foreground cursor-pointer select-none">
                        Technical details
                      </summary>
                      <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 rounded-md bg-muted/35 p-2 text-[9px] text-muted-foreground">
                        <span>Decision code</span>
                        <span className="font-mono break-all text-foreground">{decision.code}</span>
                        <span>Cycle</span>
                        <span className="font-mono break-all text-foreground">{decision.cycleId}</span>
                        {decision.side && (
                          <>
                            <span>Direction</span>
                            <span className="uppercase text-foreground">{decision.side}</span>
                          </>
                        )}
                        {decision.positionNotional !== null && (
                          <>
                            <span>Position size</span>
                            <span className="text-foreground">${decision.positionNotional.toFixed(2)}</span>
                          </>
                        )}
                        {decision.riskAmount !== null && (
                          <>
                            <span>Risk amount</span>
                            <span className="text-foreground">${decision.riskAmount.toFixed(2)}</span>
                          </>
                        )}
                        {decision.riskReward !== null && (
                          <>
                            <span>Risk / reward</span>
                            <span className="text-foreground">{decision.riskReward.toFixed(2)} : 1</span>
                          </>
                        )}
                        {decision.marketDataSource && (
                          <>
                            <span>Market data</span>
                            <span className="text-foreground">
                              {decision.marketDataSource}
                              {decision.marketDataSynthetic === false ? ' · verified' : ''}
                            </span>
                          </>
                        )}
                        {decision.strategyVersion && (
                          <>
                            <span>Strategy engine</span>
                            <span className="font-mono break-all text-foreground">{decision.strategyVersion}</span>
                          </>
                        )}
                        {decision.riskEngineVersion && (
                          <>
                            <span>Risk engine</span>
                            <span className="font-mono break-all text-foreground">{decision.riskEngineVersion}</span>
                          </>
                        )}
                        {decision.supervisorVersion && (
                          <>
                            <span>Supervisor</span>
                            <span className="font-mono break-all text-foreground">{decision.supervisorVersion}</span>
                          </>
                        )}
                      </div>
                    </details>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
