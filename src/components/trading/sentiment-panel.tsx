'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Activity,
  Gauge,
  MessageCircle,
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

// ── Types ───────────────────────────────────────────────
type Trend = 'bullish' | 'bearish' | 'neutral';
type Volume = 'high' | 'medium' | 'low';

interface AssetSentiment {
  symbol: string;
  sentiment: number;
  label: string;
  socialVolume: Volume;
  trend: Trend;
  mentionCount: number;
  positiveMentions: number;
  negativeMentions: number;
}

interface SentimentData {
  fearGreedIndex: number;
  label: string;
  updatedAt: string;
  assets: AssetSentiment[];
  source?: string;
}

// ── Helpers ─────────────────────────────────────────────
function gaugeInfo(score: number): {
  label: string;
  color: string;
  bg: string;
  text: string;
} {
  if (score < 20) {
    return {
      label: 'Extreme Fear',
      color: '#ef4444',
      bg: 'bg-red-500/15',
      text: 'text-red-500',
    };
  }
  if (score < 40) {
    return {
      label: 'Fear',
      color: '#f97316',
      bg: 'bg-orange-500/15',
      text: 'text-orange-500',
    };
  }
  if (score < 60) {
    return {
      label: 'Neutral',
      color: '#eab308',
      bg: 'bg-yellow-500/15',
      text: 'text-yellow-500',
    };
  }
  if (score < 80) {
    return {
      label: 'Greed',
      color: '#84cc16',
      bg: 'bg-lime-500/15',
      text: 'text-lime-500',
    };
  }
  return {
    label: 'Extreme Greed',
    color: '#22c55e',
    bg: 'bg-emerald-500/15',
    text: 'text-emerald-500',
  };
}

function volumeInfo(v: Volume): { label: string; variant: 'default' | 'secondary' | 'outline' } {
  switch (v) {
    case 'high':
      return { label: 'High Volume', variant: 'default' };
    case 'medium':
      return { label: 'Med Volume', variant: 'secondary' };
    default:
      return { label: 'Low Volume', variant: 'outline' };
  }
}

function trendInfo(t: Trend): {
  label: string;
  icon: React.ElementType;
  cls: string;
  badge: string;
} {
  switch (t) {
    case 'bullish':
      return {
        label: 'Bullish',
        icon: TrendingUp,
        cls: 'text-emerald-500',
        badge: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30',
      };
    case 'bearish':
      return {
        label: 'Bearish',
        icon: TrendingDown,
        cls: 'text-red-500',
        badge: 'bg-red-500/15 text-red-600 border-red-500/30',
      };
    default:
      return {
        label: 'Neutral',
        icon: Minus,
        cls: 'text-muted-foreground',
        badge: 'bg-muted text-muted-foreground border-border',
      };
  }
}

// ── Gauge Sub-component ─────────────────────────────────
function FearGreedGauge({ score }: { score: number }) {
  const info = gaugeInfo(score);
  // Semi-circle gauge: 180 degrees, score 0 → -90deg, score 100 → 90deg
  const angle = -90 + (score / 100) * 180;
  const radius = 70;
  const cx = 90;
  const cy = 90;
  const needleX = cx + radius * Math.cos((angle * Math.PI) / 180);
  const needleY = cy + radius * Math.sin((angle * Math.PI) / 180);

  // Build arc segments for the 5 zones
  const zones = [
    { from: 0, to: 20, color: '#ef4444' },
    { from: 20, to: 40, color: '#f97316' },
    { from: 40, to: 60, color: '#eab308' },
    { from: 60, to: 80, color: '#84cc16' },
    { from: 80, to: 100, color: '#22c55e' },
  ];

  function polar(r: number, deg: number) {
    return [cx + r * Math.cos((deg * Math.PI) / 180), cy + r * Math.sin((deg * Math.PI) / 180)];
  }

  function arcPath(from: number, to: number, r: number) {
    const a1 = -90 + (from / 100) * 180;
    const a2 = -90 + (to / 100) * 180;
    const [x1, y1] = polar(r, a1);
    const [x2, y2] = polar(r, a2);
    const large = a2 - a1 > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
  }

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 180 110" className="w-full max-w-[220px]">
        {/* Track background */}
        <path
          d={arcPath(0, 100, radius)}
          fill="none"
          stroke="currentColor"
          strokeWidth={14}
          className="text-muted/40"
          strokeLinecap="round"
        />
        {/* Zone arcs */}
        {zones.map((z) => (
          <path
            key={z.from}
            d={arcPath(z.from, z.to, radius)}
            fill="none"
            stroke={z.color}
            strokeWidth={14}
            strokeLinecap="butt"
            opacity={0.85}
          />
        ))}
        {/* Needle */}
        <motion.line
          x1={cx}
          y1={cy}
          x2={needleX}
          y2={needleY}
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
          className="text-foreground"
          initial={{ rotate: -90 }}
          animate={{ rotate: angle }}
          transition={{ type: 'spring', stiffness: 60, damping: 14 }}
          style={{ originX: `${cx}px`, originY: `${cy}px` }}
        />
        <circle cx={cx} cy={cy} r={6} className="fill-foreground" />
      </svg>
      <div className="text-center -mt-2">
        <motion.div
          key={score}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          className={`text-5xl font-bold tabular-nums ${info.text}`}
        >
          {score}
        </motion.div>
        <div className={`mt-1 inline-flex items-center gap-1.5 rounded-full px-3 py-0.5 text-xs font-medium ${info.bg} ${info.text}`}>
          <Gauge className="h-3 w-3" />
          {info.label}
        </div>
      </div>
    </div>
  );
}

