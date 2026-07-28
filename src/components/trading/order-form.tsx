'use client';

import { useState, useEffect, useMemo } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTradingStore } from '@/lib/store/trading-store';
import { getDemoPrice, getDemoSymbolName } from '@/lib/broker/demo';
import { formatPrice } from '@/lib/market-sim';
import { toast } from 'sonner';
import type { OrderSide, OrderType } from '@/lib/types';
import { Loader2, Search, ChevronDown } from 'lucide-react';

const POPULAR_SYMBOLS = [
  { symbol: 'AAPL', name: 'Apple Inc.' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.' },
  { symbol: 'MSFT', name: 'Microsoft Corp.' },
  { symbol: 'AMZN', name: 'Amazon.com Inc.' },
  { symbol: 'TSLA', name: 'Tesla Inc.' },
  { symbol: 'BTC/USD', name: 'Bitcoin' },
  { symbol: 'ETH/USD', name: 'Ethereum' },
  { symbol: 'SOL/USD', name: 'Solana' },
  { symbol: 'EUR/USD', name: 'Euro / US Dollar' },
  { symbol: 'GBP/USD', name: 'British Pound / US Dollar' },
  { symbol: 'NVDA', name: 'NVIDIA Corp.' },
  { symbol: 'META', name: 'Meta Platforms' },
  { symbol: 'NFLX', name: 'Netflix Inc.' },
  { symbol: 'XRP/USD', name: 'Ripple' },
  { symbol: 'DOGE/USD', name: 'Dogecoin' },
];

export function OrderForm() {
  const {
    orderSheetOpen, setOrderSheetOpen, orderSymbol, setOrderSymbol,
    selectedSymbol, setSelectedSymbol, positions, setPositions,
    allSymbols, livePrices,
  } = useTradingStore();

  const effectiveSymbol = orderSymbol || selectedSymbol || 'AAPL';
  const [localSymbol, setLocalSymbol] = useState(effectiveSymbol);
  const [symbolSearch, setSymbolSearch] = useState('');
  const [symbolDropdownOpen, setSymbolDropdownOpen] = useState(false);

  const symbol = localSymbol;
  const currentPrice = getDemoPrice(symbol);

  const [side, setSide] = useState<OrderSide>('buy');
  const [orderType, setOrderType] = useState<OrderType>('market');
  const [qty, setQty] = useState('1');
  const [limitPrice, setLimitPrice] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [takeProfit, setTakeProfit] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Sync symbol from store when sheet opens or orderSymbol changes
  useEffect(() => {
    if (effectiveSymbol && orderSheetOpen) {
      setLocalSymbol(effectiveSymbol);
    }
  }, [effectiveSymbol, orderSheetOpen]);

  // Pre-fill TP/SL from signal data
  useEffect(() => {
    if (orderSheetOpen && orderSymbol) {
      const { signals } = useTradingStore.getState();
      const sig = signals.find(s => s.symbol === orderSymbol);
      if (sig) {
        if (sig.stopLoss) setStopLoss(String(sig.stopLoss));
        if (sig.takeProfit) setTakeProfit(String(sig.takeProfit));
        if (sig.direction === 'bearish' || sig.direction === 'short') setSide('sell');
        else setSide('buy');
      }
    }
  }, [orderSheetOpen, orderSymbol]);

  // Reset form when sheet closes
  useEffect(() => {
    if (!orderSheetOpen) {
      setQty('1');
      setLimitPrice('');
      setStopLoss('');
      setTakeProfit('');
      setSide('buy');
      setOrderType('market');
      setSymbolDropdownOpen(false);
    }
  }, [orderSheetOpen]);
  const symbolList = useMemo(() => {
    const live = livePrices.map(p => ({ symbol: p.symbol, name: p.name || p.symbol }));
    const stored = allSymbols.map(s => ({ symbol: s.symbol, name: s.name || s.symbol }));
    const combined = [...live, ...stored];
    const seen = new Set<string>();
    const unique = combined.filter(s => {
      if (seen.has(s.symbol)) return false;
      seen.add(s.symbol);
      return true;
    });
    POPULAR_SYMBOLS.forEach(ps => {
      if (!seen.has(ps.symbol)) unique.push(ps);
    });
    return unique;
  }, [livePrices, allSymbols]);

  const filteredSymbols = useMemo(() => {
    if (!symbolSearch.trim()) return symbolList;
    const q = symbolSearch.toLowerCase();
    return symbolList.filter(s =>
      s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
    );
  }, [symbolList, symbolSearch]);

  const selectedSymbolData = symbolList.find(s => s.symbol === symbol);

  const totalCost = orderType === 'limit' && limitPrice
    ? parseFloat(limitPrice) * parseFloat(qty || '0')
    : currentPrice * parseFloat(qty || '0');

  const handleSubmit = async () => {
    if (!qty || parseFloat(qty) <= 0) {
      toast.error('Enter a valid quantity');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/trading/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol, side, type: orderType, qty: parseFloat(qty),
          limitPrice: limitPrice ? parseFloat(limitPrice) : undefined,
          stopLoss: stopLoss ? parseFloat(stopLoss) : undefined,
          takeProfit: takeProfit ? parseFloat(takeProfit) : undefined,
        }),
      });
      const order = await res.json();
      if (res.ok) {
        toast.success(`${side === 'buy' ? 'Buy' : 'Sell'} order filled: ${symbol} x${qty}`);
        setOrderSheetOpen(false);
        setQty('1'); setLimitPrice(''); setStopLoss(''); setTakeProfit('');
        const posRes = await fetch('/api/trading/positions');
        if (posRes.ok) setPositions(await posRes.json());
      } else {
        toast.error(order.error || 'Order failed');
      }
    } catch {
      toast.error('Failed to place order');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSymbolSelect = (sym: string) => {
    setLocalSymbol(sym);
    setSymbolDropdownOpen(false);
    setSymbolSearch('');
    setOrderSymbol(sym);
  };

  return (
    <Sheet open={orderSheetOpen} onOpenChange={setOrderSheetOpen}>
      <SheetContent side="bottom" className="h-auto max-h-[85vh] rounded-t-2xl max-w-2xl mx-auto flex flex-col">
        {/* Drag Handle */}
        <div className="flex justify-center pt-2 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
        </div>

        <SheetHeader className="px-6 pb-2 shrink-0">
          {/* Symbol Selector Dropdown */}
          <div className="relative mb-3">
            <button
              onClick={() => setSymbolDropdownOpen(!symbolDropdownOpen)}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-muted/30 hover:bg-accent/50 transition-colors cursor-pointer text-left"
            >
              <div className="flex-1">
                <span className="text-lg font-bold">{symbol}</span>
                {selectedSymbolData && (
                  <span className="text-sm text-muted-foreground ml-2">{selectedSymbolData.name}</span>
                )}
              </div>
              <span className="text-lg font-semibold tabular-nums">
                {formatPrice(currentPrice, symbol)}
              </span>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </button>

            {symbolDropdownOpen && (
              <div className="absolute top-full left-0 right-0 mt-1 z-50 rounded-xl border border-border bg-popover shadow-xl overflow-hidden">
                <div className="p-2 border-b border-border">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder="Search stocks, crypto, forex..."
                      value={symbolSearch}
                      onChange={e => setSymbolSearch(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 text-sm bg-muted/50 rounded-lg border-0 outline-none focus:ring-1 focus:ring-primary"
                      autoFocus
                    />
                  </div>
                </div>
                <div className="max-h-48 overflow-y-auto">
                  {filteredSymbols.length === 0 ? (
                    <p className="p-3 text-sm text-muted-foreground text-center">No symbols found</p>
                  ) : (
                    filteredSymbols.slice(0, 20).map(s => (
                      <button
                        key={s.symbol}
                        onClick={() => handleSymbolSelect(s.symbol)}
                        className={`w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-accent/50 transition-colors cursor-pointer ${
                          s.symbol === symbol ? 'bg-primary/10 text-primary' : ''
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <span className="font-semibold">{s.symbol}</span>
                          <span className="text-xs text-muted-foreground">{s.name}</span>
                        </div>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {formatPrice(getDemoPrice(s.symbol), s.symbol)}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <SheetTitle className="text-lg">New Order</SheetTitle>
          </div>
        </SheetHeader>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto min-h-0 px-6 space-y-5">
          {/* Buy/Sell Tabs */}
          <Tabs value={side} onValueChange={(v) => setSide(v as OrderSide)}>
            <TabsList className="w-full h-12 grid grid-cols-2">
              <TabsTrigger value="buy" className="text-sm font-semibold data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
                Buy / Long
              </TabsTrigger>
              <TabsTrigger value="sell" className="text-sm font-semibold data-[state=active]:bg-red-600 data-[state=active]:text-white">
                Sell / Short
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Order Type */}
          <div className="grid grid-cols-4 gap-2">
            {(['market', 'limit', 'stop', 'stop_limit'] as OrderType[]).map(t => (
              <button
                key={t}
                onClick={() => setOrderType(t)}
                className={`px-3 py-2 text-xs font-medium rounded-lg border transition-colors ${
                  orderType === t
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border hover:bg-accent'
                }`}
              >{t.replace('_', ' ').toUpperCase()}</button>
            ))}
          </div>

          {/* Quantity */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Quantity</Label>
            <Input
              type="number" min="1" step="1"
              value={qty} onChange={e => setQty(e.target.value)}
              className="h-12 text-lg font-semibold"
              placeholder="0"
            />
            <div className="flex gap-2">
              {[1, 5, 10, 25, 50, 100].map(n => (
                <button key={n} onClick={() => setQty(String(n))}
                  className="flex-1 py-1.5 text-xs font-medium rounded-md bg-muted hover:bg-accent transition-colors">
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* Limit Price */}
          {(orderType === 'limit' || orderType === 'stop_limit') && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Limit Price ($)</Label>
              <Input type="number" step="0.01" value={limitPrice}
                onChange={e => setLimitPrice(e.target.value)}
                placeholder={formatPrice(currentPrice, symbol)}
                className="h-12" />
            </div>
          )}

          {/* Stop Loss / Take Profit */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Stop Loss ($)</Label>
              <Input type="number" step="0.01" value={stopLoss}
                onChange={e => setStopLoss(e.target.value)}
                placeholder="Optional" className="h-10" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Take Profit ($)</Label>
              <Input type="number" step="0.01" value={takeProfit}
                onChange={e => setTakeProfit(e.target.value)}
                placeholder="Optional" className="h-10" />
            </div>
          </div>

          {/* Est. Cost */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Est. Cost</span>
            <span className="font-semibold">${totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
        </div>

        {/* Sticky Submit Button */}
        <div className="px-6 pt-3 pb-6 shrink-0 border-t border-border/50">
          <Button
            onClick={handleSubmit} disabled={submitting}
            className={`w-full h-12 text-base font-semibold ${
              side === 'buy'
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                : 'bg-red-600 hover:bg-red-700 text-white'
            }`}
          >
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {side === 'buy' ? 'Buy' : 'Sell'} {symbol}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
