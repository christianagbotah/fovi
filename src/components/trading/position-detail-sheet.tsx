'use client';

import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useTradingStore } from '@/lib/store/trading-store';
import { formatPrice, formatPnl } from '@/lib/market-sim';
import {
  TrendingUp, TrendingDown, Target, ShieldAlert, X, Loader2,
  ChevronRight, Pencil, Check, AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';

export function PositionDetailSheet() {
  const {
    positionDetailId, setPositionDetailId, positions, setPositions,
  } = useTradingStore();

  const position = positions.find(p => p.id === positionDetailId);

  const [editingSL, setEditingSL] = useState(false);
  const [editingTP, setEditingTP] = useState(false);
  const [slValue, setSlValue] = useState('');
  const [tpValue, setTpValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [closing, setClosing] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  if (!position) return null;

  const isLong = position.side === 'long';
  const unrealizedPnlPercent = position.avgEntryPrice > 0
    ? ((position.unrealizedPnl / (position.avgEntryPrice * position.qty)) * 100)
    : 0;

  const handleClose = async () => {
    setClosing(true);
    try {
      const res = await fetch(`/api/trading/positions/${position.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok) {
        toast.success(`Closed ${position.symbol}: ${formatPnl(data.realizedPnl)}`);
        setPositionDetailId(null);
        // Refresh positions
        const posRes = await fetch('/api/trading/positions');
        if (posRes.ok) setPositions(await posRes.json());
      } else {
        toast.error(data.error || 'Failed to close position');
      }
    } catch {
      toast.error('Failed to close position');
    } finally {
      setClosing(false);
      setShowCloseConfirm(false);
    }
  };

  const handleSaveTpSl = async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {};
      if (editingSL) body.stopLoss = slValue ? parseFloat(slValue) : null;
      if (editingTP) body.takeProfit = tpValue ? parseFloat(tpValue) : null;

      const res = await fetch(`/api/trading/positions/${position.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success('Position updated');
        setEditingSL(false);
        setEditingTP(false);
        // Refresh positions
        const posRes = await fetch('/api/trading/positions');
        if (posRes.ok) setPositions(await posRes.json());
      } else {
        toast.error(data.error || 'Failed to update');
      }
    } catch {
      toast.error('Failed to update position');
    } finally {
      setSaving(false);
    }
  };

  const startEditSL = () => {
    setSlValue(position.stopLoss ? String(position.stopLoss) : '');
    setEditingSL(true);
    setEditingTP(false);
  };

  const startEditTP = () => {
    setTpValue(position.takeProfit ? String(position.takeProfit) : '');
    setEditingTP(true);
    setEditingSL(false);
  };

  const currentSL = editingSL ? slValue : (position.stopLoss ? String(position.stopLoss) : '—');
  const currentTP = editingTP ? tpValue : (position.takeProfit ? String(position.takeProfit) : '—');

  return (
    <Sheet open={!!positionDetailId} onOpenChange={() => setPositionDetailId(null)}>
      <SheetContent side="bottom" className="h-auto max-h-[85vh] rounded-t-2xl max-w-2xl mx-auto flex flex-col">
        {/* Drag Handle */}
        <div className="flex justify-center pt-2 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
        </div>

        <SheetHeader className="px-6 pb-3 shrink-0">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
              isLong ? 'bg-emerald-500/15' : 'bg-red-500/15'
            }`}>
              {isLong
                ? <TrendingUp className="h-5 w-5 text-emerald-500" />
                : <TrendingDown className="h-5 w-5 text-red-500" />}
            </div>
            <div className="flex-1">
              <SheetTitle className="text-lg flex items-center gap-2">
                {position.symbol}
                <Badge variant="outline" className={
                  isLong ? 'text-emerald-500 border-emerald-500/20' : 'text-red-500 border-red-500/20'
                }>{position.side}</Badge>
              </SheetTitle>
              <p className="text-xs text-muted-foreground">
                {position.qty} @ {formatPrice(position.avgEntryPrice, position.symbol)}
                {position.openedAt && ` · ${new Date(position.openedAt).toLocaleDateString()}`}
              </p>
            </div>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto min-h-0 px-6 pb-6 space-y-4">
          {/* P&L Summary */}
          <div className={`grid grid-cols-3 gap-3`}>
            <div className="bg-muted/50 rounded-xl p-3 text-center">
              <p className="text-[10px] text-muted-foreground uppercase">Current Price</p>
              <p className="text-sm font-bold mt-0.5 tabular-nums">
                {formatPrice(position.currentPrice, position.symbol)}
              </p>
            </div>
            <div className={`rounded-xl p-3 text-center ${position.unrealizedPnl >= 0 ? 'bg-emerald-500/5' : 'bg-red-500/5'}`}>
              <p className="text-[10px] text-muted-foreground uppercase">Unrealized P&L</p>
              <p className={`text-sm font-bold mt-0.5 tabular-nums ${position.unrealizedPnl >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                {formatPnl(position.unrealizedPnl)}
              </p>
            </div>
            <div className={`rounded-xl p-3 text-center ${unrealizedPnlPercent >= 0 ? 'bg-emerald-500/5' : 'bg-red-500/5'}`}>
              <p className="text-[10px] text-muted-foreground uppercase">ROE</p>
              <p className={`text-sm font-bold mt-0.5 tabular-nums ${unrealizedPnlPercent >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                {unrealizedPnlPercent >= 0 ? '+' : ''}{unrealizedPnlPercent.toFixed(2)}%
              </p>
            </div>
          </div>

          {/* TP/SL Section — Binance-style editable */}
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border bg-muted/30 flex items-center justify-between">
              <span className="text-xs font-semibold">Risk Management</span>
              {(editingSL || editingTP) && (
                <Button size="sm" className="h-7 text-xs gap-1 cursor-pointer"
                  onClick={handleSaveTpSl} disabled={saving}>
                  {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                  Save
                </Button>
              )}
            </div>

            {/* Take Profit Row */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50">
              <div className="flex items-center gap-2 min-w-[90px]">
                <Target className="h-4 w-4 text-emerald-500" />
                <span className="text-xs text-muted-foreground font-medium">Take Profit</span>
              </div>
              {editingTP ? (
                <div className="flex-1 flex items-center gap-2">
                  <Input type="number" step="0.01" value={tpValue}
                    onChange={e => setTpValue(e.target.value)}
                    placeholder={formatPrice(position.currentPrice * (isLong ? 1.04 : 0.96), position.symbol)}
                    className="h-8 text-sm" autoFocus />
                  <button onClick={() => setEditingTP(false)} className="p-1 hover:bg-muted rounded">
                    <X className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                </div>
              ) : (
                <button onClick={startEditTP}
                  className="flex-1 flex items-center justify-between group cursor-pointer">
                  <span className={`text-sm font-semibold tabular-nums ${position.takeProfit ? 'text-emerald-500' : 'text-muted-foreground'}`}>
                    {position.takeProfit ? formatPrice(position.takeProfit, position.symbol) : 'Not set'}
                  </span>
                  <Pencil className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              )}
            </div>

            {/* Stop Loss Row */}
            <div className="flex items-center gap-3 px-4 py-3">
              <div className="flex items-center gap-2 min-w-[90px]">
                <ShieldAlert className="h-4 w-4 text-red-500" />
                <span className="text-xs text-muted-foreground font-medium">Stop Loss</span>
              </div>
              {editingSL ? (
                <div className="flex-1 flex items-center gap-2">
                  <Input type="number" step="0.01" value={slValue}
                    onChange={e => setSlValue(e.target.value)}
                    placeholder={formatPrice(position.currentPrice * (isLong ? 0.98 : 1.02), position.symbol)}
                    className="h-8 text-sm" autoFocus />
                  <button onClick={() => setEditingSL(false)} className="p-1 hover:bg-muted rounded">
                    <X className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                </div>
              ) : (
                <button onClick={startEditSL}
                  className="flex-1 flex items-center justify-between group cursor-pointer">
                  <span className={`text-sm font-semibold tabular-nums ${position.stopLoss ? 'text-red-500' : 'text-muted-foreground'}`}>
                    {position.stopLoss ? formatPrice(position.stopLoss, position.symbol) : 'Not set'}
                  </span>
                  <Pencil className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              )}
            </div>
          </div>

          {/* Position Details */}
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border bg-muted/30">
              <span className="text-xs font-semibold">Position Details</span>
            </div>
            <div className="divide-y divide-border/50">
              {[
                ['Symbol', position.symbol],
                ['Side', position.side.toUpperCase()],
                ['Quantity', String(position.qty)],
                ['Entry Price', formatPrice(position.avgEntryPrice, position.symbol)],
                ['Current Value', '$' + (position.currentPrice * position.qty).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })],
                ['Asset Type', (position.assetType || 'stock').charAt(0).toUpperCase() + (position.assetType || 'stock').slice(1)],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-xs text-muted-foreground">{label}</span>
                  <span className="text-xs font-medium tabular-nums">{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Close Confirmation */}
          {showCloseConfirm && (
            <div className="p-4 rounded-xl border border-red-500/30 bg-red-500/5 space-y-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-red-500" />
                <span className="text-sm font-semibold">Close Position</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Are you sure you want to close your {position.side} {position.qty} {position.symbol} position?
                This will be executed at the current market price.
              </p>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 cursor-pointer" onClick={() => setShowCloseConfirm(false)}>
                  Cancel
                </Button>
                <Button className="flex-1 bg-red-600 hover:bg-red-700 text-white cursor-pointer"
                  onClick={handleClose} disabled={closing}>
                  {closing && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                  Confirm Close
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Sticky Close Button */}
        {!showCloseConfirm && (
          <div className="px-6 pt-3 pb-6 shrink-0 border-t border-border/50">
            <Button
              onClick={() => setShowCloseConfirm(true)}
              className="w-full h-11 text-sm font-semibold bg-red-600 hover:bg-red-700 text-white cursor-pointer"
            >
              Close Position
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
