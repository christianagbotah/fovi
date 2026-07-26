'use client';

import { useEffect } from 'react';
import { TrendingUp, TrendingDown, ChevronRight } from 'lucide-react';
import { useTradingStore } from '@/lib/store/trading-store';
import { formatPrice, formatPnl } from '@/lib/market-sim';
import type { Position } from '@/lib/types';
import { Badge } from '@/components/ui/badge';

export function PositionsPanel() {
  const { positions, setPositions, setPositionDetailId } = useTradingStore();

  useEffect(() => {
    async function fetchPositions() {
      try {
        const res = await fetch('/api/trading/positions');
        if (res.ok) setPositions(await res.json());
      } catch { /* */ }
    }
    fetchPositions();
    const interval = setInterval(fetchPositions, 10000);
    return () => clearInterval(interval);
  }, [setPositions]);

  if (positions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-6">
        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
          <TrendingUp className="h-6 w-6 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium">No Open Positions</p>
        <p className="text-xs text-muted-foreground mt-1">Your trades will appear here</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-border">
      {positions.map(pos => (
        <button
          key={pos.id}
          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-accent/50 transition-colors text-left"
          onClick={() => setPositionDetailId(pos.id)}
        >
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
            pos.side === 'long' ? 'bg-emerald-500/10' : 'bg-red-500/10'
          }`}>
            {pos.side === 'long'
              ? <TrendingUp className="h-4 w-4 text-emerald-500" />
              : <TrendingDown className="h-4 w-4 text-red-500" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">{pos.symbol}</span>
              <Badge variant="outline" className={`text-[10px] h-5 ${
                pos.side === 'long'
                  ? 'text-emerald-500 border-emerald-500/20'
                  : 'text-red-500 border-red-500/20'
              }`}>{pos.side}</Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {pos.qty} @ {formatPrice(pos.avgEntryPrice, pos.symbol)}
            </p>
          </div>
          <div className="text-right">
            <p className={`text-sm font-semibold ${pos.unrealizedPnl >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
              {formatPnl(pos.unrealizedPnl)}
            </p>
            <p className={`text-xs ${pos.unrealizedPnl >= 0 ? 'text-emerald-500/70' : 'text-red-500/70'}`}>
              {pos.unrealizedPnl >= 0 ? '+' : ''}{pos.avgEntryPrice > 0 ? ((pos.unrealizedPnl / (pos.avgEntryPrice * pos.qty)) * 100).toFixed(2) : 0}%
            </p>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </button>
      ))}
    </div>
  );
}
