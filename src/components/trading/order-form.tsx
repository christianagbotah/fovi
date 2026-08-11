'use client';

import { useState, useEffect, useMemo } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTradingStore } from '@/lib/store/trading-store';
import { formatPrice } from '@/lib/market-sim';
import { toast } from 'sonner';
import type { OrderSide, OrderType } from '@/lib/types';
import { Loader2, Search, ChevronDown, Target, ShieldAlert } from 'lucide-react';

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
    orderStopLoss, orderTakeProfit, orderEntryPrice,
    selectedSymbol, setSelectedSymbol, positions, setPositions,
    allSymbols, livePrices, signals,
  } = useTradingStore();

  const effectiveSymbol = orderSymbol || selectedSymbol || '';
  const [localSymbol, setLocalSymbol] = useState('');
  const [symbolSearch, setSymbolSearch] = useState('');
  const [symbolDropdownOpen, setSymbolDropdownOpen] = useState(false);

  const symbol = localSymbol || effectiveSymbol || '';
  // Use live WebSocket price if available, fall back to allSymbols, then 0
  const livePrice = livePrices.find(p => p.symbol === symbol);
  const storePrice = allSymbols.find(s => s.symbol === symbol);
  const currentPrice = livePrice?.price ?? storePrice?.price ?? 0;

  const [side, setSide] = useState<OrderSide>('buy');
  const [orderType, setOrderType] = useState<OrderType>('market');
  const [qty, setQty] = useState('1');
  const [limitPrice, setLimitPrice] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [takeProfit, setTakeProfit] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [prefilledFromSignal, setPrefilledFromSignal] = useState(false);

  // Sync symbol and SL/TP from store when sheet opens
  useEffect(() => {
    if (!orderSheetOpen) return;

    // Set symbol
    if (effectiveSymbol) setLocalSymbol(effectiveSymbol);

    // Set side from signal direction
    if (orderSymbol) {
      const sig = signals.find(s => s.symbol === orderSymbol);
      if (sig) {
        if (sig.direction === 'bearish' || sig.direction === 'short') setSide('sell');
        else setSide('buy');
      }
    }

    // Auto-fill SL/TP from signal
    let hasSignalData = false;
    if (orderStopLoss != null && orderStopLoss > 0) {
      setStopLoss(String(orderStopLoss));
      hasSignalData = true;
    }
    if (orderTakeProfit != null && orderTakeProfit > 0) {
      setTakeProfit(String(orderTakeProfit));
      hasSignalData = true;
    }
    if (orderEntryPrice && orderEntryPrice > 0) {
      if (orderType === 'limit' || orderType === 'stop_limit') {
        setLimitPrice(String(orderEntryPrice));
      }
      hasSignalData = true;
    }
    setPrefilledFromSignal(hasSignalData);
  }, [orderSheetOpen]);

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
      setPrefilledFromSignal(false);
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
        // Refresh positions after a short delay to let the order settle
        setTimeout(async () => {
          const posRes = await fetch('/api/trading/positions');
          if (posRes.ok) {
            const posData = await posRes.json();
            if (Array.isArray(posData)) setPositions(posData);
          }
        }, 500);
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
                          {livePrices.find(p => p.symbol === s.symbol)?.price
                            ? formatPrice(livePrices.find(p => p.symbol === s.symbol)!.price, s.symbol)
                            : allSymbols.find(a => a.symbol === s.symbol)?.price
                              ? formatPrice(allSymbols.find(a => a.symbol === s.symbol)!.price, s.symbol)
                              : '—'
                          }
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Signal pre-fill indicator */}
          {prefilledFromSignal && (
            <div className="flex items-center gap-1.5 mb-2 px-1">
              <Target className="h-3.5 w-3.5 text-amber-500" />
              <span className="text-[11px] text-amber-500 font-medium">TP/SL auto-filled from AI signal</span>
            </div>
          )}

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
              <Label className="text-xs text-muted-foreground flex items-center gap-1">
                <ShieldAlert className="h-3 w-3 text-red-400" /> Stop Loss ($)
              </Label>
              <Input type="number" step="0.01" value={stopLoss}
                onChange={e => setStopLoss(e.target.value)}
                placeholder="Optional" className="h-10" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground flex items-center gap-1">
                <Target className="h-3 w-3 text-emerald-400" /> Take Profit ($)
              </Label>
              <Input type="number" step="0.01" value={takeProfit}
                onChange={e => setTakeProfit(e.target.value)}
                placeholder="Optional" className="h-10" />
            </div>
          </div>

          {/* Risk/Reward display */}
          {stopLoss && takeProfit && currentPrice > 0 && (
            <div className="flex items-center gap-4 p-3 rounded-xl bg-muted/50 text-xs">
              <div className="flex-1 text-center">
                <p className="text-muted-foreground">Risk</p>
                <p className="font-bold text-red-500 tabular-nums">
                  {formatPrice(Math.abs(currentPrice - parseFloat(stopLoss)), symbol)}
                </p>
              </div>
              <div className="text-muted-foreground text-lg font-bold">:</div>
              <div className="flex-1 text-center">
                <p className="text-muted-foreground">Reward</p>
                <p className="font-bold text-emerald-500 tabular-nums">
                  {formatPrice(Math.abs(parseFloat(takeProfit) - currentPrice), symbol)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-muted-foreground">R:R</p>
                <p className="font-bold tabular-nums">
                  {Math.abs(parseFloat(takeProfit) - currentPrice) > 0
                    ? (Math.abs(parseFloat(takeProfit) - currentPrice) / Math.abs(currentPrice - parseFloat(stopLoss))).toFixed(1)
                    : '—'
                  }
                </p>
              </div>
            </div>
          )}

          {/* Est. Cost */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Est. Cost</span>
            <span className="font-semibold tabular-nums">
              ${totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
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
