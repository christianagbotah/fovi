'use client';

// ============================================================
// useTradeNotifications — real-time AI auto-trade toast feed
// ------------------------------------------------------------
// Polls /api/trading/auto-trade/activity every 15s, compares the
// latest activity IDs against a ref of previously-seen IDs, and
// fires a Sonner toast for every newly detected trade.
//
// - Buy / cover  -> toast.success  (green up-arrow icon)
// - Sell / short -> toast.error    (red down-arrow icon)
// - Pending      -> toast.info     (clock icon)
//
// Toasts only fire when document.visibilityState === 'visible'.
// On the very first poll, IDs are seeded silently (no toast flood).
// ============================================================

import { createElement, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { ArrowUpRight, ArrowDownRight, Clock } from 'lucide-react';
import type { AutoTradeActivity } from '@/lib/store/trading-store';

const POLL_INTERVAL_MS = 15_000;
const INITIAL_DELAY_MS = 1_500; // avoid stampede with other on-mount fetches
const TOAST_DURATION_MS = 6_000;

// ── Formatters ──────────────────────────────────────────────
function fmtPrice(p: number): string {
  if (p >= 1000) return `$${p.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  if (p >= 1) return `$${p.toFixed(2)}`;
  return `$${p.toFixed(4)}`;
}

function fmtQty(q: number): string {
  if (Number.isInteger(q)) return q.toLocaleString();
  if (q >= 1) return q.toLocaleString(undefined, { maximumFractionDigits: 4 });
  return String(q);
}

// ── Toast variant picker ────────────────────────────────────
type ToastVariant = 'success' | 'error' | 'info';

function pickVariant(activity: AutoTradeActivity): ToastVariant {
  if (activity.status === 'pending') return 'info';
  const side = (activity.side || '').toLowerCase();
  if (side === 'buy' || side === 'cover') return 'success';
  if (side === 'sell' || side === 'short') return 'error';
  return 'info';
}

// ── Toast dispatcher ────────────────────────────────────────
function fireTradeToast(activity: AutoTradeActivity) {
  const variant = pickVariant(activity);
  const side = (activity.side || '').toLowerCase();
  const isBuy = side === 'buy' || side === 'cover';
  const isSell = side === 'sell' || side === 'short';
  const isPending = activity.status === 'pending';

  const Icon = isPending ? Clock : isBuy ? ArrowUpRight : isSell ? ArrowDownRight : Clock;
  const iconColor = isPending
    ? ''
    : isBuy
      ? 'text-emerald-500'
      : isSell
        ? 'text-red-500'
        : '';

  const title = `${(activity.side || 'TRADE').toUpperCase()} ${activity.symbol}`;
  const priceStr =
    activity.filledPrice != null ? fmtPrice(activity.filledPrice) : 'pending fill';
  const description = `${fmtQty(activity.qty)} @ ${priceStr} · ${(activity.status || 'unknown').toUpperCase()}`;

  const opts = {
    description,
    // createElement instead of JSX so this file can stay .ts (not .tsx).
    icon: createElement(Icon, { className: `h-4 w-4 ${iconColor}` }),
    duration: TOAST_DURATION_MS,
  };

  if (variant === 'success') toast.success(title, opts);
  else if (variant === 'error') toast.error(title, opts);
  else toast.info(title, opts);
}

// ── Hook ────────────────────────────────────────────────────
export function useTradeNotifications() {
  // Refs survive re-renders without retriggering the effect.
  const seenIdsRef = useRef<Set<string>>(new Set());
  const hasInitializedRef = useRef(false);
  const isVisibleRef = useRef(true);

  // Track page visibility so we can suppress toasts while the user
  // is on another tab. We don't skip polling — that way the seen-set
  // stays current and the user doesn't get flooded when they return.
  useEffect(() => {
    const update = () => {
      isVisibleRef.current =
        typeof document !== 'undefined' && document.visibilityState === 'visible';
    };
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  // Polling loop
  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const res = await fetch('/api/trading/auto-trade/activity', { cache: 'no-store' });
        if (!res.ok) return;
        const data: unknown = await res.json();
        if (cancelled || !Array.isArray(data)) return;

        const activities = data as AutoTradeActivity[];

        // First poll: seed the seen-set silently so we don't toast
        // every existing activity on page load.
        if (!hasInitializedRef.current) {
          for (const a of activities) {
            if (a?.id) seenIdsRef.current.add(a.id);
          }
          hasInitializedRef.current = true;
          return;
        }

        // Filter to truly-new activities (sorted newest-first by API).
        const newActivities = activities.filter(
          (a) => a?.id && !seenIdsRef.current.has(a.id),
        );
        if (newActivities.length === 0) return;

        // Record them so we don't re-fire on the next poll.
        for (const a of newActivities) seenIdsRef.current.add(a.id);

        // Only fire toasts when the user is actually looking at the page.
        if (!isVisibleRef.current) return;

        for (const a of newActivities) fireTradeToast(a);
      } catch {
        // Network blips happen — polling resumes on the next interval.
      }
    };

    const initialTimer = setTimeout(check, INITIAL_DELAY_MS);
    const interval = setInterval(check, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, []);
}
