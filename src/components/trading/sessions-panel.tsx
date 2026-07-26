'use client';

import { useEffect, useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Clock,
  Globe2,
  RefreshCw,
  Loader2,
  AlertTriangle,
  CircleDot,
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
interface SessionInfo {
  id: string;
  name: string;
  open: string; // "HH:mm"
  close: string; // "HH:mm"
  utcOffset: number;
  status: 'active' | 'closed';
  openUtc: string;
  closeUtc: string;
  minutesUntilOpen: number;
  minutesUntilClose: number;
}

interface SessionsData {
  currentSession: string;
  timezone: string;
  utcOffsetMinutes: number;
  serverTime: string;
  sessions: SessionInfo[];
}

// ── Helpers ─────────────────────────────────────────────
function parseHHMM(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + (m || 0);
}

function fmtDuration(mins: number): string {
  if (mins <= 0) return 'now';
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (h <= 0) return `${m}m`;
  return `${h}h ${m}m`;
}

// Per-session visual identity (no indigo/blue)
const SESSION_STYLES: Record<
  string,
  { bar: string; dot: string; ring: string; label: string }
> = {
  london: {
    bar: 'bg-rose-500',
    dot: 'bg-rose-500',
    ring: 'ring-rose-500/40',
    label: 'London',
  },
  newyork: {
    bar: 'bg-emerald-500',
    dot: 'bg-emerald-500',
    ring: 'ring-emerald-500/40',
    label: 'New York',
  },
  asia: {
    bar: 'bg-amber-500',
    dot: 'bg-amber-500',
    ring: 'ring-amber-500/40',
    label: 'Asia',
  },
};

function styleFor(id: string) {
  return (
    SESSION_STYLES[id] ?? {
      bar: 'bg-muted',
      dot: 'bg-muted-foreground',
      ring: 'ring-border',
      label: id,
    }
  );
}

// ── Session Card ────────────────────────────────────────
function SessionCard({ session, isCurrent }: { session: SessionInfo; isCurrent: boolean }) {
  const st = styleFor(session.id);
  const active = session.status === 'active';
  const offsetLabel =
    session.utcOffset === 0
      ? 'UTC±0'
      : session.utcOffset > 0
        ? `UTC+${session.utcOffset}`
        : `UTC${session.utcOffset}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.05 }}
      className={`relative rounded-xl border bg-card p-4 ${
        active ? `ring-2 ${st.ring}` : ''
      }`}
    >
      {/* Pulse indicator for active session */}
      {active && (
        <span className="absolute top-3 right-3 inline-flex h-2.5 w-2.5">
          <span className={`absolute inline-flex h-full w-full rounded-full ${st.dot} opacity-60 animate-ping`} />
          <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${st.dot}`} />
        </span>
      )}

      <div className="flex items-center gap-2 mb-3">
        <span className={`h-2.5 w-2.5 rounded-full ${st.dot} ${active ? '' : 'opacity-40'}`} />
        <CardTitle className="text-base font-bold tracking-tight">
          {session.name}
        </CardTitle>
        {isCurrent && (
          <Badge className="text-[10px] h-5 gap-1 ml-auto mr-6">
            <CircleDot className="h-3 w-3" />
            Current
          </Badge>
        )}
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Open (UTC)</span>
          <span className="font-medium tabular-nums">{session.openUtc}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Close (UTC)</span>
          <span className="font-medium tabular-nums">{session.closeUtc}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">UTC Offset</span>
          <Badge variant="outline" className="text-[10px] h-5 tabular-nums">
            {offsetLabel}
          </Badge>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Status</span>
          <Badge
            variant={active ? 'default' : 'secondary'}
            className={`text-[10px] h-5 ${active ? 'bg-emerald-600 text-white' : ''}`}
          >
            {active ? 'Active' : 'Closed'}
          </Badge>
        </div>
        <div className="flex items-center justify-between border-t pt-2 mt-2">
          <span className="text-xs text-muted-foreground">
            {active ? 'Closes in' : 'Opens in'}
          </span>
          <span className="text-xs font-semibold tabular-nums">
            {active
              ? fmtDuration(session.minutesUntilClose)
              : fmtDuration(session.minutesUntilOpen)}
          </span>
        </div>
      </div>
    </motion.div>
  );
}

