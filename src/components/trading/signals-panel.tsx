'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  TrendingUp, TrendingDown, Zap, Sparkles,
  BarChart3, Target, ArrowRightLeft, Activity, Waves,
  Loader2, RefreshCw, Crosshair,
} from 'lucide-react';
import { useTradingStore } from '@/lib/store/trading-store';
import { formatPrice } from '@/lib/market-sim';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const SIGNAL_ICONS: Record<string, any> = {
  rsi_divergence: Activity,
  macd_crossover: BarChart3,
  bollinger_squeeze: Waves,
  breakout: Target,
  support_resistance: Target,
  trend_reversal: ArrowRightLeft,
  momentum_shift: Zap,
  ai_predicted: Sparkles,
};

const SIGNAL_LABELS: Record<string, string> = {
  rsi_divergence: 'RSI Divergence',
  macd_crossover: 'MACD Cross',
  bollinger_squeeze: 'BB Squeeze',
  breakout: 'Breakout',
  support_resistance: 'S/R Level',
  trend_reversal: 'Trend Reversal',
  momentum_shift: 'Momentum',
  ai_predicted: 'AI Predicted',
};

export function SignalsPanel() {
  const {
    signals, setSignals, setSignalDetailId,
    setOrderSheetOpen, setOrderSymbol,
    setOrderStopLoss, setOrderTakeProfit, setOrderEntryPrice,
  } = useTradingStore();
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = useCallback(async () => {
    if (generating) return;
    setGenerating(true);
    setError(null);

    try {
      const res = await fetch('/api/trading/signals/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeframe: '1h', riskTolerance: 'medium' }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Generation failed');
        return;
      }

      if (Array.isArray(data) && data.length > 0) {
        const normalized = data.map((s: any) => ({
          ...s,
          direction: s.direction === 'long' ? 'bullish' : s.direction === 'short' ? 'bearish' : s.direction,
        }));
        setSignals([...normalized, ...signals]);
      } else {
        setError('No signals found. Markets may be range-bound — try again later.');
      }
    } catch (err) {
      setError('Failed to reach signal engine. Check your connection.');
    } finally {
      setGenerating(false);
    }
  }, [generating, signals, setSignals]);

  // Auto-load existing signals from API on mount
  useEffect(() => {
    if (signals.length > 0) return;
    fetch('/api/trading/signals')
      .then(res => res.ok ? res.json() : [])
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          const normalized = data.map((s: any) => ({
            ...s,
            direction: s.direction === 'long' ? 'bullish' : s.direction === 'short' ? 'bearish' : s.direction,
          }));
          setSignals(normalized);
        }
      })
      .catch(() => { /* non-critical */ });
  }, []);

  // Quick-trade from signal: auto-fills symbol, side, SL, TP into order form
  const handleQuickTrade = (sig: any, e: React.MouseEvent) => {
    e.stopPropagation(); // Don't trigger signal detail
    const isBullish = sig.direction === 'bullish' || sig.direction === 'long';
    setOrderSymbol(sig.symbol);
    setOrderEntryPrice(sig.entryPrice || null);
    setOrderStopLoss(sig.stopLoss ?? null);
    setOrderTakeProfit(sig.takeProfit ?? null);
    setOrderSheetOpen(true);
  };

  // Loading state
  if (generating) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-6">
        <div className="relative">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <Sparkles className="h-4 w-4 text-primary/50 absolute -top-1 -right-1" />
        </div>
        <p className="text-sm font-medium mt-4">Scanning Markets...</p>
        <p className="text-xs text-muted-foreground mt-1">Running technical analysis on 10 symbols</p>
        <div className="flex flex-wrap justify-center gap-1.5 mt-3">
          {['RSI', 'MACD', 'BB', 'EMA', 'ADX'].map(ind => (
            <span key={ind} className="text-[9px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
              {ind}
            </span>
          ))}
        </div>
      </div>
    );
  }

  // Empty state with generate button
  if (signals.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-6">
        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
          <Sparkles className="h-6 w-6 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium">No Active Signals</p>
        <p className="text-xs text-muted-foreground mt-1 mb-1">
          Run AI-powered technical analysis across all markets
        </p>
        {error && (
          <p className="text-xs text-red-500 mb-3">{error}</p>
        )}
        <Button size="sm" className="mt-2 gap-1.5" onClick={handleGenerate}>
          <Zap className="h-3.5 w-3.5" />
          Generate Signals
        </Button>
        <p className="text-[10px] text-muted-foreground mt-3">
          Analyzes RSI, MACD, Bollinger Bands, EMA crossovers & more
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
        <span className="text-xs font-medium text-muted-foreground">
          {signals.length} active signals
        </span>
        <div className="flex items-center gap-1.5">
          {error && <span className="text-[10px] text-red-500">{error}</span>}
          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={handleGenerate} disabled={generating}>
            <RefreshCw className={generating ? 'h-3 w-3 animate-spin' : 'h-3 w-3'} />
            Rescan
          </Button>
        </div>
      </div>
      <div
        className="overflow-y-auto divide-y divide-border"
        style={{ flex: '1 1 0%', minHeight: 0 }}
      >
        {signals.map(sig => {
          const IconComp = SIGNAL_ICONS[sig.signalType] || Zap;
          const isBullish = sig.direction === 'bullish' || sig.direction === 'long';
          const confidence = typeof sig.confidence === 'number'
            ? (sig.confidence > 1 ? Math.round(sig.confidence) : Math.round(sig.confidence * 100))
            : parseInt(String(sig.confidence)) || 0;

          return (
            <div
              key={sig.id}
              className={"p-3 border-l-2 transition-colors cursor-pointer " + (isBullish ? 'border-l-emerald-500 bg-emerald-500/5' : 'border-l-red-500 bg-red-500/5')}
              onClick={() => setSignalDetailId(sig.id)}
            >
              <div className="flex items-start gap-2.5">
                <div className={"w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 " + (isBullish ? 'bg-emerald-500/15' : 'bg-red-500/15')}>
                  {isBullish
                    ? <TrendingUp className="h-4 w-4 text-emerald-500" />
                    : <TrendingDown className="h-4 w-4 text-red-500" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold">{sig.symbol}</span>
                    <Badge variant="outline" className="text-[10px] h-5">{SIGNAL_LABELS[sig.signalType] || sig.signalType}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{sig.reasoning}</p>
                  <div className="flex items-center gap-3 mt-1.5">
                    <span className={"text-xs font-bold " + (isBullish ? 'text-emerald-500' : 'text-red-500')}>
                      {confidence}% confidence
                    </span>
                    {sig.stopLoss && <span className="text-[10px] text-muted-foreground">SL: {formatPrice(sig.stopLoss, sig.symbol)}</span>}
                    {sig.takeProfit && <span className="text-[10px] text-muted-foreground">TP: {formatPrice(sig.takeProfit, sig.symbol)}</span>}
                  </div>
                </div>
                <Button
                  size="sm"
                  className={"shrink-0 h-8 px-3 text-xs font-semibold gap-1.5 cursor-pointer " + (
                    isBullish
                      ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                      : 'bg-red-600 hover:bg-red-700 text-white'
                  )}
                  onClick={(e) => handleQuickTrade(sig, e)}
                >
                  <Crosshair className="h-3 w-3" />
                  Trade
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
