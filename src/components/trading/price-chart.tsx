'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell,
  ComposedChart, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import { ArrowUpRight, ArrowDownRight, AreaChart as AreaChartIcon, BarChart3, LineChart as LineChartIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTradingStore } from '@/lib/store/trading-store';
import type { CandleData, Timeframe } from '@/lib/types';
import { formatPrice } from '@/lib/market-sim';

type ChartType = 'area' | 'candle' | 'line';

const TIMEFRAMES: { value: Timeframe; label: string }[] = [
  { value: '1m', label: '1M' },
  { value: '5m', label: '5M' },
  { value: '15m', label: '15M' },
  { value: '1h', label: '1H' },
  { value: '4h', label: '4H' },
  { value: '1d', label: '1D' },
  { value: '1w', label: '1W' },
];

const CHART_TYPES: { value: ChartType; label: string; icon: React.ReactNode }[] = [
  { value: 'area', label: 'Area', icon: <AreaChartIcon className="h-4 w-4" /> },
  { value: 'candle', label: 'Candle', icon: <BarChart3 className="h-4 w-4" /> },
  { value: 'line', label: 'Line', icon: <LineChartIcon className="h-4 w-4" /> },
];

// ---------- Simulated candle data for fallback ----------
function generateSimulatedCandles(symbol: string, count: number = 50): CandleData[] {
  // Approximate base prices for common symbols
  const bases: Record<string, number> = {
    AAPL: 195, GOOGL: 178, MSFT: 445, AMZN: 198, NVDA: 920,
    TSLA: 245, META: 530, NFLX: 720, AMD: 178, INTC: 32,
    BTC: 67500, ETH: 3520, SOL: 172, BNB: 595, XRP: 0.58,
    DOGE: 0.165, ADA: 0.48, AVAX: 38, DOT: 7.35, LINK: 17.8,
    EURUSD: 1.085, GBPUSD: 1.272, USDJPY: 154.5, AUDUSD: 0.665,
    XAUUSD: 2385, XAGUSD: 28.5, US30: 39500, NAS100: 18350,
  };
  const base = bases[symbol] || 100;
  const candles: CandleData[] = [];
  const now = Date.now();
  const intervalMs = 86400000; // 1 day for simulated data

  let price = base * (0.94 + Math.random() * 0.12);
  for (let i = count - 1; i >= 0; i--) {
    const ts = now - i * intervalMs;
    const volatility = base * 0.006;
    const drift = (Math.random() - 0.47) * volatility;
    const open = price;
    const close = price + drift;
    const high = Math.max(open, close) + Math.random() * volatility * 0.5;
    const low = Math.min(open, close) - Math.random() * volatility * 0.5;
    const volume = Math.floor(Math.random() * 5000000) + 500000;
    candles.push({ timestamp: ts, open, high, low, close, volume });
    price = close;
  }
  return candles;
}

// ---------- Helper to avoid JSX in ternaries ----------
function PriceChangeIcon({ isUp }: { isUp: boolean }) {
  if (isUp) {
    return <ArrowUpRight className="h-5 w-5 text-emerald-500" />;
  }
  return <ArrowDownRight className="h-5 w-5 text-red-500" />;
}

const tooltipStyle: React.CSSProperties = {
  backgroundColor: 'hsl(var(--card))',
  border: '1px solid hsl(var(--border))',
  borderRadius: '8px',
  fontSize: '12px',
};

// ---------- CandlestickShape ----------
function CandlestickShape(props: any) {
  const { x, y, width, height, payload, background } = props;
  if (!payload || x == null || y == null) return null;

  const isUp = payload.close >= payload.open;
  const color = isUp ? '#10b981' : '#ef4444';
  const chartHeight = background?.height || 300;
  const yMin = background?.y || 0;
  const yMax = yMin + chartHeight;

  const range = payload.high - payload.low || 1;
  const toY = (val: number) => yMax - ((val - payload.low) / range) * chartHeight;

  const openY = toY(payload.open);
  const closeY = toY(payload.close);
  const highY = toY(payload.high);
  const lowY = toY(payload.low);

  const bodyTop = Math.min(openY, closeY);
  const bodyHeight = Math.max(Math.abs(closeY - openY), 1);
  const wickX = x + width / 2;

  return (
    <g>
      <line x1={wickX} y1={highY} x2={wickX} y2={lowY} stroke={color} strokeWidth={1} />
      <rect
        x={x}
        y={bodyTop}
        width={width}
        height={bodyHeight}
        fill={color}
        opacity={0.9}
        stroke={color}
        strokeWidth={0.5}
      />
    </g>
  );
}