// ── Timeline Bar ────────────────────────────────────────
function TimelineBar({
  sessions,
  nowUtcMinutes,
}: {
  sessions: SessionInfo[];
  nowUtcMinutes: number;
}) {
  const TOTAL = 24 * 60; // 1440 minutes
  const nowPct = (nowUtcMinutes / TOTAL) * 100;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">24-Hour Timeline (UTC)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Hour scale */}
        <div className="relative h-6">
          {[0, 6, 12, 18, 24].map((h) => (
            <div
              key={h}
              className="absolute top-0 text-[10px] text-muted-foreground tabular-nums"
              style={{ left: `${(h / 24) * 100}%`, transform: 'translateX(-50%)' }}
            >
              {String(h).padStart(2, '0')}:00
            </div>
          ))}
        </div>

        {/* Sessions per row */}
        <div className="space-y-1.5">
          {sessions.map((s) => {
            const st = styleFor(s.id);
            const openMin = parseHHMM(s.open);
            const closeMin = parseHHMM(s.close);
            const wraps = closeMin <= openMin;
            const active = s.status === 'active';

            // Build segment(s). If wrap past midnight, render two segments.
            const segments = wraps
              ? [
                  { start: openMin, end: TOTAL },
                  { start: 0, end: closeMin },
                ]
              : [{ start: openMin, end: closeMin }];

            return (
              <div key={s.id} className="relative h-7 rounded-md bg-muted/40 overflow-hidden">
                {segments.map((seg, idx) => {
                  const left = (seg.start / TOTAL) * 100;
                  const width = ((seg.end - seg.start) / TOTAL) * 100;
                  return (
                    <motion.div
                      key={idx}
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: 1 }}
                      transition={{ duration: 0.5, ease: 'easeOut' }}
                      style={{
                        left: `${left}%`,
                        width: `${width}%`,
                        transformOrigin: 'left',
                      }}
                      className={`absolute inset-y-0 ${st.bar} ${
                        active ? 'opacity-100' : 'opacity-50'
                      } flex items-center justify-center text-[10px] font-semibold text-white`}
                    >
                      <span className="truncate px-1">{s.name}</span>
                    </motion.div>
                  );
                })}
                {/* Session name on the left for narrow segments */}
                <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[10px] font-medium text-muted-foreground/0 pointer-events-none">
                  {s.name}
                </span>
              </div>
            );
          })}
        </div>

        {/* Now indicator overlay */}
        <div className="relative -mt-[calc(1.75rem*3+0.375rem)] h-[calc(1.75rem*3+0.375rem)] pointer-events-none">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="absolute top-0 bottom-0 w-0.5 bg-foreground"
            style={{ left: `${nowPct}%` }}
          >
            <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-[9px] font-semibold bg-foreground text-background rounded px-1 py-0.5 whitespace-nowrap">
              NOW
            </span>
          </motion.div>
        </div>

        {/* Inline legend */}
        <div className="flex flex-wrap items-center gap-3 pt-2">
          {sessions.map((s) => {
            const st = styleFor(s.id);
            return (
              <div key={s.id} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className={`h-2.5 w-2.5 rounded-sm ${st.bar}`} />
                {s.name}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main Component ──────────────────────────────────────
export function SessionsPanel() {
  const [data, setData] = useState<SessionsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Local UTC clock — updates every second
  const [now, setNow] = useState<Date>(() => new Date());

  const fetchData = async (silent = false) => {
    try {
      if (silent) setRefreshing(true);
      else setLoading(true);
      const res = await fetch('/api/trading/sessions', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load sessions');
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
    // Poll sessions endpoint every 30s to keep active status fresh
    const id = setInterval(() => fetchData(true), 30_000);
    return () => clearInterval(id);
  }, []);

  // Tick the local clock every second
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const nowUtcMinutes = useMemo(
    () => now.getUTCHours() * 60 + now.getUTCMinutes(),
    [now],
  );

  if (loading) {
    return (
      <div className="space-y-4">
        <Card className="animate-pulse">
          <CardContent className="p-6 flex items-center justify-between">
            <div className="h-8 w-40 bg-muted rounded" />
            <div className="h-6 w-24 bg-muted rounded" />
          </CardContent>
        </Card>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-4 space-y-3">
                <div className="h-4 w-20 bg-muted rounded" />
                <div className="h-3 w-full bg-muted rounded" />
                <div className="h-3 w-full bg-muted rounded" />
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
            {error ?? 'No session data available'}
          </p>
          <Button size="sm" variant="outline" className="mt-3" onClick={() => fetchData()}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const utcTimeStr = now.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'UTC',
    hour12: false,
  });
  const utcDateStr = now.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  });

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Globe2 className="h-4 w-4" />
          Trading Sessions
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

      {/* Current session highlight + UTC clock */}
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] items-stretch">
            {/* Current session with pulse */}
            <div className="p-5 sm:p-6 flex flex-col justify-center gap-2 relative">
              <span className="absolute inset-0 overflow-hidden">
                <motion.span
                  className="absolute inset-0 bg-emerald-500/10"
                  animate={{ opacity: [0.3, 0.7, 0.3] }}
                  transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
                />
              </span>
              <div className="relative flex items-center gap-2">
                <span className="relative inline-flex h-3 w-3">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-60 animate-ping" />
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
                </span>
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Current Session
                </span>
              </div>
              <motion.div
                key={data.currentSession}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="relative text-3xl font-bold tracking-tight"
              >
                {data.currentSession}
              </motion.div>
              <p className="relative text-xs text-muted-foreground">
                {data.sessions.filter((s) => s.status === 'active').length} of{' '}
                {data.sessions.length} sessions active
              </p>
            </div>

            {/* UTC clock */}
            <div className="border-t sm:border-t-0 sm:border-l border-border p-5 sm:p-6 flex flex-col justify-center items-center sm:items-end gap-1 bg-muted/30">
              <div className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground uppercase tracking-wide">
                <Clock className="h-3 w-3" />
                UTC
              </div>
              <div className="text-2xl font-bold tabular-nums tracking-tight">
                {utcTimeStr}
              </div>
              <div className="text-xs text-muted-foreground tabular-nums">
                {utcDateStr}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Three session cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {data.sessions.map((s) => (
          <SessionCard
            key={s.id}
            session={s}
            isCurrent={s.name === data.currentSession}
          />
        ))}
      </div>

      {/* Timeline */}
      <TimelineBar sessions={data.sessions} nowUtcMinutes={nowUtcMinutes} />
    </div>
  );
}
