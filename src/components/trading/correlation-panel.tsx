'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Grid3x3,
  RefreshCw,
  Loader2,
  AlertTriangle,
  Info,
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
interface CorrelationData {
  symbols: string[];
  matrix: Record<string, Record<string, number>>;
  asRows?: { symbol: string; values: number[] }[];
  computedAt: string;
  source?: string;
}

// ── Color logic ─────────────────────────────────────────
function cellColor(v: number): { bg: string; text: string } {
  // >0.7 green, 0.3-0.7 light green, -0.3-0.3 gray,
  // -0.7--0.3 light red, <-0.7 red. Diagonal (1.0) gets a subtle accent.
  if (v >= 0.7) return { bg: 'bg-emerald-500/80', text: 'text-white' };
  if (v >= 0.3) return { bg: 'bg-emerald-500/30', text: 'text-emerald-700 dark:text-emerald-200' };
  if (v > -0.3) return { bg: 'bg-muted/60', text: 'text-muted-foreground' };
  if (v > -0.7) return { bg: 'bg-red-500/30', text: 'text-red-700 dark:text-red-200' };
  return { bg: 'bg-red-500/80', text: 'text-white' };
}

function fmtCell(v: number): string {
  return v.toFixed(2);
}

// ── Legend ──────────────────────────────────────────────
const LEGEND: { range: string; bg: string; label: string }[] = [
  { range: '> 0.70', bg: 'bg-emerald-500/80', label: 'Strong positive' },
  { range: '0.30 – 0.70', bg: 'bg-emerald-500/30', label: 'Positive' },
  { range: '-0.30 – 0.30', bg: 'bg-muted/60', label: 'Neutral' },
  { range: '-0.70 – -0.30', bg: 'bg-red-500/30', label: 'Negative' },
  { range: '< -0.70', bg: 'bg-red-500/80', label: 'Strong negative' },
];

// ── Main Component ──────────────────────────────────────
export function CorrelationPanel() {
  const [data, setData] = useState<CorrelationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async (silent = false) => {
    try {
      if (silent) setRefreshing(true);
      else setLoading(true);
      const res = await fetch('/api/trading/correlation', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load correlation');
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
  }, []);

  if (loading) {
    return (
      <Card className="animate-pulse">
        <CardHeader>
          <div className="h-4 w-40 bg-muted rounded" />
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-8 gap-1">
            {Array.from({ length: 64 }).map((_, i) => (
              <div key={i} className="aspect-square bg-muted rounded" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error || !data || !data.symbols.length) {
    return (
      <Card className="border-destructive/50 bg-destructive/5">
        <CardContent className="p-6 text-center">
          <AlertTriangle className="h-8 w-8 text-destructive/50 mx-auto mb-2" />
          <p className="text-sm text-destructive">
            {error ?? 'No correlation data available'}
          </p>
          <Button size="sm" variant="outline" className="mt-3" onClick={() => fetchData()}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const { symbols, matrix } = data;
  const computed = new Date(data.computedAt);

  // Determine cell size based on number of symbols (keep readable)
  const count = symbols.length;
  const cellSize = count > 8 ? 'w-12 h-12 text-[10px]' : count > 5 ? 'w-14 h-14 text-xs' : 'w-16 h-16 text-sm';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Grid3x3 className="h-4 w-4" />
          Asset Correlation Matrix
          {data.source && (
            <Badge variant="outline" className="text-[10px] h-5">{data.source}</Badge>
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

      {/* Heatmap */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">
            {count}×{count} Pearson Correlation
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="inline-block min-w-full"
          >
            <table className="border-separate border-spacing-1">
              <thead>
                <tr>
                  <th className="w-16" />
                  {symbols.map((s) => (
                    <th
                      key={s}
                      className="text-center text-[10px] font-semibold text-muted-foreground px-1 pb-1"
                    >
                      {s}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {symbols.map((rowSym, rIdx) => (
                  <tr key={rowSym}>
                    <td className="text-right text-[10px] font-semibold text-muted-foreground pr-2 whitespace-nowrap">
                      {rowSym}
                    </td>
                    {symbols.map((colSym, cIdx) => {
                      const v = matrix[rowSym]?.[colSym] ?? 0;
                      const { bg, text } = cellColor(v);
                      const isDiagonal = rowSym === colSym;
                      return (
                        <td key={colSym}>
                          <motion.div
                            initial={{ opacity: 0, scale: 0.85 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{
                              delay: (rIdx + cIdx) * 0.015,
                              duration: 0.25,
                            }}
                            className={`${cellSize} ${bg} ${text} rounded-md flex items-center justify-center font-semibold tabular-nums ${
                              isDiagonal ? 'ring-1 ring-inset ring-foreground/20' : ''
                            }`}
                            title={`${rowSym} ↔ ${colSym}: ${v.toFixed(4)}`}
                          >
                            {fmtCell(v)}
                          </motion.div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </motion.div>
          <p className="text-[11px] text-muted-foreground mt-3">
            Computed {computed.toLocaleString()}
          </p>
        </CardContent>
      </Card>

      {/* Legend */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold inline-flex items-center gap-1.5">
            <Info className="h-3.5 w-3.5 text-muted-foreground" />
            Legend
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {LEGEND.map((l) => (
              <div
                key={l.range}
                className="flex items-center gap-2 rounded-md border bg-card/50 p-2"
              >
                <span className={`h-5 w-5 rounded ${l.bg} shrink-0`} />
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold tabular-nums leading-tight">
                    {l.range}
                  </p>
                  <p className="text-[10px] text-muted-foreground leading-tight truncate">
                    {l.label}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
