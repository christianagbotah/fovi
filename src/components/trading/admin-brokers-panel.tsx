'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Plus, Trash2, Edit3, Check, X, Loader2, Radio, RefreshCw,
  ChevronDown, ChevronUp, Copy, Zap, Globe, KeyRound, Braces,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';

// ----------------------------------------------------------
// Types
// ----------------------------------------------------------

interface BrokerProvider {
  id: string;
  code: string;
  displayName: string;
  description: string;
  brokerType: string;
  iconColor: string;
  isActive: boolean;
  requiresApiKey: boolean;
  requiresSecret: boolean;
  requiresPassphrase: boolean;
  liveBaseUrl: string;
  testnetBaseUrl: string;
  authType: string;
  apiKeyHeader: string;
  symbolFormat: string;
  customEndpoints: string;
  assetTypes: string;
  supportedFeatures: string;
  sortOrder: number;
}

interface EndpointConfig {
  account?: string;
  positions?: string;
  placeOrder?: string;
  candles?: string;
  price?: string;
  cancelOrder?: string;
  responsePaths?: {
    account?: Record<string, string>;
    positions?: Record<string, string>;
    price?: Record<string, string>;
    candles?: Record<string, string>;
    placeOrder?: Record<string, string>;
  };
}

// ----------------------------------------------------------
// Constants
// ----------------------------------------------------------

const BROKER_TYPE_LABELS: Record<string, string> = {
  crypto: 'Crypto', stocks: 'Stocks', forex: 'Forex / CFD',
  cfd: 'CFD', demo: 'Simulated',
};

const BROKER_TYPE_COLORS: Record<string, string> = {
  crypto: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
  stocks: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  forex: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
  cfd: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
  demo: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
};

const AUTH_TYPE_OPTIONS: { value: string; label: string; desc: string }[] = [
  { value: 'none', label: 'None', desc: 'No authentication' },
  { value: 'api_key_header', label: 'API Key (Header)', desc: 'Pass API key in a custom header' },
  { value: 'api_key_query', label: 'API Key (Query)', desc: 'Pass API key as query parameter' },
  { value: 'bearer', label: 'Bearer Token', desc: 'Authorization: Bearer <token>' },
  { value: 'hmac_sha256', label: 'HMAC-SHA256 (hex)', desc: 'Binance, Bybit style signing' },
  { value: 'hmac_sha256_base64', label: 'HMAC-SHA256 (base64)', desc: 'OKX, Bitget style signing' },
];

const SYMBOL_FORMAT_OPTIONS: { value: string; label: string; example: string }[] = [
  { value: 'pair', label: 'Pair', example: 'BTCUSDT' },
  { value: 'slash', label: 'Slash', example: 'BTC/USDT' },
  { value: 'dash', label: 'Dash', example: 'BTC-USDT' },
  { value: 'dot', label: 'Dot', example: 'BTC.USDT' },
  { value: 'underscore', label: 'Underscore', example: 'BTC_USDT' },
];

const ASSET_TYPE_OPTIONS = ['stock', 'crypto', 'forex', 'commodity', 'index', 'cfd'];
const FEATURE_OPTIONS = ['spot', 'futures', 'options'];

const BUILTIN_CODES = new Set(['demo', 'alpaca', 'binance', 'okx', 'bybit', 'bitget', 'mt5']);

const EMPTY_FORM = {
  code: '',
  displayName: '',
  description: '',
  brokerType: 'crypto',
  iconColor: '#6366F1',
  requiresApiKey: true,
  requiresSecret: true,
  requiresPassphrase: false,
  liveBaseUrl: '',
  testnetBaseUrl: '',
  authType: 'api_key_header',
  apiKeyHeader: '',
  symbolFormat: 'pair',
  assetTypes: ['crypto'],
  supportedFeatures: ['spot'],
  sortOrder: 99,
  customEndpoints: '' as string,
  showAdvanced: false,
};

// ----------------------------------------------------------
// Endpoint templates for common exchange patterns
// ----------------------------------------------------------

