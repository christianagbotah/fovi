'use client';

import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Webhook,
  Plus,
  Copy,
  Check,
  Trash2,
  Zap,
  Clock,
  Activity,
  Link2,
  ShieldCheck,
  ShieldOff,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// ── Types ───────────────────────────────────────────────
interface WebhookItem {
  id: string;
  name: string;
  url: string;
  secret: string;
  autoExecute: boolean;
  defaultStrategy: string;
  createdAt: string;
}

interface WebhookCall {
  id: string;
  webhookId: string;
  timestamp: string;
  symbol: string;
  action: 'buy' | 'sell' | 'short' | 'cover';
  status: 'success' | 'failed' | 'pending';
}

// ── Strategy options ────────────────────────────────────
const STRATEGIES = [
  { value: 'scalper', label: 'Scalper' },
  { value: 'grid', label: 'Grid Bot' },
  { value: 'dca', label: 'DCA' },
  { value: 'breakout', label: 'Breakout' },
  { value: 'mean_reversion', label: 'Mean Reversion' },
  { value: 'manual', label: 'Manual Review' },
];

// ── Helpers ─────────────────────────────────────────────
function randomId(len = 12): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function fmtRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function actionColor(a: WebhookCall['action']): string {
  switch (a) {
    case 'buy':
    case 'cover':
      return 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30';
    case 'sell':
    case 'short':
      return 'bg-red-500/15 text-red-600 border-red-500/30';
  }
}

function statusColor(s: WebhookCall['status']): string {
  switch (s) {
    case 'success':
      return 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30';
    case 'failed':
      return 'bg-red-500/15 text-red-600 border-red-500/30';
    case 'pending':
      return 'bg-amber-500/15 text-amber-600 border-amber-500/30';
  }
}

// ── Initial mock data ───────────────────────────────────
function buildInitialWebhooks(): WebhookItem[] {
  const now = Date.now();
  return [
    {
      id: 'wh_1a2b3c',
      name: 'TradingView Alerts',
      url: `${typeof window !== 'undefined' ? window.location.origin : 'https://your-app.example'}/api/trading/webhook?token=wh_1a2b3c`,
      secret: 'sk_live_8f2c9a1b',
      autoExecute: true,
      defaultStrategy: 'breakout',
      createdAt: new Date(now - 1000 * 60 * 60 * 26).toISOString(),
    },
    {
      id: 'wh_4d5e6f',
      name: 'Pine Script Bot',
      url: `${typeof window !== 'undefined' ? window.location.origin : 'https://your-app.example'}/api/trading/webhook?token=wh_4d5e6f`,
      secret: 'sk_live_3d7e2c9f',
      autoExecute: false,
      defaultStrategy: 'manual',
      createdAt: new Date(now - 1000 * 60 * 60 * 5).toISOString(),
    },
  ];
}

function buildInitialCalls(): WebhookCall[] {
  const now = Date.now();
  return [
    {
      id: 'c1',
      webhookId: 'wh_1a2b3c',
      timestamp: new Date(now - 1000 * 60 * 2).toISOString(),
      symbol: 'BTC',
      action: 'buy',
      status: 'success',
    },
    {
      id: 'c2',
      webhookId: 'wh_1a2b3c',
      timestamp: new Date(now - 1000 * 60 * 18).toISOString(),
      symbol: 'NVDA',
      action: 'sell',
      status: 'success',
    },
    {
      id: 'c3',
      webhookId: 'wh_4d5e6f',
      timestamp: new Date(now - 1000 * 60 * 47).toISOString(),
      symbol: 'ETH',
      action: 'short',
      status: 'pending',
    },
    {
      id: 'c4',
      webhookId: 'wh_1a2b3c',
      timestamp: new Date(now - 1000 * 60 * 95).toISOString(),
      symbol: 'TSLA',
      action: 'buy',
      status: 'failed',
    },
    {
      id: 'c5',
      webhookId: 'wh_4d5e6f',
      timestamp: new Date(now - 1000 * 60 * 60 * 3).toISOString(),
      symbol: 'AAPL',
      action: 'cover',
      status: 'success',
    },
  ];
}

