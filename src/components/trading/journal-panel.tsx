'use client';

import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BookOpen,
  Plus,
  Loader2,
  TrendingUp,
  TrendingDown,
  Star,
  Sparkles,
  Lightbulb,
  Tag,
  X,
  ChevronDown,
  CalendarDays,
  Inbox,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';

// ── Types ───────────────────────────────────────────────
interface JournalEntry {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  exitPrice: number | null;
  qty: number;
  pnl: number | null;
  pnlPercent: number | null;
  entryReason?: string | null;
  exitReason?: string | null;
  aiInsight?: string | null;
  lessons?: string | null;
  rating?: number | null;
  tags?: string | null;
  createdAt: string;
  updatedAt?: string;
}

// ── Helpers ─────────────────────────────────────────────
function fmt(n: number, decimals = 2) {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function parseTags(tags?: string | null): string[] {
  if (!tags) return [];
  return tags
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

// ── Star Rating ─────────────────────────────────────────
function StarRating({ value }: { value: number | null | undefined }) {
  const rating = Math.max(0, Math.min(5, Number(value ?? 0)));
  return (
    <div className="flex items-center gap-0.5" aria-label={`Rating ${rating} of 5`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={`h-3 w-3 ${
            i < rating
              ? 'fill-amber-400 text-amber-400'
              : 'fill-transparent text-muted-foreground/40'
          }`}
        />
      ))}
    </div>
  );
}