const ENDPOINT_TEMPLATES: Record<string, { label: string; endpoints: EndpointConfig }> = {
  binance: {
    label: 'Binance-style',
    endpoints: {
      account: '/api/v3/account',
      positions: '/api/v3/positionRisk',
      placeOrder: '/api/v3/order',
      candles: '/api/v3/klines',
      price: '/api/v3/ticker/price',
      cancelOrder: '/api/v3/order',
      responsePaths: {
        account: { balance: 'totalWalletBalance', buyingPower: 'availableBalance' },
        positions: { symbol: 'symbol', qty: 'positionAmt', avgEntryPrice: 'entryPrice', currentPrice: 'markPrice', unrealizedPnl: 'unPnl' },
        price: { value: 'price' },
        candles: { timestamp: '0', open: '1', high: '2', low: '3', close: '4', volume: '5' },
        placeOrder: { orderId: 'orderId', filledQty: 'filled', status: 'status' },
      },
    },
  },
  okx: {
    label: 'OKX-style',
    endpoints: {
      account: '/api/v5/account/balance',
      positions: '/api/v5/account/positions',
      placeOrder: '/api/v5/trade/order',
      candles: '/api/v5/market/candles',
      price: '/api/v5/market/ticker',
      cancelOrder: '/api/v5/trade/cancel-order',
      responsePaths: {
        account: { balance: 'data.0.totalEq', buyingPower: 'data.0.free' },
        positions: { list: 'data', symbol: 'instId', qty: 'pos', avgEntryPrice: 'avgPx', unrealizedPnl: 'upl' },
        price: { value: 'data.0.last' },
        candles: { list: 'data', timestamp: '0', open: '1', high: '2', low: '3', close: '4', volume: '5' },
        placeOrder: { orderId: 'data.0.ordId', filledQty: 'data.0.fillSz', status: 'data.0.state' },
      },
    },
  },
};

// ============================================================
// Component
// ============================================================

