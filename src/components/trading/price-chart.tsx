'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTradingStore } from '@/lib/store/trading-store';
import type { Timeframe, CandleData } from '@/lib/types';
import { formatPrice } from '@/lib/market-sim';

type ChartType = 'area' | 'candle';

const TIMEFRAMES: { value: Timeframe; label: string }[] = [
  { value: '1m', label: '1M' },
  { value: '5m', label: '5M' },
  { value: '15m', label: '15M' },
  { value: '1h', label: '1H' },
  { value: '4h', label: '4H' },
  { value: '1d', label: '1D' },
  { value: '1w', label: '1W' },
];

export function PriceChart() {
  const {
    selectedSymbol, selectedTimeframe, setSelectedTimeframe,
    candles, setCandles, isLoading, setIsLoading,
    setOrderSheetOpen, setOrderSymbol,
  } = useTradingStore();
  const [chartType, setChartType] = useState<ChartType>('area');

  const fetchCandles = useCallback(async () => {
    if (!selectedSymbol) return;
    setIsLoading(true);
    try {
      const res = await fetch(`/api/trading/market/symbols?symbol=${selectedSymbol}&timeframe=${selectedTimeframe}&limit=100`);
      const data = await res.json();
      setCandles(data);
    } catch {
      // error
    } finally {
      setIsLoading(false);
    }
  }, [selectedSymbol, selectedTimeframe, setCandles, setIsLoading]);

  useEffect(() => {
    fetchCandles();
    const interval = setInterval(fetchCandles, 30000);
    return () => clearInterval(interval);
  }, [fetchCandles]);

  const chartData = useMemo(() => {
    return candles.map(c => ({
      time: new Date(c.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      ...c,
    }));
  }, [candles]);

  const lastCandle = candles[candles.length - 1];
  const prevCandle = candles[candles.length - 2];
  const priceChange = lastCandle && prevCandle ? lastCandle.close - prevCandle.close : 0;
  const priceChangePct = prevCandle ? (priceChange / prevCandle.close) * 100 : 0;
  const isUp = priceChange >= 0;

  const handleBuySell = (side: 'buy' | 'sell') => {
    setOrderSymbol(selectedSymbol);
    setOrderSheetOpen(true);
  };

  if (!selectedSymbol) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        Select a symbol to view chart
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-start justify-between px-4 pt-3 pb-2">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold">{selectedSymbol}</h2>
            {isUp ? <ArrowUpRight className="h-5 w-5 text-emerald-500" /> : <ArrowDownRight className="h-5 w-5 text-red-500" />}
          </div>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-2xl font-bold tabular-nums">
              {lastCandle ? formatPrice(lastCandle.close, selectedSymbol) : '—'}
            </span>
            <span className={`text-sm font-medium ${isUp ? 'text-emerald-500' : 'text-red-500'}`}>
              {isUp ? '+' : ''}{priceChange.toFixed(2)} ({isUp ? '+' : ''}{priceChangePct.toFixed(2)}%)
            </span>
          </div>
        </div>
        <div className="flex gap-1.5 mt-1">
          <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white h-9 px-4"
            onClick={() => handleBuySell('buy')}>Buy</Button>
          <Button size="sm" variant="outline" className="text-red-500 border-red-500/30 hover:bg-red-500/10 h-9 px-4"
            onClick={() => handleBuySell('sell')}>Sell</Button>
        </div>
      </div>

      {/* Timeframe Selector */}
      <div className="flex items-center gap-1 px-4 pb-2">
        {TIMEFRAMES.map(tf => (
          <button
            key={tf.value}
            onClick={() => setSelectedTimeframe(tf.value)}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
              selectedTimeframe === tf.value
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent'
            }`}
          >{tf.label}</button>
        ))}
      </div>

      {/* Chart */}
      <div className="flex-1 min-h-0 px-2 pb-2">
        {isLoading && !candles.length ? (
          <div className="h-full flex items-center justify-center">
            <div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
              <defs>
                <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={isUp ? '#10b981' : '#ef4444'} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={isUp ? '#10b981' : '#ef4444'} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis dataKey="time" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickLine={false} />
              <YAxis
                domain={['auto', 'auto']}
                tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickLine={false}
                tickFormatter={(v: number) => formatPrice(v, selectedSymbol || '')}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))',
                  borderRadius: '8px', fontSize: '12px',
                }}
                formatter={(value: number) => [formatPrice(value, selectedSymbol || ''), 'Price']}
              />
              <Area
                type="monotone"
                dataKey="close"
                stroke={isUp ? '#10b981' : '#ef4444'}
                strokeWidth={2}
                fill="url(#priceGradient)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Volume Bar Chart */}
      {candles.length > 0 && (
        <div className="h-16 px-2 pb-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData.slice(-30)} margin={{ top: 0, right: 5, bottom: 0, left: 5 }}>
              <Bar dataKey="volume" fill="hsl(var(--muted-foreground))" opacity={0.3} radius={[2, 2, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
