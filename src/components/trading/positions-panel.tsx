'use client';

import { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, ChevronRight } from 'lucide-react';
import { useTradingStore } from '@/lib/store/trading-store';
import { formatPrice, formatPnl } from '@/lib/market-sim';
import type { Position } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

export function PositionsPanel() {
  const { positions, setPositions, setPositionDetailId, orders } = useTradingStore();
  const [posTab, setPosTab] = useState<'open' | 'all'>('open');

  useEffect(() => {
    async function fetchPositions() {
      try {
        const res = await fetch('/api/trading/positions');
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) {
            setPositions(data);
          }
        }
      } catch { /* */ }
    }
    fetchPositions();
    const interval = setInterval(fetchPositions, 8000);
    return () => clearInterval(interval);
  }, [setPositions]);

  const openPositions = positions.filter(p => p.status === 'open');
  const displayPositions = posTab === 'all' ? positions : openPositions;
  const totalPnl = displayPositions.reduce((s, p) => s + p.unrealizedPnl, 0);

  if (displayPositions.length === 0) {
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
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <Tabs value={posTab} onValueChange={(v) => setPosTab(v as 'open' | 'all')}>
          <TabsList className="h-7">
            <TabsTrigger value="open" className="text-xs px-3">Open ({openPositions.length})</TabsTrigger>
            <TabsTrigger value="all" className="text-xs px-3">All ({positions.length})</TabsTrigger>
          </TabsList>
        </Tabs>
        <span className="text-[10px] text-muted-foreground">
          {totalPnl >= 0 ? '+' : ''}{formatPnl(totalPnl)} P&L
        </span>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-border">
        <PositionList positions={displayPositions} onDetail={setPositionDetailId} />
      </div>
    </div>
  );
}

function PositionList({ positions, onDetail }: { positions: Position[]; onDetail: (id: string) => void }) {
  return (
    <>
      {positions.map(pos => {
        const isLong = pos.side === 'long';
        const pnlPct = pos.avgEntryPrice > 0 ? ((pos.unrealizedPnl / (pos.avgEntryPrice * pos.qty)) * 100) : 0;
        return (
          <button
            key={pos.id}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-accent/50 transition-colors text-left cursor-pointer"
            onClick={() => onDetail(pos.id)}
          >
            <div className={isLong ? 'w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-emerald-500/10' : 'w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-red-500/10'}>
              {isLong && <TrendingUp className="h-4 w-4 text-emerald-500" />}
              {!isLong && <TrendingDown className="h-4 w-4 text-red-500" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">{pos.symbol}</span>
                <Badge variant="outline" className={isLong ? 'text-[10px] h-5 text-emerald-500 border-emerald-500/20' : 'text-[10px] h-5 text-red-500 border-red-500/20'}>{pos.side}</Badge>
                {pos.stopLoss && <span className="text-[9px] text-red-400 font-medium">SL {formatPrice(pos.stopLoss, pos.symbol)}</span>}
                {pos.takeProfit && <span className="text-[9px] text-emerald-400 font-medium">TP {formatPrice(pos.takeProfit, pos.symbol)}</span>}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {pos.qty} @ {formatPrice(pos.avgEntryPrice, pos.symbol)}
                <span className="mx-1.5 text-border">|</span>
                <span className={pnlPct >= 0 ? 'text-emerald-500' : 'text-red-500'}>
                  {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%
                </span>
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className={pos.unrealizedPnl >= 0 ? 'text-sm font-semibold text-emerald-500' : 'text-sm font-semibold text-red-500'}>
                {formatPnl(pos.unrealizedPnl)}
              </p>
              <p className="text-[11px] text-muted-foreground tabular-nums">
                {formatPrice(pos.currentPrice, pos.symbol)}
              </p>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          </button>
        );
      })}
    </>
  );
}
