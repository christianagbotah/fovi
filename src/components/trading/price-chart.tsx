'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell,
  ComposedChart, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import { ArrowUpRight, ArrowDownRight, AreaChart as AreaChartIcon, BarChart3, LineChart as LineChartIcon, RefreshCw } from 'lucide-react';
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

// Symbols to cycle through in auto-ticker mode
const TICKER_SYMBOLS = ['BTC/USD', 'ETH/USD', 'NVDA', 'AAPL', 'SOL/USD', 'TSLA', 'XAUUSD', 'EURUSD'];
const TICKER_INTERVAL_MS = 6000;

// ---------- Simulated candle data for fallback ----------
function generateSimulatedCandles(symbol: string, count: number = 50): CandleData[] {
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
  const intervalMs = 86400000;

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

const AXIS_COLOR = '#94a3b8'; // slate-400: visible on both light & dark backgrounds
const GRID_COLOR = 'rgba(148,163,184,0.12)';
const VOLUME_UP = '#10b981';
const VOLUME_DOWN = '#ef4444';

const tooltipStyle: React.CSSProperties = {
  backgroundColor: '#1e293b',
  border: '1px solid #334155',
  borderRadius: '8px',
  fontSize: '12px',
  color: '#e2e8f0',
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
interface PriceChartProps {
  autoTick?: boolean;
}

export function PriceChart({ autoTick: autoTickProp }: PriceChartProps) {
  const store = useTradingStore();
  const selectedSymbol = store.selectedSymbol;
  const selectedTimeframe = store.selectedTimeframe;
  const setSelectedTimeframe = store.setSelectedTimeframe;
  const candles = store.candles;
  const setCandles = store.setCandles;
  const isLoading = store.isLoading;
  const setIsLoading = store.setIsLoading;
  const setOrderSheetOpen = store.setOrderSheetOpen;
  const setOrderSymbol = store.setOrderSymbol;
  const allSymbols = store.allSymbols;
  const livePrices = store.livePrices;

  const [chartType, setChartType] = useState<ChartType>('area');
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [chartHeight, setChartHeight] = useState(300);

  // Measure chart container height so ResponsiveContainer can use it
  useEffect(() => {
    const el = chartContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const h = entry.contentRect.height;
        if (h > 0) setChartHeight(h);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Auto-ticker: cycle through symbols when none is explicitly selected
  const isAutoTick = autoTickProp || !selectedSymbol;
  const tickerIdx = useRef(0);
  const [tickerSymbol, setTickerSymbol] = useState<string>(TICKER_SYMBOLS[0]);
  const tickerPaused = useRef(false);

  // The effective symbol to display (auto-tick ignores store selection)
  const effectiveSymbol = isAutoTick ? tickerSymbol : (selectedSymbol || tickerSymbol);

  // Advance ticker index
  const advanceTicker = useCallback(() => {
    if (tickerPaused.current) return;
    tickerIdx.current = (tickerIdx.current + 1) % TICKER_SYMBOLS.length;
    setTickerSymbol(TICKER_SYMBOLS[tickerIdx.current]);
  }, []);

  // Auto-ticker interval
  useEffect(() => {
    if (!isAutoTick) return;
    const id = setInterval(advanceTicker, TICKER_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isAutoTick, advanceTicker]);

  // Reset ticker to 0 when entering auto-tick mode
  useEffect(() => {
    if (isAutoTick) {
      tickerIdx.current = 0;
      tickerPaused.current = false;
    }
  }, [isAutoTick]);

  // Fetch candle data
  const fetchCandles = useCallback(async (sym?: string) => {
    const symbol = sym || effectiveSymbol;
    if (!symbol) return;
    setIsLoading(true);
    try {
      const res = await fetch(`/api/trading/market/symbols?symbol=${symbol}&timeframe=${selectedTimeframe}&limit=100`);
      const data = await res.json();
      setCandles(data);
    } catch {
      // error
    } finally {
      setIsLoading(false);
    }
  }, [effectiveSymbol, selectedTimeframe, setCandles, setIsLoading]);

  useEffect(() => {
    setCandles([]);
    fetchCandles();
    const interval = setInterval(() => fetchCandles(), 30000);
    return () => clearInterval(interval);
  }, [effectiveSymbol, selectedTimeframe, fetchCandles, setCandles]);

  // Use simulated data when no real candles are available
  const displayCandles = useMemo(() => {
    if (candles.length > 0) return candles;
    if (!effectiveSymbol) return [];
    return generateSimulatedCandles(effectiveSymbol);
  }, [candles, effectiveSymbol]);

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
  const candleDomain = useMemo((): [string | number, string | number] => {
    if (displayCandles.length === 0) return ['auto', 'auto'];
    const lows = displayCandles.map(c => c.low);
    const highs = displayCandles.map(c => c.high);
    return [Math.min(...lows) * 0.998, Math.max(...highs) * 1.002];
  }, [displayCandles]);

  // Get live price for current symbol
  const symbolData = useMemo(() => {
    const pool = livePrices.length > 0 ? livePrices : allSymbols;
    return pool.find(s => s.symbol === effectiveSymbol);
  }, [livePrices, allSymbols, effectiveSymbol]);

  const displayPrice = symbolData?.price || lastCandle?.close || 0;
  const displayChange = symbolData?.changePercent ?? priceChangePct;
  const displayIsUp = displayChange >= 0;

  const handleBuySell = (side: 'buy' | 'sell') => {
    setOrderSymbol(effectiveSymbol);
    setOrderSheetOpen(true);
  };

  // Progress bar for ticker (resets on each cycle)
  const [tickerProgress, setTickerProgress] = useState(0);
  useEffect(() => {
    if (!isAutoTick) { setTickerProgress(0); return; }
    setTickerProgress(0);
    const frame = setInterval(() => {
      setTickerProgress(p => {
        if (p >= 100) return 0;
        return p + (100 / (TICKER_INTERVAL_MS / 100));
      });
    }, 100);
    return () => clearInterval(frame);
  }, [isAutoTick, tickerSymbol]);

  if (!effectiveSymbol) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        Loading market data...
      </div>
    );
  }

  const renderChart = () => {
    if (isLoading && candles.length === 0 && displayCandles.length === 0) {
      return (
        <div className="h-full flex items-center justify-center">
          <div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      );
    }

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
          <ResponsiveContainer width="100%" height={chartHeight}>
            <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
              <defs>
                <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={strokeColor} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={strokeColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: AXIS_COLOR }} stroke={GRID_COLOR} tickLine={false} axisLine={{ stroke: GRID_COLOR }} />
              <YAxis
                domain={['auto', 'auto']}
                tick={{ fontSize: 10, fill: AXIS_COLOR }} stroke={GRID_COLOR} tickLine={false} axisLine={{ stroke: GRID_COLOR }}
                tickFormatter={(v: number) => formatPrice(v, effectiveSymbol)}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value: number) => [formatPrice(value, effectiveSymbol), 'Price']}
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
          <ResponsiveContainer width="100%" height={chartHeight}>
            <ComposedChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: AXIS_COLOR }} stroke={GRID_COLOR} tickLine={false} axisLine={{ stroke: GRID_COLOR }} />
              <YAxis
                domain={candleDomain}
                tick={{ fontSize: 10, fill: AXIS_COLOR }} stroke={GRID_COLOR} tickLine={false} axisLine={{ stroke: GRID_COLOR }}
                tickFormatter={(v: number) => formatPrice(v, effectiveSymbol)}
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
          <ResponsiveContainer width="100%" height={chartHeight}>
            <LineChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: AXIS_COLOR }} stroke={GRID_COLOR} tickLine={false} axisLine={{ stroke: GRID_COLOR }} />
              <YAxis
                domain={['auto', 'auto']}
                tick={{ fontSize: 10, fill: AXIS_COLOR }} stroke={GRID_COLOR} tickLine={false} axisLine={{ stroke: GRID_COLOR }}
                tickFormatter={(v: number) => formatPrice(v, effectiveSymbol)}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value: number) => [formatPrice(value, effectiveSymbol), 'Price']}
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
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-start justify-between px-4 pt-3 pb-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold truncate">{effectiveSymbol}</h2>
            {isAutoTick && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-bold shrink-0">
                <RefreshCw className="h-3 w-3 animate-spin" style={{ animationDuration: '3s' }} />
                LIVE
              </span>
            )}
            <PriceChangeIcon isUp={displayIsUp} />
          </div>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-2xl font-bold tabular-nums">
              {displayPrice ? formatPrice(displayPrice, effectiveSymbol) : (lastCandle ? formatPrice(lastCandle.close, effectiveSymbol) : '—')}
            </span>
            <span className={'text-sm font-medium ' + (displayIsUp ? 'text-emerald-500' : 'text-red-500')}>
              {displayIsUp ? '+' : ''}{displayChange.toFixed(2)}%
            </span>
          </div>
        </div>
        <div className="flex gap-1.5 mt-1 shrink-0">
          <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white h-9 px-4"
            onClick={() => handleBuySell('buy')}>Buy</Button>
          <Button size="sm" variant="outline" className="text-red-500 border-red-500/30 hover:bg-red-500/10 h-9 px-4"
            onClick={() => handleBuySell('sell')}>Sell</Button>
        </div>
      </div>

      {/* Ticker progress bar */}
      {isAutoTick && (
        <div className="px-4">
          <div className="h-0.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary/50 rounded-full transition-[width] duration-100 ease-linear"
              style={{ width: Math.min(tickerProgress, 100) + '%' }}
            />
          </div>
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            {TICKER_SYMBOLS.map((s, i) => (
              <button
                key={s}
                onClick={() => {
                  tickerIdx.current = i;
                  setTickerSymbol(s);
                  tickerPaused.current = true;
                  setTimeout(() => { tickerPaused.current = false; }, TICKER_INTERVAL_MS * 2);
                }}
                className={'px-1.5 py-0.5 text-[10px] font-medium rounded transition-colors cursor-pointer ' + (s === tickerSymbol ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-accent/50')}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Chart Type Selector */}
      <div className="flex items-center gap-1 px-4 pb-2">
        {CHART_TYPES.map(ct => (
          <button
            key={ct.value}
            onClick={() => setChartType(ct.value)}
            className={'cursor-pointer inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors ' + (chartType === ct.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent')}
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
            className={'px-2.5 py-1 text-xs font-medium rounded-md transition-colors ' + (selectedTimeframe === tf.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent')}
          >{tf.label}</button>
        ))}
      </div>

      {/* Chart */}
      <div ref={chartContainerRef} className="flex-1 min-h-[200px] px-2 pb-2">
        {chartHeight > 0 && renderChart()}
      </div>

      {/* Volume Bar Chart */}
      {displayCandles.length > 0 && displayCandles.some(c => c.volume > 0) && (
        <div className="h-16 px-2 pb-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData.slice(-30)} margin={{ top: 0, right: 5, bottom: 0, left: 5 }}>
              <Bar dataKey="volume" isAnimationActive={false} radius={[2, 2, 0, 0]}>
                {chartData.slice(-30).map((entry, idx) => {
                  const fill = chartType === 'candle'
                    ? (entry.close >= entry.open ? VOLUME_UP : VOLUME_DOWN)
                    : '#6366f1';
                  const opacity = chartType === 'candle' ? 0.6 : 0.35;
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
