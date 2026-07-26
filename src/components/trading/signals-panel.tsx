'use client';

import { useEffect, useState } from 'react';
import {
  TrendingUp, TrendingDown, Zap, Sparkles,
  BarChart3, Target, ArrowRightLeft, Activity, Waves,
} from 'lucide-react';
import { useTradingStore } from '@/lib/store/trading-store';
import { getSignalBgClass, getSignalColor, formatPrice } from '@/lib/market-sim';
import type { TradingSignal } from '@/lib/types';
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
  const { signals, setSignals, setSignalDetailId, setIsLoading, selectedSymbol } = useTradingStore();
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    fetchSignals();
  }, []);

  const fetchSignals = async () => {
    try {
      const res = await fetch('/api/trading/signals');
      if (res.ok) setSignals(await res.json());
    } catch { /* */ }
  };

  const handleGenerate = async () => {
    if (!selectedSymbol || generating) return;
    setGenerating(true);
    setIsLoading(true);
    try {
      const res = await fetch('/api/trading/signals/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: selectedSymbol, timeframe: '1h' }),
      });
      if (res.ok) {
        const newSignals = await res.json();
        setSignals([...newSignals, ...signals]);
      }
    } catch { /* */ } finally {
      setGenerating(false);
      setIsLoading(false);
    }
  };

  if (signals.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-6">
        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
          <Sparkles className="h-6 w-6 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium">No Active Signals</p>
        <p className="text-xs text-muted-foreground mt-1">Generate AI signals for your watchlist</p>
        <Button size="sm" className="mt-3 gap-1.5" onClick={handleGenerate} disabled={generating}>
          <Zap className="h-3.5 w-3.5" />
          {generating ? 'Analyzing...' : 'Generate Signals'}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <span className="text-xs font-medium text-muted-foreground">
          {signals.length} active signals
        </span>
        <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={handleGenerate} disabled={generating}>
          <Zap className="h-3 w-3" />
          {generating ? 'Scanning...' : 'Scan'}
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto divide-y divide-border">
        {signals.map(sig => {
          const IconComp = SIGNAL_ICONS[sig.signalType] || Zap;
          return (
            <button
              key={sig.id}
              className={`w-full p-3 text-left border-l-2 transition-colors ${getSignalBgClass(sig.direction)}`}
              onClick={() => setSignalDetailId(sig.id)}
            >
              <div className="flex items-start gap-2.5">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                  sig.direction === 'bullish' ? 'bg-emerald-500/15' : 'bg-red-500/15'
                }`}>
                  {sig.direction === 'bullish'
                    ? <TrendingUp className="h-4 w-4 text-emerald-500" />
                    : <TrendingDown className="h-4 w-4 text-red-500" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold">{sig.symbol}</span>
                    <Badge variant="outline" className="text-[10px] h-5">{SIGNAL_LABELS[sig.signalType]}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{sig.reasoning}</p>
                  <div className="flex items-center gap-3 mt-1.5">
                    <span className={`text-xs font-bold ${getSignalColor(sig.direction)}`}>
                      {sig.confidence}% confident
                    </span>
                    {sig.stopLoss && <span className="text-[10px] text-muted-foreground">SL: {formatPrice(sig.stopLoss, sig.symbol)}</span>}
                    {sig.takeProfit && <span className="text-[10px] text-muted-foreground">TP: {formatPrice(sig.takeProfit, sig.symbol)}</span>}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
