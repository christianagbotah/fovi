'use client';

import { useEffect, useState } from 'react';
import {
  TrendingUp, TrendingDown, Zap, Sparkles,
  BarChart3, Target, ArrowRightLeft, Activity, Waves,
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

const SIGNAL_TYPES = ['momentum_shift', 'breakout', 'rsi_divergence', 'macd_crossover', 'bollinger_squeeze', 'ai_predicted'];
const SYMBOLS = ['AAPL', 'GOOGL', 'MSFT', 'NVDA', 'TSLA', 'META', 'BTC', 'ETH', 'SOL', 'AMZN'];
const REASONS = [
  'Strong bullish momentum with MACD crossover and RSI bouncing off support. Volume increasing on green candles.',
  'Breakout above key resistance level with above-average volume. RSI at 62 with room to run higher.',
  'Bollinger Bands squeezing indicating imminent volatility expansion. Price near upper band with momentum.',
  'RSI divergence detected on 4H timeframe suggesting potential trend reversal. Waiting for confirmation candle.',
  'MACD histogram turning positive with signal line crossover. Price holding above 20 EMA support.',
  'AI model detects high-probability setup based on multi-timeframe analysis. Confluence of 3 technical factors.',
  'Volume profile shows strong buying interest at current level. Order flow indicates institutional accumulation.',
  'Trend continuation pattern confirmed with higher lows. Momentum oscillators supporting upward move.',
];

function generateDemoSignals(count: number = 6) {
  const signals = [];
  for (let i = 0; i < count; i++) {
    const symbol = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
    const direction = Math.random() > 0.4 ? 'bullish' : 'bearish';
    const confidence = Math.floor(Math.random() * 25) + 65;
    const signalType = SIGNAL_TYPES[Math.floor(Math.random() * SIGNAL_TYPES.length)];
    const bases: Record<string, number> = {
      AAPL: 198, GOOGL: 175, MSFT: 425, NVDA: 138, TSLA: 248,
      META: 505, BTC: 68500, ETH: 3550, SOL: 175, AMZN: 185,
    };
    const base = bases[symbol] || 200;
    const entry = parseFloat((base * (0.97 + Math.random() * 0.06)).toFixed(2));
    const slPct = 0.015 + Math.random() * 0.02;
    const tpPct = 0.025 + Math.random() * 0.04;

    signals.push({
      id: 'sig_' + Date.now() + '_' + i,
      symbol,
      assetType: ['BTC', 'ETH', 'SOL'].includes(symbol) ? 'crypto' : 'stock',
      direction,
      confidence,
      signalType,
      timeframe: '1h',
      entryPrice: entry,
      stopLoss: direction === 'bullish'
        ? parseFloat((entry * (1 - slPct)).toFixed(2))
        : parseFloat((entry * (1 + slPct)).toFixed(2)),
      takeProfit: direction === 'bullish'
        ? parseFloat((entry * (1 + tpPct)).toFixed(2))
        : parseFloat((entry * (1 - tpPct)).toFixed(2)),
      reasoning: REASONS[Math.floor(Math.random() * REASONS.length)],
      status: 'active',
      createdAt: new Date(Date.now() - Math.random() * 3600000).toISOString(),
    });
  }
  return signals;
}

export function SignalsPanel() {
  const { signals, setSignals, setSignalDetailId } = useTradingStore();
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    // If no signals, try API first, then generate demo
    if (signals.length === 0) {
      fetch('/api/trading/signals')
        .then(res => res.ok ? res.json() : [])
        .then(data => {
          if (Array.isArray(data) && data.length > 0) {
            setSignals(data);
          } else {
            setSignals(generateDemoSignals(5));
          }
        })
        .catch(() => {
          setSignals(generateDemoSignals(5));
        });
    }
  }, []);

  const handleGenerate = async () => {
    if (generating) return;
    setGenerating(true);

    // Try API first
    try {
      const res = await fetch('/api/trading/signals/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: 'AAPL', timeframe: '1h' }),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          // Normalize direction field
          const normalized = data.map((s: any) => ({
            ...s,
            direction: s.direction === 'long' ? 'bullish' : s.direction === 'short' ? 'bearish' : s.direction,
          }));
          setSignals([...normalized, ...signals]);
          setGenerating(false);
          return;
        }
      }
    } catch { /* */ }

    // Fallback: generate client-side demo signals
    await new Promise(r => setTimeout(r, 800));
    const newSignals = generateDemoSignals(3);
    setSignals([...newSignals, ...signals]);
    setGenerating(false);
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
          const isBullish = sig.direction === 'bullish' || sig.direction === 'long';
          return (
            <button
              key={sig.id}
              className={"w-full p-3 text-left border-l-2 transition-colors " + (isBullish ? 'border-l-emerald-500 bg-emerald-500/5' : 'border-l-red-500 bg-red-500/5')}
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
                      {typeof sig.confidence === 'number' ? Math.round(sig.confidence * 100) : sig.confidence}% confident
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