export function AdminBrokersPanel() {
  const [brokers, setBrokers] = useState<BrokerProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const loadBrokers = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/brokers');
      if (res.ok) setBrokers(await res.json());
    } catch { /* */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadBrokers(); }, [loadBrokers]);

  const handleSeed = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/brokers/seed', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        toast.success(`Seeded: ${data.created} new, ${data.updated || data.skipped} existing`);
        loadBrokers();
      } else {
        toast.error(data.error || 'Seed failed');
      }
    } catch { toast.error('Seed failed'); }
    finally { setSaving(false); }
  };

  const handleSubmit = async () => {
    if (!form.code || !form.displayName) {
      toast.error('Code and Display Name are required');
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, any> = { ...form };
      // Parse customEndpoints JSON if it's a valid JSON string
      if (form.customEndpoints) {
        try {
          payload.customEndpoints = JSON.parse(form.customEndpoints);
        } catch {
          toast.error('Invalid JSON in Endpoints Configuration');
          setSaving(false);
          return;
        }
      } else {
        payload.customEndpoints = {};
      }
      delete payload.showAdvanced;

      const url = editingId
        ? `/api/admin/brokers/${editingId}`
        : '/api/admin/brokers';
      const res = await fetch(url, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(editingId ? 'Broker updated' : 'Broker added');
        setShowForm(false);
        setEditingId(null);
        setForm({ ...EMPTY_FORM });
        loadBrokers();
      } else {
        toast.error(data.error || 'Failed');
      }
    } catch { toast.error('Request failed'); }
    finally { setSaving(false); }
  };

  const handleToggle = async (broker: BrokerProvider) => {
    try {
      const res = await fetch(`/api/admin/brokers/${broker.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !broker.isActive }),
      });
      if (res.ok) {
        setBrokers(prev => prev.map(b => b.id === broker.id ? { ...b, isActive: !b.isActive } : b));
      }
    } catch { toast.error('Toggle failed'); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this broker? Users won\'t be able to select it.')) return;
    try {
      const res = await fetch(`/api/admin/brokers/${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('Broker deleted');
        loadBrokers();
      }
    } catch { toast.error('Delete failed'); }
  };

  const handleDuplicate = async (broker: BrokerProvider) => {
    setSaving(true);
    try {
      const payload: Record<string, any> = {
        code: broker.code + '-copy',
        displayName: broker.displayName + ' (Copy)',
        description: broker.description,
        brokerType: broker.brokerType,
        iconColor: broker.iconColor,
        requiresApiKey: broker.requiresApiKey,
        requiresSecret: broker.requiresSecret,
        requiresPassphrase: broker.requiresPassphrase,
        liveBaseUrl: broker.liveBaseUrl,
        testnetBaseUrl: broker.testnetBaseUrl,
        authType: broker.authType || 'none',
        apiKeyHeader: broker.apiKeyHeader || '',
        symbolFormat: broker.symbolFormat || 'pair',
        assetTypes: JSON.parse(broker.assetTypes || '[]'),
        supportedFeatures: JSON.parse(broker.supportedFeatures || '[]'),
        customEndpoints: broker.customEndpoints || '{}',
        sortOrder: broker.sortOrder + 1,
      };
      const res = await fetch('/api/admin/brokers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        toast.success('Broker duplicated');
        loadBrokers();
      } else {
        const data = await res.json();
        toast.error(data.error || 'Duplicate failed');
      }
    } catch { toast.error('Duplicate failed'); }
    finally { setSaving(false); }
  };

  const startEdit = (broker: BrokerProvider) => {
    setEditingId(broker.id);
    setForm({
      code: broker.code,
      displayName: broker.displayName,
      description: broker.description,
      brokerType: broker.brokerType,
      iconColor: broker.iconColor,
      requiresApiKey: broker.requiresApiKey,
      requiresSecret: broker.requiresSecret,
      requiresPassphrase: broker.requiresPassphrase,
      liveBaseUrl: broker.liveBaseUrl || '',
      testnetBaseUrl: broker.testnetBaseUrl || '',
      authType: broker.authType || 'none',
      apiKeyHeader: broker.apiKeyHeader || '',
      symbolFormat: broker.symbolFormat || 'pair',
      assetTypes: JSON.parse(broker.assetTypes || '[]'),
      supportedFeatures: JSON.parse(broker.supportedFeatures || '[]'),
      sortOrder: broker.sortOrder,
      customEndpoints: broker.customEndpoints || '{}',
      showAdvanced: false,
    });
    setShowForm(true);
  };

  const toggleAssetType = (t: string) => {
    setForm(f => ({
      ...f,
      assetTypes: f.assetTypes.includes(t)
        ? f.assetTypes.filter(x => x !== t)
        : [...f.assetTypes, t],
    }));
  };

  const toggleFeature = (f: string) => {
    setForm(prev => ({
      ...prev,
      supportedFeatures: prev.supportedFeatures.includes(f)
        ? prev.supportedFeatures.filter(x => x !== f)
        : [...prev.supportedFeatures, f],
    }));
  };

  const applyTemplate = (templateKey: string) => {
    const tmpl = ENDPOINT_TEMPLATES[templateKey];
    if (!tmpl) return;
    setForm(f => ({
      ...f,
      customEndpoints: JSON.stringify(tmpl.endpoints, null, 2),
      showAdvanced: true,
    }));
    toast.success(`Applied ${tmpl.label} endpoint template`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Info banner */}
      <div className="p-3 rounded-lg bg-primary/5 border border-primary/10">
        <p className="text-[11px] text-foreground font-medium">
          Broker Management — Add, edit, or remove broker providers.
        </p>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          Built-in brokers work out of the box. Custom brokers use a configurable REST API connector — no code needed.
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" className="gap-1.5 text-xs cursor-pointer" onClick={() => { setShowForm(!showForm); setEditingId(null); setForm({ ...EMPTY_FORM }); }}>
          <Plus className="h-3.5 w-3.5" /> Add Broker
        </Button>
        <Button variant="outline" size="sm" className="gap-1.5 text-xs cursor-pointer" onClick={handleSeed} disabled={saving}>
          <RefreshCw className={`h-3.5 w-3.5 ${saving ? 'animate-spin' : ''}`} /> Seed Defaults
        </Button>
        <span className="text-[10px] text-muted-foreground ml-auto">
          {brokers.filter(b => b.isActive).length} active / {brokers.length} total
        </span>
      </div>

      {/* Add / Edit Form */}
      {showForm && (
        <div className="p-4 rounded-xl border border-border/50 bg-card space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold">
              {editingId ? 'Edit Broker' : 'New Broker'}
            </h4>
            <button onClick={() => { setShowForm(false); setEditingId(null); }} className="cursor-pointer">
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>

          {/* --- Basic Info --- */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-[10px]">Code <span className="text-red-400">*</span></Label>
              <Input
                className="h-8 text-xs font-mono" placeholder="e.g. kucoin"
                value={form.code}
                onChange={e => setForm(f => ({ ...f, code: e.target.value.replace(/[^a-z0-9]/gi, '').toLowerCase() }))}
                disabled={!!editingId}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px]">Display Name <span className="text-red-400">*</span></Label>
              <Input
                className="h-8 text-xs" placeholder="e.g. KuCoin"
                value={form.displayName}
                onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-[10px]">Description</Label>
            <Input
              className="h-8 text-xs" placeholder="Brief description..."
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-[10px]">Type</Label>
              <select
                className="w-full h-8 px-2 rounded-md bg-muted text-xs outline-none"
                value={form.brokerType}
                onChange={e => setForm(f => ({ ...f, brokerType: e.target.value }))}
              >
                {Object.entries(BROKER_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px]">Icon Color</Label>
              <div className="flex gap-1.5">
                <input
                  type="color" value={form.iconColor}
                  onChange={e => setForm(f => ({ ...f, iconColor: e.target.value }))}
                  className="w-8 h-8 rounded cursor-pointer border-0 p-0"
                />
                <Input
                  className="h-8 text-xs flex-1 font-mono" value={form.iconColor}
                  onChange={e => setForm(f => ({ ...f, iconColor: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px]">Sort Order</Label>
              <Input
                className="h-8 text-xs" type="number" value={form.sortOrder}
                onChange={e => setForm(f => ({ ...f, sortOrder: parseInt(e.target.value) || 0 }))}
              />
            </div>
          </div>

          {/* --- Auth Fields --- */}
          <div className="flex gap-4">
            <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
              <input type="checkbox" checked={form.requiresApiKey} onChange={e => setForm(f => ({ ...f, requiresApiKey: e.target.checked }))} className="rounded" />
              API Key
            </label>
            <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
              <input type="checkbox" checked={form.requiresSecret} onChange={e => setForm(f => ({ ...f, requiresSecret: e.target.checked }))} className="rounded" />
              Secret
            </label>
            <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
              <input type="checkbox" checked={form.requiresPassphrase} onChange={e => setForm(f => ({ ...f, requiresPassphrase: e.target.checked }))} className="rounded" />
              Passphrase
            </label>
          </div>

          {/* --- Asset Types & Features --- */}
          <div className="space-y-1.5">
            <Label className="text-[10px]">Asset Types</Label>
            <div className="flex flex-wrap gap-1.5">
              {ASSET_TYPE_OPTIONS.map(t => (
                <button key={t} onClick={() => toggleAssetType(t)}
                  className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer ${
                    form.assetTypes.includes(t)
                      ? 'bg-primary/15 text-primary border border-primary/30'
                      : 'bg-muted text-muted-foreground border border-transparent'
                  }`}>
                  {t.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[10px]">Supported Features</Label>
            <div className="flex flex-wrap gap-1.5">
              {FEATURE_OPTIONS.map(f => (
                <button key={f} onClick={() => toggleFeature(f)}
                  className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer ${
                    form.supportedFeatures.includes(f)
                      ? 'bg-primary/15 text-primary border border-primary/30'
                      : 'bg-muted text-muted-foreground border border-transparent'
                  }`}>
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* --- Advanced: REST API Config --- */}
          {!BUILTIN_CODES.has(form.code) && (
            <div className="border-t border-border/50 pt-3 space-y-3">
              <button
                type="button"
                className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground cursor-pointer w-full"
                onClick={() => setForm(f => ({ ...f, showAdvanced: !f.showAdvanced }))}
              >
                <Globe className="h-3.5 w-3.5" />
                REST API Configuration
                {form.showAdvanced
                  ? <ChevronUp className="h-3 w-3 ml-auto" />
                  : <ChevronDown className="h-3 w-3 ml-auto" />
                }
              </button>

              {form.showAdvanced && (
                <div className="space-y-3 pl-1">
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    Configure how Fovi connects to this broker&apos;s REST API.
                    Users who link this broker will use these settings to trade.
                  </p>

                  {/* Base URLs */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-[10px] flex items-center gap-1">
                        <Globe className="h-3 w-3" /> Live Base URL
                      </Label>
                      <Input
                        className="h-8 text-xs font-mono" placeholder="https://api.exchange.com"
                        value={form.liveBaseUrl}
                        onChange={e => setForm(f => ({ ...f, liveBaseUrl: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] flex items-center gap-1">
                        <Globe className="h-3 w-3" /> Testnet URL
                        <span className="text-muted-foreground font-normal">(optional)</span>
                      </Label>
                      <Input
                        className="h-8 text-xs font-mono" placeholder="https://testnet.exchange.com"
                        value={form.testnetBaseUrl}
                        onChange={e => setForm(f => ({ ...f, testnetBaseUrl: e.target.value }))}
                      />
                    </div>
                  </div>

                  {/* Auth Type */}
                  <div className="space-y-1.5">
                    <Label className="text-[10px] flex items-center gap-1">
                      <KeyRound className="h-3 w-3" /> Auth Type
                    </Label>
                    <select
                      className="w-full h-8 px-2 rounded-md bg-muted text-xs outline-none"
                      value={form.authType}
                      onChange={e => setForm(f => ({ ...f, authType: e.target.value }))}
                    >
                      {AUTH_TYPE_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label} — {opt.desc}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* API Key Header */}
                  {(form.authType === 'api_key_header' || form.authType === 'hmac_sha256' || form.authType === 'hmac_sha256_base64') && (
                    <div className="space-y-1">
                      <Label className="text-[10px]">API Key Header Name</Label>
                      <Input
                        className="h-8 text-xs font-mono" placeholder="e.g. X-MBX-APIKEY"
                        value={form.apiKeyHeader}
                        onChange={e => setForm(f => ({ ...f, apiKeyHeader: e.target.value }))}
                      />
                    </div>
                  )}

                  {/* Symbol Format */}
                  <div className="space-y-1.5">
                    <Label className="text-[10px]">Symbol Format</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {SYMBOL_FORMAT_OPTIONS.map(opt => (
                        <button key={opt.value} onClick={() => setForm(f => ({ ...f, symbolFormat: opt.value }))}
                          className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer ${
                            form.symbolFormat === opt.value
                              ? 'bg-primary/15 text-primary border border-primary/30'
                              : 'bg-muted text-muted-foreground border border-transparent'
                          }`}>
                          {opt.label} <span className="font-normal opacity-70">{opt.example}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Endpoint Templates */}
                  <div className="space-y-1.5">
                    <Label className="text-[10px] flex items-center gap-1">
                      <Zap className="h-3 w-3" /> Quick Templates
                    </Label>
                    <div className="flex gap-1.5">
                      {Object.entries(ENDPOINT_TEMPLATES).map(([key, tmpl]) => (
                        <button key={key} onClick={() => applyTemplate(key)}
                          className="px-2 py-0.5 rounded text-[10px] font-medium bg-muted hover:bg-accent transition-colors cursor-pointer border border-transparent hover:border-border">
                          {tmpl.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Custom Endpoints JSON */}
                  <div className="space-y-1.5">
                    <Label className="text-[10px] flex items-center gap-1">
                      <Braces className="h-3 w-3" /> Endpoints Configuration (JSON)
                    </Label>
                    <textarea
                      className="w-full h-32 px-3 py-2 rounded-lg bg-muted text-[10px] font-mono outline-none resize-y"
                      placeholder={`{
  "account": "/api/v1/account",
  "positions": "/api/v1/positions",
  "placeOrder": "/api/v1/orders",
  "candles": "/api/v1/klines",
  "price": "/api/v1/ticker/price",
  "cancelOrder": "/api/v1/orders",
  "responsePaths": {
    "account": { "balance": "balance" },
    "positions": { "symbol": "symbol", "qty": "amount" },
    "price": { "value": "price" }
  }
}`}
                      value={form.customEndpoints}
                      onChange={e => setForm(f => ({ ...f, customEndpoints: e.target.value }))}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          <Button className="w-full text-xs cursor-pointer" onClick={handleSubmit} disabled={saving}>
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : editingId ? 'Save Changes' : 'Add Broker'}
          </Button>
        </div>
      )}

      {/* Broker List */}
      <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-0.5">
        {brokers.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-xs">
            No brokers configured. Click &ldquo;Seed Defaults&rdquo; to add the built-in brokers.
          </div>
        ) : (
          brokers.map(broker => {
            const assets: string[] = JSON.parse(broker.assetTypes || '[]');
            const features: string[] = JSON.parse(broker.supportedFeatures || '[]');
            const isBuiltin = BUILTIN_CODES.has(broker.code);
            const hasRestConfig = !!(broker.liveBaseUrl && broker.authType && broker.authType !== 'none');

            return (
              <div key={broker.id} className={`p-3 rounded-xl border bg-card transition-colors ${
                broker.isActive ? 'border-border/50' : 'border-border/30 opacity-60'
              }`}>
                <div className="flex items-center gap-2.5">
                  {/* Color dot */}
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-white text-[10px] font-bold"
                    style={{ backgroundColor: broker.iconColor || '#6366F1' }}
                  >
                    {broker.displayName.slice(0, 2).toUpperCase()}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-semibold">{broker.displayName}</span>
                      <code className="text-[9px] text-muted-foreground bg-muted px-1 py-0.5 rounded">{broker.code}</code>
                      {isBuiltin && (
                        <Badge className="bg-emerald-500/10 text-emerald-500 border-0 text-[9px] h-4 px-1.5">BUILT-IN</Badge>
                      )}
                      {!isBuiltin && hasRestConfig && (
                        <Badge className="bg-primary/10 text-primary border-0 text-[9px] h-4 px-1.5">REST API</Badge>
                      )}
                      {!isBuiltin && !hasRestConfig && (
                        <Badge className="bg-amber-500/10 text-amber-600 border-0 text-[9px] h-4 px-1.5">NEEDS CONFIG</Badge>
                      )}
                      <Badge className={`${BROKER_TYPE_COLORS[broker.brokerType] || BROKER_TYPE_COLORS.crypto} text-[9px] h-4 px-1.5`}>
                        {BROKER_TYPE_LABELS[broker.brokerType] || broker.brokerType}
                      </Badge>
                    </div>
                    {broker.description && (
                      <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{broker.description}</p>
                    )}
                    <div className="flex flex-wrap gap-1 mt-1">
                      {broker.liveBaseUrl && (
                        <span className="text-[9px] text-muted-foreground font-mono max-w-[200px] truncate">
                          {broker.liveBaseUrl.replace(/^https?:\/\//, '')}
                        </span>
                      )}
                      {assets.length > 0 && (
                        <>
                          <span className="text-[9px] text-border">|</span>
                          {assets.map(a => (
                            <span key={a} className="text-[9px] text-muted-foreground">{a}</span>
                          ))}
                        </>
                      )}
                      {features.length > 0 && (
                        <>
                          <span className="text-[9px] text-border">|</span>
                          {features.map(f => (
                            <span key={f} className="text-[9px] text-muted-foreground">{f}</span>
                          ))}
                        </>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleToggle(broker)}
                      className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors cursor-pointer ${
                        broker.isActive ? 'bg-emerald-500/10' : 'bg-muted'
                      }`}
                      title={broker.isActive ? 'Active — click to disable' : 'Inactive — click to enable'}
                    >
                      <Radio className={`h-3 w-3 ${broker.isActive ? 'text-emerald-500' : 'text-muted-foreground'}`} />
                    </button>
                    <button onClick={() => startEdit(broker)} className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-accent transition-colors cursor-pointer" title="Edit">
                      <Edit3 className="h-3 w-3 text-muted-foreground" />
                    </button>
                    <button onClick={() => handleDuplicate(broker)} className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-accent transition-colors cursor-pointer" title="Duplicate">
                      <Copy className="h-3 w-3 text-muted-foreground" />
                    </button>
                    <button onClick={() => handleDelete(broker.id)} className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-red-500/10 transition-colors cursor-pointer" title="Delete">
                      <Trash2 className="h-3 w-3 text-red-400" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}