// ---------- Candlestick Tooltip ----------
function CandleTooltipContent({ active, payload }: any) {
  if (!active || !payload?.[0]?.payload) return null;
  const d = payload[0].payload;
  return (
    <div style={tooltipStyle} className="p-2">
      <div className="text-xs text-muted-foreground mb-1">{d.time}</div>
      <div className="flex gap-3 text-xs tabular-nums">
        <span>O: <b>{formatPrice(d.open, '')}</b></span>
        <span>H: <b>{formatPrice(d.high, '')}</b></span>
        <span>L: <b>{formatPrice(d.low, '')}</b></span>
        <span>C: <b>{formatPrice(d.close, '')}</b></span>
      </div>
    </div>
  );
}

// ---------- Main Component ----------
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

  // Use simulated data when no real candles are available
  const displayCandles = useMemo(() => {
    if (candles.length > 0) return candles;
    if (!selectedSymbol) return [];
    return generateSimulatedCandles(selectedSymbol);
  }, [candles, selectedSymbol]);

  const chartData = useMemo(() => {
    return displayCandles.map(c => ({
      time: new Date(c.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      ...c,
    }));
  }, [displayCandles]);

  const lastCandle = displayCandles[displayCandles.length - 1];
  const prevCandle = displayCandles[displayCandles.length - 2];
  const priceChange = lastCandle && prevCandle ? lastCandle.close - prevCandle.close : 0;
  const priceChangePct = prevCandle ? (priceChange / prevCandle.close) * 100 : 0;
  const isUp = priceChange >= 0;
  const strokeColor = isUp ? '#10b981' : '#ef4444';
  const candleDomain = useMemo(() => {
    if (displayCandles.length === 0) return ['auto', 'auto'] as [number, number];
    const lows = displayCandles.map(c => c.low);
    const highs = displayCandles.map(c => c.high);
    return [Math.min(...lows) * 0.998, Math.max(...highs) * 1.002] as [number, number];
  }, [displayCandles]);

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

  const renderChart = () => {
    // Show loading spinner only when we have no data at all (first load)
    if (isLoading && candles.length === 0 && displayCandles.length === 0) {
      return (
        <div className="h-full flex items-center justify-center">
          <div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      );
    }

    // If still no data after all fallbacks, show a message
    if (chartData.length === 0) {
      return (
        <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
          No chart data available
        </div>
      );
    }

    switch (chartType) {
      case 'area':
        return (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
              <defs>
                <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={strokeColor} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={strokeColor} stopOpacity={0} />
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
                contentStyle={tooltipStyle}
                formatter={(value: number) => [formatPrice(value, selectedSymbol || ''), 'Price']}
              />
              <Area
                type="monotone"
                dataKey="close"
                stroke={strokeColor}
                strokeWidth={2}
                fill="url(#priceGradient)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        );

      case 'candle':
        return (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis dataKey="time" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickLine={false} />
              <YAxis
                domain={candleDomain}
                tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickLine={false}
                tickFormatter={(v: number) => formatPrice(v, selectedSymbol || '')}
              />
              <Tooltip content={<CandleTooltipContent />} />
              <Bar
                dataKey="close"
                shape={<CandlestickShape />}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        );

      case 'line':
        return (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis dataKey="time" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickLine={false} />
              <YAxis
                domain={['auto', 'auto']}
                tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickLine={false}
                tickFormatter={(v: number) => formatPrice(v, selectedSymbol || '')}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value: number) => [formatPrice(value, selectedSymbol || ''), 'Price']}
              />
              <Line
                type="monotone"
                dataKey="close"
                stroke={strokeColor}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        );

      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-start justify-between px-4 pt-3 pb-2">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold">{selectedSymbol}</h2>
            <PriceChangeIcon isUp={isUp} />
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

      {/* Chart Type Selector */}
      <div className="flex items-center gap-1 px-4 pb-2">
        {CHART_TYPES.map(ct => (
          <button
            key={ct.value}
            onClick={() => setChartType(ct.value)}
            className={`cursor-pointer inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
              chartType === ct.value
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent'
            }`}
          >
            {ct.icon}
            <span className="hidden lg:inline">{ct.label}</span>
          </button>
        ))}
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
        {renderChart()}
      </div>

      {/* Volume Bar Chart */}
      {displayCandles.length > 0 && displayCandles.some(c => c.volume > 0) && (
        <div className="h-16 px-2 pb-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData.slice(-30)} margin={{ top: 0, right: 5, bottom: 0, left: 5 }}>
              <Bar dataKey="volume" isAnimationActive={false} radius={[2, 2, 0, 0]}>
                {chartData.slice(-30).map((entry, idx) => {
                  const fill = chartType === 'candle'
                    ? (entry.close >= entry.open ? '#10b981' : '#ef4444')
                    : 'hsl(var(--muted-foreground))';
                  const opacity = chartType === 'candle' ? 0.5 : 0.3;
                  return <Cell key={idx} fill={fill} opacity={opacity} />;
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