// ── Copy button ─────────────────────────────────────────
function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback for environments without clipboard API
      setCopied(false);
    }
  }, [text]);

  return (
    <Button
      size="sm"
      variant="outline"
      className="h-7 gap-1.5 shrink-0"
      onClick={handleCopy}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-emerald-500" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
      {label ?? (copied ? 'Copied' : 'Copy')}
    </Button>
  );
}

// ── Webhook card ────────────────────────────────────────
function WebhookCard({
  item,
  calls,
  onDelete,
}: {
  item: WebhookItem;
  calls: WebhookCall[];
  onDelete: (id: string) => void;
}) {
  const callCount = calls.length;
  const successCount = calls.filter((c) => c.status === 'success').length;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -10 }}
      transition={{ duration: 0.2 }}
    >
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Webhook className="h-4 w-4 text-muted-foreground shrink-0" />
                <h4 className="font-semibold text-sm truncate">{item.name}</h4>
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Created {fmtRelative(item.createdAt)} · {callCount} calls ·{' '}
                {successCount} succeeded
              </p>
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
              onClick={() => onDelete(item.id)}
              aria-label="Delete webhook"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>

          {/* URL display */}
          <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-2.5 py-1.5">
            <Link2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <code className="text-[11px] font-mono truncate flex-1 min-w-0">
              {item.url}
            </code>
            <CopyButton text={item.url} />
          </div>

          {/* Badges */}
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className={`text-[10px] h-5 gap-1 ${
                item.autoExecute
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600'
                  : ''
              }`}
            >
              {item.autoExecute ? (
                <ShieldCheck className="h-3 w-3" />
              ) : (
                <ShieldOff className="h-3 w-3" />
              )}
              {item.autoExecute ? 'Auto-Execute' : 'Manual Review'}
            </Badge>
            <Badge variant="secondary" className="text-[10px] h-5">
              {STRATEGIES.find((s) => s.value === item.defaultStrategy)?.label ?? item.defaultStrategy}
            </Badge>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ── Main Component ──────────────────────────────────────
