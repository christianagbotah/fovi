'use client';

import { Briefcase, Zap, Link2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { TradingAccount } from '@/lib/types';

export function SettingsAccountRow({ acc }: { acc: TradingAccount }) {
  const linked = acc.broker !== 'demo' && (acc.apiKey || acc.accountId);
  const bal = (acc as any).linkedBalance ?? acc.balance ?? 0;
  const alloc = (acc as any).totalAllocated ?? 0;
  const avail = Math.max(0, bal - alloc);
  const isLive = acc.accountType === 'live';

  const bgColor = linked ? 'bg-primary/15' : isLive ? 'bg-emerald-500/15' : 'bg-amber-500/15';
  const badgeMode = linked ? 'LINKED' : isLive ? 'REAL' : 'DEMO';
  const badgeCls = linked
    ? 'bg-primary/10 text-primary border-primary/20 text-[9px] h-4'
    : isLive
      ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-[9px] h-4'
      : 'bg-amber-500/10 text-amber-500 border-amber-500/20 text-[9px] h-4';

  return (
    <div className="flex items-center gap-3 p-3.5 rounded-xl bg-muted/50 border border-border/50">
      <div className={bgColor + ' w-9 h-9 rounded-lg flex items-center justify-center shrink-0'}>
        {linked && <Link2 className="h-4 w-4 text-primary" />}
        {!linked && isLive && <Briefcase className="h-4 w-4 text-emerald-500" />}
        {!linked && !isLive && <Zap className="h-4 w-4 text-amber-500" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold">{acc.broker.toUpperCase()}</span>
          <Badge variant={linked ? 'default' : 'secondary'} className={badgeCls}>{badgeMode}</Badge>
          {acc.isDefault && <Badge variant="outline" className="text-[9px] h-4">DEFAULT</Badge>}
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-xs">
          <span className="font-semibold tabular-nums">
            ${avail.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </span>
          <span className="text-muted-foreground">available</span>
          {alloc > 0 && <span className="text-[10px] text-muted-foreground">· ${alloc.toLocaleString()} allocated</span>}
        </div>
      </div>
    </div>
  );
}
