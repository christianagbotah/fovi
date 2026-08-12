'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Plus, Trash2, Edit3, Check, X, Loader2, Radio, RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';

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
  assetTypes: string;
  supportedFeatures: string;
  sortOrder: number;
}

const BROKER_TYPE_LABELS: Record<string, string> = {
  crypto: 'Crypto',
  stocks: 'Stocks',
  forex: 'Forex / CFD',
  demo: 'Simulated',
};

const BROKER_TYPE_COLORS: Record<string, string> = {
  crypto: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
  stocks: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  forex: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
  demo: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
};

const ASSET_TYPE_OPTIONS = ['stock', 'crypto', 'forex', 'commodity', 'index', 'cfd'];
const FEATURE_OPTIONS = ['spot', 'futures', 'options'];

const EMPTY_FORM = {
  code: '',
  displayName: '',
  description: '',
  brokerType: 'crypto',
  iconColor: '#6366F1',
  requiresApiKey: true,
  requiresSecret: true,
  requiresPassphrase: false,
  assetTypes: ['crypto'],
  supportedFeatures: ['spot'],
  sortOrder: 99,
};

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
        toast.success(`Seeded: ${data.created} new, ${data.skipped} existing`);
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
      const url = editingId
        ? `/api/admin/brokers/${editingId}`
        : '/api/admin/brokers';
      const res = await fetch(url, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
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
      assetTypes: JSON.parse(broker.assetTypes || '[]'),
      supportedFeatures: JSON.parse(broker.supportedFeatures || '[]'),
      sortOrder: broker.sortOrder,
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
        <p className="text-[11px] text-amber-600 font-medium">
          Admin Only — Manage broker providers. Users see only active brokers when linking accounts.
          Built-in brokers (with code implementations) work out of the box. Custom brokers fall back to Demo mode.
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <Button size="sm" className="gap-1.5 text-xs cursor-pointer" onClick={() => { setShowForm(!showForm); setEditingId(null); setForm({ ...EMPTY_FORM }); }}>
          <Plus className="h-3.5 w-3.5" /> Add Broker
        </Button>
        <Button variant="outline" size="sm" className="gap-1.5 text-xs cursor-pointer" onClick={handleSeed} disabled={saving}>
          <RefreshCw className={`h-3.5 w-3.5 ${saving ? 'animate-spin' : ''}`} /> Seed Defaults
        </Button>
        <span className="text-[10px] text-muted-foreground ml-auto">{brokers.length} brokers</span>
      </div>

      {/* Add / Edit Form */}
      {showForm && (
        <div className="p-4 rounded-xl border border-border/50 bg-card space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold">{editingId ? 'Edit Broker' : 'New Broker'}</h4>
            <button onClick={() => { setShowForm(false); setEditingId(null); }} className="cursor-pointer">
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-[10px]">Code</Label>
              <Input
                className="h-8 text-xs" placeholder="e.g. kucoin" value={form.code}
                onChange={e => setForm(f => ({ ...f, code: e.target.value.replace(/[^a-z0-9]/gi, '').toLowerCase() }))}
                disabled={!!editingId}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px]">Display Name</Label>
              <Input
                className="h-8 text-xs" placeholder="e.g. KuCoin" value={form.displayName}
                onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-[10px]">Description</Label>
            <Input
              className="h-8 text-xs" placeholder="Brief description..." value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
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
                  className="h-8 text-xs flex-1" value={form.iconColor}
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

          {/* Auth fields */}
          <div className="flex gap-3">
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

          {/* Asset types */}
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

          {/* Features */}
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

          <Button className="w-full text-xs cursor-pointer" onClick={handleSubmit} disabled={saving}>
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : editingId ? 'Save Changes' : 'Add Broker'}
          </Button>
        </div>
      )}

      {/* Broker List */}
      <div className="space-y-2 max-h-[50vh] overflow-y-auto">
        {brokers.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-xs">
            No brokers configured. Click &ldquo;Seed Defaults&rdquo; to add the built-in brokers.
          </div>
        ) : (
          brokers.map(broker => {
            const assets: string[] = JSON.parse(broker.assetTypes || '[]');
            const features: string[] = JSON.parse(broker.supportedFeatures || '[]');
            const hasBuiltinImpl = ['demo','alpaca','binance','okx','bybit','bitget','mt5'].includes(broker.code);

            return (
              <div key={broker.id} className="p-3 rounded-xl border border-border/50 bg-card">
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
                      {hasBuiltinImpl && (
                        <Badge className="bg-emerald-500/10 text-emerald-500 border-0 text-[9px] h-4">BUILT-IN</Badge>
                      )}
                      <Badge className={BROKER_TYPE_COLORS[broker.brokerType] || BROKER_TYPE_COLORS.crypto + ' text-[9px] h-4'}>
                        {BROKER_TYPE_LABELS[broker.brokerType] || broker.brokerType}
                      </Badge>
                    </div>
                    {broker.description && <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{broker.description}</p>}
                    <div className="flex flex-wrap gap-1 mt-1">
                      {assets.map(a => <span key={a} className="text-[9px] text-muted-foreground">{a}</span>)}
                      {assets.length > 0 && <span className="text-[9px] text-border">·</span>}
                      {features.map(f => <span key={f} className="text-[9px] text-muted-foreground">{f}</span>)}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleToggle(broker)}
                      className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors cursor-pointer ${
                        broker.isActive ? 'bg-emerald-500/10' : 'bg-muted'
                      }`}
                    >
                      <Radio className={`h-3 w-3 ${broker.isActive ? 'text-emerald-500' : 'text-muted-foreground'}`} />
                    </button>
                    <button onClick={() => startEdit(broker)} className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-accent transition-colors cursor-pointer">
                      <Edit3 className="h-3 w-3 text-muted-foreground" />
                    </button>
                    <button onClick={() => handleDelete(broker.id)} className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-red-500/10 transition-colors cursor-pointer">
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