export function WebhookPanel() {
  const [webhooks, setWebhooks] = useState<WebhookItem[]>(buildInitialWebhooks);
  const [calls, setCalls] = useState<WebhookCall[]>(buildInitialCalls);

  // Form state
  const [name, setName] = useState('');
  const [autoExecute, setAutoExecute] = useState(false);
  const [defaultStrategy, setDefaultStrategy] = useState('manual');
  const [lastCreated, setLastCreated] = useState<WebhookItem | null>(null);

  const recentCalls = useMemo(
    () =>
      [...calls]
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 5),
    [calls],
  );

  const handleCreate = useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const id = `wh_${randomId(8)}`;
    const secret = `sk_live_${randomId(10)}`;
    const origin =
      typeof window !== 'undefined' ? window.location.origin : 'https://your-app.example';
    const item: WebhookItem = {
      id,
      name: trimmed,
      url: `${origin}/api/trading/webhook?token=${id}`,
      secret,
      autoExecute,
      defaultStrategy,
      createdAt: new Date().toISOString(),
    };
    setWebhooks((prev) => [item, ...prev]);
    setLastCreated(item);
    setName('');
    setAutoExecute(false);
    setDefaultStrategy('manual');
  }, [name, autoExecute, defaultStrategy]);

  const handleDelete = useCallback((id: string) => {
    setWebhooks((prev) => prev.filter((w) => w.id !== id));
    setCalls((prev) => prev.filter((c) => c.webhookId !== id));
    setLastCreated((prev) => (prev?.id === id ? null : prev));
  }, []);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
        <Webhook className="h-4 w-4" />
        Webhook Manager
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Create form */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold inline-flex items-center gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              Create Webhook
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Name */}
            <div className="space-y-1.5">
              <Label htmlFor="wh-name" className="text-xs">
                Name
              </Label>
              <Input
                id="wh-name"
                placeholder="e.g. TradingView Alerts"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate();
                }}
              />
            </div>

            {/* Default strategy */}
            <div className="space-y-1.5">
              <Label htmlFor="wh-strategy" className="text-xs">
                Default Strategy
              </Label>
              <Select value={defaultStrategy} onValueChange={setDefaultStrategy}>
                <SelectTrigger id="wh-strategy" className="w-full">
                  <SelectValue placeholder="Select a strategy" />
                </SelectTrigger>
                <SelectContent>
                  {STRATEGIES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Auto-execute toggle */}
            <div className="flex items-center justify-between rounded-md border bg-card/50 px-3 py-2.5">
              <div className="min-w-0 pr-3">
                <Label htmlFor="wh-auto" className="text-xs font-medium cursor-pointer">
                  Auto-Execute
                </Label>
                <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">
                  Execute trades automatically on incoming signals
                </p>
              </div>
              <Switch
                id="wh-auto"
                checked={autoExecute}
                onCheckedChange={setAutoExecute}
              />
            </div>

            <Button
              className="w-full gap-1.5"
              onClick={handleCreate}
              disabled={!name.trim()}
            >
              <Plus className="h-4 w-4" />
              Generate Webhook URL
            </Button>

            {/* Generated URL display */}
            <AnimatePresence mode="wait">
              {lastCreated && (
                <motion.div
                  key={lastCreated.id}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="space-y-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3"
                >
                  <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-600">
                    <Check className="h-3.5 w-3.5" />
                    Webhook “{lastCreated.name}” created
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 min-w-0 truncate text-[11px] font-mono bg-background/60 rounded px-2 py-1 border">
                      {lastCreated.url}
                    </code>
                    <CopyButton text={lastCreated.url} />
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Secret: <code className="font-mono">{lastCreated.secret}</code> — keep this private.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </CardContent>
        </Card>

        {/* Recent calls */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold inline-flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5" />
              Recent Webhook Calls
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-80 overflow-y-auto divide-y divide-border">
              {recentCalls.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  No recent calls
                </div>
              ) : (
                recentCalls.map((c) => {
                  const wh = webhooks.find((w) => w.id === c.webhookId);
                  return (
                    <div key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="flex flex-col items-center min-w-0">
                        <span className="text-[11px] font-mono text-muted-foreground tabular-nums">
                          {new Date(c.timestamp).toLocaleTimeString('en-GB', {
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: false,
                          })}
                        </span>
                        <span className="text-[9px] text-muted-foreground/70">
                          {fmtRelative(c.timestamp)}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-semibold">{c.symbol}</span>
                          <span
                            className={`inline-flex items-center rounded-full border px-1.5 py-0 text-[10px] font-medium ${actionColor(c.action)}`}
                          >
                            {c.action.toUpperCase()}
                          </span>
                        </div>
                        <p className="text-[10px] text-muted-foreground truncate">
                          {wh?.name ?? 'Unknown webhook'}
                        </p>
                      </div>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize ${statusColor(c.status)}`}
                      >
                        {c.status === 'success' && <Check className="h-2.5 w-2.5" />}
                        {c.status === 'pending' && <Clock className="h-2.5 w-2.5" />}
                        {c.status === 'failed' && <Zap className="h-2.5 w-2.5" />}
                        {c.status}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Webhook list */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold inline-flex items-center gap-1.5">
            <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
            Active Webhooks ({webhooks.length})
          </h3>
        </div>
        {webhooks.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="p-8 text-center">
              <Webhook className="h-8 w-8 text-muted-foreground/50 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No webhooks yet</p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                Create one above to start receiving signals
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <AnimatePresence mode="popLayout">
              {webhooks.map((w) => (
                <WebhookCard
                  key={w.id}
                  item={w}
                  calls={calls.filter((c) => c.webhookId === w.id)}
                  onDelete={handleDelete}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