// ── Asset Card ──────────────────────────────────────────
function AssetCard({ asset, index }: { asset: AssetSentiment; index: number }) {
  const info = gaugeInfo(asset.sentiment);
  const vol = volumeInfo(asset.socialVolume);
  const trend = trendInfo(asset.trend);
  const TrendIcon = trend.icon;
  const positivePct = asset.mentionCount
    ? Math.round((asset.positiveMentions / asset.mentionCount) * 100)
    : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
    >
      <Card className="overflow-hidden h-full">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-bold tracking-tight">
              {asset.symbol}
            </CardTitle>
            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${trend.badge}`}>
              <TrendIcon className="h-3 w-3" />
              {trend.label}
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Sentiment score + bar */}
          <div>
            <div className="flex items-baseline justify-between mb-1.5">
              <span className="text-xs text-muted-foreground">Sentiment</span>
              <span className={`text-2xl font-bold tabular-nums ${info.text}`}>
                {asset.sentiment}
              </span>
            </div>
            <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
              <motion.div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{ backgroundColor: info.color }}
                initial={{ width: 0 }}
                animate={{ width: `${asset.sentiment}%` }}
                transition={{ duration: 0.6, ease: 'easeOut' }}
              />
            </div>
            <div className="flex justify-between mt-1 text-[10px] text-muted-foreground">
              <span>Fear</span>
              <span className={info.text}>{asset.label}</span>
              <span>Greed</span>
            </div>
          </div>

          {/* Social volume badge */}
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <MessageCircle className="h-3 w-3" />
              {asset.mentionCount.toLocaleString()} mentions
            </span>
            <Badge variant={vol.variant} className="text-[10px] h-5">
              {vol.label}
            </Badge>
          </div>

          {/* Positive / negative split */}
          <div className="flex h-1.5 w-full overflow-hidden rounded-full">
            <div
              className="bg-emerald-500"
              style={{ width: `${positivePct}%` }}
              title={`${positivePct}% positive`}
            />
            <div
              className="bg-red-500"
              style={{ width: `${100 - positivePct}%` }}
              title={`${100 - positivePct}% negative`}
            />
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ── Main Component ──────────────────────────────────────
export function SentimentPanel() {
  const [data, setData] = useState<SentimentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async (silent = false) => {
    try {
      if (silent) setRefreshing(true);
      else setLoading(true);
      const res = await fetch('/api/trading/sentiment', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load sentiment');
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
    // Refresh every 60s to keep sentiment fresh
    const id = setInterval(() => fetchData(true), 60_000);
    return () => clearInterval(id);
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <Card className="animate-pulse">
          <CardContent className="p-6">
            <div className="h-40 bg-muted rounded mx-auto max-w-[220px]" />
          </CardContent>
        </Card>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-4 space-y-3">
                <div className="h-4 w-20 bg-muted rounded" />
                <div className="h-8 w-16 bg-muted rounded" />
                <div className="h-2 w-full bg-muted rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card className="border-destructive/50 bg-destructive/5">
        <CardContent className="p-6 text-center">
          <AlertTriangle className="h-8 w-8 text-destructive/50 mx-auto mb-2" />
          <p className="text-sm text-destructive">
            {error ?? 'No sentiment data available'}
          </p>
          <Button size="sm" variant="outline" className="mt-3" onClick={() => fetchData()}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const updated = new Date(data.updatedAt);

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Activity className="h-4 w-4" />
          Market Sentiment
          {data.source === 'demo' && (
            <Badge variant="outline" className="text-[10px] h-5">demo</Badge>
          )}
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5"
          onClick={() => fetchData(true)}
          disabled={refreshing}
        >
          {refreshing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Refresh
        </Button>
      </div>

      {/* Fear & Greed Gauge */}
      <Card>
        <CardContent className="p-6">
          <FearGreedGauge score={data.fearGreedIndex} />
          <p className="text-center text-[11px] text-muted-foreground mt-3">
            Updated {updated.toLocaleTimeString()} ·{' '}
            {data.assets.length} assets tracked
          </p>
        </CardContent>
      </Card>

      {/* Per-asset grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {data.assets.map((asset, i) => (
          <AssetCard key={asset.symbol} asset={asset} index={i} />
        ))}
      </div>
    </div>
  );
}
