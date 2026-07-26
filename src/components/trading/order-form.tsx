'use client';

import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTradingStore } from '@/lib/store/trading-store';
import { getDemoPrice, getDemoSymbolName } from '@/lib/broker/demo';
import { formatPrice } from '@/lib/market-sim';
import { toast } from 'sonner';
import type { OrderSide, OrderType } from '@/lib/types';
import { Loader2 } from 'lucide-react';

export function OrderForm() {
  const {
    orderSheetOpen, setOrderSheetOpen, orderSymbol,
    selectedSymbol, setSelectedSymbol, positions, setPositions,
  } = useTradingStore();

  const symbol = orderSymbol || selectedSymbol || 'AAPL';
  const currentPrice = getDemoPrice(symbol);

  const [side, setSide] = useState<OrderSide>('buy');
  const [orderType, setOrderType] = useState<OrderType>('market');
  const [qty, setQty] = useState('1');
  const [limitPrice, setLimitPrice] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [takeProfit, setTakeProfit] = useState('');
  const [submitting, setSubmitting] = useState(false);

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
          symbol,
          side,
          type: orderType,
          qty: parseFloat(qty),
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
        // Refresh positions
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

  return (
    <Sheet open={orderSheetOpen} onOpenChange={setOrderSheetOpen}>
      <SheetContent side="bottom" className="h-auto max-h-[85vh] rounded-t-2xl">
        {/* Drag Handle */}
        <div className="flex justify-center pt-2 pb-1">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
        </div>

        <SheetHeader className="px-6 pb-2">
          <div className="flex items-center gap-3">
            <SheetTitle className="text-lg">{symbol}</SheetTitle>
            <span className="text-sm text-muted-foreground">{getDemoSymbolName(symbol)}</span>
            <span className="text-sm font-semibold tabular-nums ml-auto">
              {formatPrice(currentPrice, symbol)}
            </span>
          </div>
        </SheetHeader>

        <div className="px-6 pb-8 space-y-5">
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

          {/* Total & Submit */}
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Est. Cost</span>
              <span className="font-semibold">${totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
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
        </div>
      </SheetContent>
    </Sheet>
  );
}