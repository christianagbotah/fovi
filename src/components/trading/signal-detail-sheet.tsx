'use client';

import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useTradingStore } from '@/lib/store/trading-store';
import { formatPrice } from '@/lib/market-sim';
import { TrendingUp, TrendingDown, Target, ShieldAlert, Zap, Copy } from 'lucide-react';
import { toast } from 'sonner';

export function SignalDetailSheet() {
  const { signalDetailId, setSignalDetailId, signals, setOrderSheetOpen, setOrderSymbol } = useTradingStore();
  const signal = signals.find(s => s.id === signalDetailId);

  if (!signal) return null;

  const isBullish = signal.direction === 'bullish';

  const handleExecute = () => {
    setOrderSymbol(signal.symbol);
    setOrderSheetOpen(true);
    setSignalDetailId(null);
  };

  return (
    <Sheet open={!!signalDetailId} onOpenChange={() => setSignalDetailId(null)}>
      <SheetContent side="bottom" className="h-auto max-h-[75vh] rounded-t-2xl">
        <div className="flex justify-center pt-2 pb-1">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
        </div>

        <SheetHeader className="px-6 pb-3">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
              isBullish ? 'bg-emerald-500/15' : 'bg-red-500/15'
            }`}>
              {isBullish
                ? <TrendingUp className="h-5 w-5 text-emerald-500" />
                : <TrendingDown className="h-5 w-5 text-red-500" />}
            </div>
            <div>
              <SheetTitle className="text-lg flex items-center gap-2">
                {signal.symbol}
                <Badge variant="outline" className={
                  isBullish ? 'text-emerald-500 border-emerald-500/20' : 'text-red-500 border-red-500/20'
                }>{signal.direction}</Badge>
              </SheetTitle>
              <p className="text-xs text-muted-foreground">{signal.signalType.replace(/_/g, ' ').toUpperCase()} · {signal.timeframe}</p>
            </div>
          </div>
        </SheetHeader>

        <div className="px-6 pb-8 space-y-4">
          {/* Confidence Bar */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-muted-foreground">AI Confidence</span>
              <span className={`text-sm font-bold ${isBullish ? 'text-emerald-500' : 'text-red-500'}`}>
                {signal.confidence}%
              </span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${isBullish ? 'bg-emerald-500' : 'bg-red-500'}`}
                style={{ width: `${signal.confidence}%` }}
              />
            </div>
          </div>

          {/* Price Levels */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-muted/50 rounded-xl p-3 text-center">
              <p className="text-[10px] text-muted-foreground uppercase">Entry</p>
              <p className="text-sm font-bold mt-0.5">{signal.entryPrice ? formatPrice(signal.entryPrice, signal.symbol) : 'Market'}</p>
            </div>
            <div className="bg-red-500/5 border border-red-500/10 rounded-xl p-3 text-center">
              <p className="text-[10px] text-red-500 uppercase flex items-center justify-center gap-0.5">
                <ShieldAlert className="h-3 w-3" /> Stop
              </p>
              <p className="text-sm font-bold mt-0.5 text-red-500">
                {signal.stopLoss ? formatPrice(signal.stopLoss, signal.symbol) : '—'}
              </p>
            </div>
            <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-xl p-3 text-center">
              <p className="text-[10px] text-emerald-500 uppercase flex items-center justify-center gap-0.5">
                <Target className="h-3 w-3" /> Target
              </p>
              <p className="text-sm font-bold mt-0.5 text-emerald-500">
                {signal.takeProfit ? formatPrice(signal.takeProfit, signal.symbol) : '—'}
              </p>
            </div>
          </div>

          {/* AI Reasoning */}
          <div className="bg-muted/30 rounded-xl p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <Zap className="h-3.5 w-3.5 text-amber-500" />
              <span className="text-xs font-semibold">AI Analysis</span>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">{signal.reasoning}</p>
          </div>

          {/* Actions */}
          <Button
            onClick={handleExecute}
            className={`w-full h-12 font-semibold ${
              isBullish
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                : 'bg-red-600 hover:bg-red-700 text-white'
            }`}
          >
            {isBullish ? 'Buy' : 'Sell'} {signal.symbol}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}