// ── Journal Entry Card ──────────────────────────────────
function JournalEntryCard({ entry, index }: { entry: JournalEntry; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = entry.side === 'long';
  const isWin = (entry.pnl ?? 0) >= 0;
  const tags = parseTags(entry.tags);

  const hasDetail = Boolean(
    entry.aiInsight || entry.lessons || entry.entryReason || entry.exitReason,
  );

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ delay: Math.min(index * 40, 600) / 1000 }}
    >
      <Card className="overflow-hidden">
        {/* ── Header row ──────────────────────────────── */}
        <div
          className={`flex items-center gap-3 px-4 py-3 cursor-pointer select-none transition-colors hover:bg-accent/30 ${
            expanded ? 'bg-accent/20' : ''
          }`}
          onClick={() => hasDetail && setExpanded((v) => !v)}
          role={hasDetail ? 'button' : undefined}
          tabIndex={hasDetail ? 0 : undefined}
          onKeyDown={(e) => {
            if (hasDetail && (e.key === 'Enter' || e.key === ' ')) {
              e.preventDefault();
              setExpanded((v) => !v);
            }
          }}
        >
          {/* Symbol + side */}
          <div className="flex items-center gap-2 min-w-[110px]">
            <span className="font-semibold text-sm tabular-nums">{entry.symbol}</span>
            <Badge
              variant={isLong ? 'default' : 'destructive'}
              className="text-[10px] px-1.5 py-0 h-5"
            >
              {isLong ? (
                <TrendingUp className="h-3 w-3 mr-0.5" />
              ) : (
                <TrendingDown className="h-3 w-3 mr-0.5" />
              )}
              {entry.side}
            </Badge>
          </div>

          {/* Prices */}
          <div className="hidden sm:flex items-center gap-3 text-xs tabular-nums text-muted-foreground">
            <span>
              <span className="opacity-60">in</span> ${fmt(entry.entryPrice)}
            </span>
            {entry.exitPrice != null && (
              <span>
                <span className="opacity-60">out</span> ${fmt(entry.exitPrice)}
              </span>
            )}
            <span>
              <span className="opacity-60">qty</span> {fmt(entry.qty, 4)}
            </span>
          </div>

          {/* Rating */}
          <div className="hidden md:block">
            <StarRating value={entry.rating ?? null} />
          </div>

          {/* Tags */}
          {tags.length > 0 && (
            <div className="hidden lg:flex items-center gap-1 flex-1 min-w-0 overflow-hidden">
              {tags.slice(0, 3).map((t) => (
                <Badge key={t} variant="secondary" className="text-[10px] px-1.5 py-0 h-5">
                  <Tag className="h-2.5 w-2.5 mr-0.5" />
                  {t}
                </Badge>
              ))}
              {tags.length > 3 && (
                <span className="text-[10px] text-muted-foreground">+{tags.length - 3}</span>
              )}
            </div>
          )}

          {/* PnL */}
          <div className="ml-auto flex items-center gap-3">
            {entry.pnl != null ? (
              <div className="text-right">
                <p
                  className={`text-sm font-semibold tabular-nums ${
                    isWin ? 'text-emerald-500' : 'text-red-500'
                  }`}
                >
                  {isWin ? '+' : ''}${fmt(entry.pnl)}
                </p>
                {entry.pnlPercent != null && (
                  <p
                    className={`text-[11px] tabular-nums ${
                      isWin ? 'text-emerald-500/80' : 'text-red-500/80'
                    }`}
                  >
                    {isWin ? '+' : ''}
                    {fmt(entry.pnlPercent, 2)}%
                  </p>
                )}
              </div>
            ) : (
              <span className="text-xs text-muted-foreground">Open</span>
            )}

            {hasDetail && (
              <ChevronDown
                className={`h-4 w-4 text-muted-foreground transition-transform ${
                  expanded ? 'rotate-180' : ''
                }`}
              />
            )}
          </div>
        </div>

        {/* ── Mobile-only price row ───────────────────── */}
        <div className="sm:hidden px-4 pb-2 -mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] tabular-nums text-muted-foreground">
          <span>
            <span className="opacity-60">in</span> ${fmt(entry.entryPrice)}
          </span>
          {entry.exitPrice != null && (
            <span>
              <span className="opacity-60">out</span> ${fmt(entry.exitPrice)}
            </span>
          )}
          <span>
            <span className="opacity-60">qty</span> {fmt(entry.qty, 4)}
          </span>
          <div className="md:hidden">
            <StarRating value={entry.rating ?? null} />
          </div>
        </div>

        {/* Mobile tags row */}
        {tags.length > 0 && (
          <div className="lg:hidden px-4 pb-2 flex flex-wrap items-center gap-1">
            {tags.map((t) => (
              <Badge key={t} variant="secondary" className="text-[10px] px-1.5 py-0 h-5">
                <Tag className="h-2.5 w-2.5 mr-0.5" />
                {t}
              </Badge>
            ))}
          </div>
        )}

        {/* ── Expandable detail ───────────────────────── */}
        <AnimatePresence initial={false}>
          {expanded && hasDetail && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden border-t bg-muted/20"
            >
              <div className="p-4 space-y-3">
                {entry.aiInsight && (
                  <div className="flex gap-2.5">
                    <div className="mt-0.5 rounded-md bg-violet-500/10 p-1.5 shrink-0">
                      <Sparkles className="h-3.5 w-3.5 text-violet-500" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium text-muted-foreground mb-0.5">
                        AI Insight
                      </p>
                      <p className="text-sm leading-relaxed">{entry.aiInsight}</p>
                    </div>
                  </div>
                )}

                {entry.lessons && (
                  <div className="flex gap-2.5">
                    <div className="mt-0.5 rounded-md bg-amber-500/10 p-1.5 shrink-0">
                      <Lightbulb className="h-3.5 w-3.5 text-amber-500" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium text-muted-foreground mb-0.5">
                        Lessons Learned
                      </p>
                      <p className="text-sm leading-relaxed">{entry.lessons}</p>
                    </div>
                  </div>
                )}

                {(entry.entryReason || entry.exitReason) && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    {entry.entryReason && (
                      <div>
                        <p className="text-[11px] font-medium text-muted-foreground mb-0.5">
                          Entry Reason
                        </p>
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          {entry.entryReason}
                        </p>
                      </div>
                    )}
                    {entry.exitReason && (
                      <div>
                        <p className="text-[11px] font-medium text-muted-foreground mb-0.5">
                          Exit Reason
                        </p>
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          {entry.exitReason}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex items-center gap-1.5 pt-1 text-[11px] text-muted-foreground">
                  <CalendarDays className="h-3 w-3" />
                  {fmtDate(entry.createdAt)}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
    </motion.div>
  );
}

// ── Empty State ─────────────────────────────────────────
function EmptyState() {
  return (
    <Card>
      <CardContent className="py-12 text-center">
        <Inbox className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">No journal entries yet</p>
        <p className="text-xs text-muted-foreground/70 mt-1">
          Log your first trade to start building insights
        </p>
      </CardContent>
    </Card>
  );
}

// ── Main Component ──────────────────────────────────────
export function JournalPanel() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    symbol: '',
    side: 'long' as 'long' | 'short',
    entryPrice: '',
    exitPrice: '',
    qty: '',
    rating: '3',
    tags: '',
    entryReason: '',
    exitReason: '',
    lessons: '',
    aiInsight: '',
  });

  const fetchEntries = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/trading/journal');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load journal');
      setEntries(Array.isArray(json) ? json : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const resetForm = () => {
    setForm({
      symbol: '',
      side: 'long',
      entryPrice: '',
      exitPrice: '',
      qty: '',
      rating: '3',
      tags: '',
      entryReason: '',
      exitReason: '',
      lessons: '',
      aiInsight: '',
    });
  };

  const handleSubmit = async () => {
    if (!form.symbol.trim()) {
      setError('Symbol is required');
      return;
    }
    if (!form.entryPrice.trim()) {
      setError('Entry price is required');
      return;
    }
    if (!form.qty.trim()) {
      setError('Quantity is required');
      return;
    }

    setSubmitting(true);
    setError(null);

    // Compute PnL if both prices + qty are present
    const entry = Number(form.entryPrice);
    const exitRaw = form.exitPrice.trim();
    const exit = exitRaw ? Number(exitRaw) : null;
    const qty = Number(form.qty);
    let pnl: number | null = null;
    let pnlPercent: number | null = null;
    if (exit != null && !Number.isNaN(exit)) {
      const direction = form.side === 'long' ? 1 : -1;
      pnl = (exit - entry) * qty * direction;
      pnlPercent = entry > 0 ? ((exit - entry) / entry) * 100 * direction : 0;
    }

    const payload = {
      symbol: form.symbol.trim().toUpperCase(),
      side: form.side,
      entryPrice: entry,
      exitPrice: exit,
      qty,
      pnl,
      pnlPercent,
      rating: Number(form.rating),
      tags: form.tags.trim(),
      entryReason: form.entryReason.trim() || null,
      exitReason: form.exitReason.trim() || null,
      lessons: form.lessons.trim() || null,
      aiInsight: form.aiInsight.trim() || null,
    };

    try {
      const res = await fetch('/api/trading/journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to create entry');

      // Optimistically prepend; server may return partial record (no-db fallback)
      const newEntry: JournalEntry = {
        id: json.id ?? `journal_${Date.now()}`,
        symbol: json.symbol ?? payload.symbol,
        side: json.side ?? payload.side,
        entryPrice: json.entryPrice ?? payload.entryPrice,
        exitPrice: json.exitPrice ?? payload.exitPrice,
        qty: json.qty ?? payload.qty,
        pnl: json.pnl ?? payload.pnl,
        pnlPercent: json.pnlPercent ?? payload.pnlPercent,
        entryReason: json.entryReason ?? payload.entryReason,
        exitReason: json.exitReason ?? payload.exitReason,
        aiInsight:
          json.aiInsight ??
          payload.aiInsight ??
          'AI Insight: Trade logged. Review your entry timing and risk/reward ratio for refinement.',
        lessons: json.lessons ?? payload.lessons,
        rating: json.rating ?? payload.rating,
        tags: json.tags ?? payload.tags,
        createdAt: json.createdAt ?? new Date().toISOString(),
        updatedAt: json.updatedAt ?? new Date().toISOString(),
      };

      setEntries((prev) => [newEntry, ...prev]);
      resetForm();
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* ── Header + Add button ───────────────────────── */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Trade Journal</h3>
          {!loading && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-5 tabular-nums">
              {entries.length}
            </Badge>
          )}
        </div>
        <Button
          size="sm"
          variant={showForm ? 'outline' : 'default'}
          onClick={() => setShowForm((v) => !v)}
        >
          {showForm ? (
            <>
              <X className="h-4 w-4 mr-1.5" />
              Cancel
            </>
          ) : (
            <>
              <Plus className="h-4 w-4 mr-1.5" />
              Add Entry
            </>
          )}
        </Button>
      </div>

      {/* ── Add Entry Form ────────────────────────────── */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Plus className="h-4 w-4" />
                  New Journal Entry
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {/* Symbol */}
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Symbol *</label>
                    <Input
                      value={form.symbol}
                      onChange={(e) => setForm({ ...form, symbol: e.target.value.toUpperCase() })}
                      placeholder="AAPL"
                      className="h-8 text-sm tabular-nums"
                    />
                  </div>

                  {/* Side */}
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Side</label>
                    <Select
                      value={form.side}
                      onValueChange={(v) => setForm({ ...form, side: v as 'long' | 'short' })}
                    >
                      <SelectTrigger className="h-8 text-sm w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="long">Long</SelectItem>
                        <SelectItem value="short">Short</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Entry Price */}
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Entry Price *</label>
                    <Input
                      type="number"
                      step="0.01"
                      value={form.entryPrice}
                      onChange={(e) => setForm({ ...form, entryPrice: e.target.value })}
                      placeholder="195.50"
                      className="h-8 text-sm tabular-nums"
                    />
                  </div>

                  {/* Exit Price */}
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Exit Price</label>
                    <Input
                      type="number"
                      step="0.01"
                      value={form.exitPrice}
                      onChange={(e) => setForm({ ...form, exitPrice: e.target.value })}
                      placeholder="192.10"
                      className="h-8 text-sm tabular-nums"
                    />
                  </div>

                  {/* Qty */}
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Quantity *</label>
                    <Input
                      type="number"
                      step="0.0001"
                      value={form.qty}
                      onChange={(e) => setForm({ ...form, qty: e.target.value })}
                      placeholder="50"
                      className="h-8 text-sm tabular-nums"
                    />
                  </div>

                  {/* Rating */}
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Rating</label>
                    <Select
                      value={form.rating}
                      onValueChange={(v) => setForm({ ...form, rating: v })}
                    >
                      <SelectTrigger className="h-8 text-sm w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[1, 2, 3, 4, 5].map((r) => (
                          <SelectItem key={r} value={String(r)}>
                            <span className="flex items-center gap-1">
                              {r} <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Tags */}
                  <div className="space-y-1 sm:col-span-3 lg:col-span-2">
                    <label className="text-xs text-muted-foreground">Tags (comma-separated)</label>
                    <Input
                      value={form.tags}
                      onChange={(e) => setForm({ ...form, tags: e.target.value })}
                      placeholder="momentum, breakout, tech"
                      className="h-8 text-sm"
                    />
                  </div>
                </div>

                {/* Reasons + lessons + AI insight */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground flex items-center gap-1">
                      <TrendingUp className="h-3 w-3" /> Entry Reason
                    </label>
                    <Textarea
                      value={form.entryReason}
                      onChange={(e) => setForm({ ...form, entryReason: e.target.value })}
                      placeholder="Why did you enter this trade?"
                      className="min-h-16 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground flex items-center gap-1">
                      <TrendingDown className="h-3 w-3" /> Exit Reason
                    </label>
                    <Textarea
                      value={form.exitReason}
                      onChange={(e) => setForm({ ...form, exitReason: e.target.value })}
                      placeholder="Why did you exit?"
                      className="min-h-16 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground flex items-center gap-1">
                      <Lightbulb className="h-3 w-3 text-amber-500" /> Lessons Learned
                    </label>
                    <Textarea
                      value={form.lessons}
                      onChange={(e) => setForm({ ...form, lessons: e.target.value })}
                      placeholder="What would you do differently?"
                      className="min-h-16 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground flex items-center gap-1">
                      <Sparkles className="h-3 w-3 text-violet-500" /> AI Insight (optional)
                    </label>
                    <Textarea
                      value={form.aiInsight}
                      onChange={(e) => setForm({ ...form, aiInsight: e.target.value })}
                      placeholder="Leave blank to auto-generate"
                      className="min-h-16 text-sm"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <Button size="sm" onClick={handleSubmit} disabled={submitting}>
                    {submitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                        Saving…
                      </>
                    ) : (
                      <>
                        <Plus className="h-4 w-4 mr-1.5" />
                        Save Entry
                      </>
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      resetForm();
                    }}
                    disabled={submitting}
                  >
                    Clear
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Error ─────────────────────────────────────── */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <Card className="border-destructive/50 bg-destructive/5">
              <CardContent className="p-3 text-sm text-destructive">{error}</CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Loading skeleton ──────────────────────────── */}
      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="h-5 w-16 bg-muted rounded" />
                  <div className="h-5 w-12 bg-muted rounded" />
                  <div className="h-3 w-32 bg-muted rounded hidden sm:block" />
                  <div className="ml-auto h-8 w-20 bg-muted rounded" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ── Empty state ───────────────────────────────── */}
      {!loading && !error && entries.length === 0 && <EmptyState />}

      {/* ── Entries list ──────────────────────────────── */}
      {!loading && entries.length > 0 && (
        <ScrollArea className="max-h-96 pr-2">
          <div className="space-y-2">
            <AnimatePresence initial={false}>
              {entries.map((entry, i) => (
                <JournalEntryCard key={entry.id} entry={entry} index={i} />
              ))}
            </AnimatePresence>
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
