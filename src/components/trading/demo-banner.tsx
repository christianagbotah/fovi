'use client';

import { AlertTriangle, X } from 'lucide-react';
import { useTradingStore } from '@/lib/store/trading-store';
import { useState } from 'react';

export function DemoBanner() {
  const demoMode = useTradingStore(s => s.demoMode);
  const [dismissed, setDismissed] = useState(false);

  if (!demoMode || dismissed) return null;

  return (
    <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-amber-400 text-xs">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        <span>
          <strong>Demo Mode</strong> — Showing simulated data. Connect a broker account for live trading.
        </span>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="text-amber-400/60 hover:text-amber-400 transition-colors"
        aria-label="Dismiss demo banner"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
