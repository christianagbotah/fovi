'use client';

import { useEffect, useState } from 'react';
import { Search, Star, TrendingUp, TrendingDown } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useTradingStore } from '@/lib/store/trading-store';
import { formatPrice, formatVolume } from '@/lib/market-sim';
import type { MarketSymbol, AssetType } from '@/lib/types';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';

const ASSET_FILTERS: { value: AssetType | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'stock', label: 'Stocks' },
  { value: 'crypto', label: 'Crypto' },
  { value: 'forex', label: 'Forex' },
  { value: 'synthetic', label: 'Indices' },
];

export function MarketOverview() {
  const {
    allSymbols, setAllSymbols, selectedSymbol, setSelectedSymbol,
    assetFilter, setAssetFilter,
  } = useTradingStore();
  const [search, setSearch] = useState('');

  useEffect(() => {
    async function fetchSymbols() {
      try {
        const res = await fetch('/api/trading/market/symbols');
        if (res.ok) setAllSymbols(await res.json());
      } catch { /* */ }
    }
    fetchSymbols();
    const interval = setInterval(fetchSymbols, 15000);
    return () => clearInterval(interval);
  }, [setAllSymbols]);

  const filtered = allSymbols
    .filter(s => assetFilter === 'all' || s.assetType === assetFilter)
    .filter(s =>
      !search ||
      s.symbol.toLowerCase().includes(search.toLowerCase()) ||
      s.name.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent));

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="px-3 py-2 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search markets..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="pl-8 h-9 text-sm"
          />
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-1 px-3 py-2 border-b border-border overflow-x-auto">
        {ASSET_FILTERS.map(f => (
          <button
            key={f.value}
            onClick={() => setAssetFilter(f.value)}
            className={`px-2.5 py-1 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
              assetFilter === f.value
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent'
            }`}
          >{f.label}</button>
        ))}
      </div>

      {/* Symbols List */}
      <ScrollArea className="flex-1">
        <div className="divide-y divide-border">
          {filtered.map(sym => {
            const isUp = sym.changePercent >= 0;
            const isSelected = selectedSymbol === sym.symbol;
            return (
              <button
                key={sym.symbol}
                className={`w-full flex items-center gap-3 px-3 py-2.5 hover:bg-accent/50 transition-colors text-left ${
                  isSelected ? 'bg-accent' : ''
                }`}
                onClick={() => setSelectedSymbol(sym.symbol)}
              >
                <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                  <span className="text-xs font-bold">{sym.symbol.slice(0, 2)}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold">{sym.symbol}</span>
                    <Badge variant="outline" className="text-[9px] h-4 px-1">
                      {sym.assetType.toUpperCase().slice(0, 4)}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{sym.name}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium tabular-nums">{formatPrice(sym.price, sym.symbol)}</p>
                  <div className={`flex items-center justify-end gap-0.5 ${isUp ? 'text-emerald-500' : 'text-red-500'}`}>
                    {isUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                    <span className="text-xs font-medium tabular-nums">
                      {isUp ? '+' : ''}{sym.changePercent.toFixed(2)}%
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}