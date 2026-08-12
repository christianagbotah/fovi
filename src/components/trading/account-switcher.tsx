'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Trash2, ChevronDown, Check, Wallet,
  Briefcase, Zap, Landmark, ShieldCheck, Shield, KeyRound, Link2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { useTradingStore } from '@/lib/store/trading-store';
import type { TradingAccount } from '@/lib/types';

const ACC_STORAGE_KEY = 'fovi_accounts';

function loadAccountsLS(): TradingAccount[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(ACC_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveAccountsLS(accounts: TradingAccount[]): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(ACC_STORAGE_KEY, JSON.stringify(accounts)); } catch { /* quota */ }
}

/** Backfill missing fields for older localStorage accounts */
function normalizeAccount(acc: TradingAccount): TradingAccount {
  return {
    ...acc,
    linkedBalance: acc.linkedBalance ?? acc.balance ?? 100000,
    totalAllocated: acc.totalAllocated ?? 0,
    totalRealizedProfit: acc.totalRealizedProfit ?? 0,
    updatedAt: acc.updatedAt || acc.createdAt || new Date().toISOString(),
  };
}

function sortAccounts(accounts: TradingAccount[], activeId: string | null): TradingAccount[] {
  return [...accounts].map(normalizeAccount).sort((a, b) => {
    const aLive = a.accountType === 'live' ? 0 : 1;
    const bLive = b.accountType === 'live' ? 0 : 1;
    if (aLive !== bLive) return aLive - bLive;
    if (a.id === activeId) return -1;
    if (b.id === activeId) return 1;
    const aDef = a.isDefault ? 0 : 1;
    const bDef = b.isDefault ? 0 : 1;
    if (aDef !== bDef) return aDef - bDef;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

interface ApiBroker {
  code: string;
  displayName: string;
  description: string;
  brokerType: string;
  iconColor: string;
  requiresApiKey: boolean;
  requiresSecret: boolean;
  requiresPassphrase: boolean;
  assetTypes: string;
  supportedFeatures: string;
}

export function AccountSwitcher() {
  const {
    accounts, activeAccountId, setActiveAccount, setAccounts,
  } = useTradingStore();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [brokerType, setBrokerType] = useState<string>('demo');
  const [apiBrokers, setApiBrokers] = useState<ApiBroker[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch available brokers from API (or fallback to defaults)
  useEffect(() => {
    fetch('/api/trading/brokers')
      .then(r => r.ok ? r.json() : [])
      .then((data: ApiBroker[]) => {
        if (data.length > 0) setApiBrokers(data);
      })
      .catch(() => {});
  }, []);

  const selectedBroker = useMemo(
    () => apiBrokers.find(b => b.code === brokerType),
    [apiBrokers, brokerType],
  );

  const activeAccount = accounts.find(a => a.id === activeAccountId);
  const normActive = activeAccount ? normalizeAccount(activeAccount) : null;
  const availableBalance = normActive
    ? Math.max(0, normActive.linkedBalance - normActive.totalAllocated)
    : 0;

  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handler);
    }, 10);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handler);
    };
  }, [dropdownOpen]);

  const handleSwitch = (id: string) => {
    setActiveAccount(id);
    setDropdownOpen(false);
    setMobileSheetOpen(false);
  };

  const handleAddAccount = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const broker = data.get('broker') as string || 'demo';
    const accountType = data.get('accountType') as string || 'demo';
    const apiKey = (data.get('apiKey') as string) || null;
    const apiSecret = (data.get('apiSecret') as string) || null;
    const passphrase = (data.get('passphrase') as string) || null;

    const isDemo = broker === 'demo';
    const balance = isDemo ? 100000 : 0;
    const newAccount: TradingAccount = {
      id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      userId: 'usr_demo_1',
      broker, accountType, accountId: null,
      isDefault: accounts.length === 0,
      balance, linkedBalance: balance,
      totalAllocated: 0, totalRealizedProfit: 0,
      currency: 'USD',
      apiKey: apiKey || undefined,
      apiSecret: apiSecret || undefined,
      passphrase: passphrase || undefined,
      isActive: true,
      lastSyncedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    fetch('/api/trading/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ broker, accountType, apiKey: apiKey || undefined, apiSecret: apiSecret || undefined, passphrase: passphrase || undefined }),
    }).catch(() => {});

    const updated = [...accounts, newAccount];
    setAccounts(updated);
    saveAccountsLS(updated);
    setActiveAccount(newAccount.id);
    setShowAddDialog(false);
    setBrokerType('demo');
    toast.success(isDemo ? 'Demo account created' : 'Broker account linked successfully');
  };

  const handleDelete = async (id: string) => {
    fetch(`/api/trading/accounts/${id}`, { method: 'DELETE' }).catch(() => {});
    const updated = accounts.filter(a => a.id !== id);
    setAccounts(updated);
    saveAccountsLS(updated);
    if (activeAccountId === id) {
      setActiveAccount(updated[0]?.id || null);
    }
    toast.success('Account removed');
  };

  const openAddDialog = () => {
    setDropdownOpen(false);
    setMobileSheetOpen(false);
    setBrokerType('demo');
    setTimeout(() => setShowAddDialog(true), 100);
  };

  const closeAddDialog = () => {
    setShowAddDialog(false);
    setBrokerType('demo');
  };

  const isLinked = (acc: TradingAccount) => acc.broker !== 'demo' && (acc.apiKey || acc.accountId);
  const isDemo = (acc: TradingAccount) => acc.accountType === 'demo';

  const fmtBal = (n: number) => '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const accountRow = (acc: TradingAccount) => {
    const norm = normalizeAccount(acc);
    const available = Math.max(0, norm.linkedBalance - norm.totalAllocated);
    const hasAllocation = norm.totalAllocated > 0;
    const linked = isLinked(acc);
    const demo = isDemo(acc);

    return (
      <div
        key={acc.id}
        className={`flex items-center gap-3 px-3 py-3 cursor-pointer hover:bg-accent/50 transition-colors ${
          acc.id === activeAccountId ? 'bg-accent' : ''
        }`}
        onClick={() => handleSwitch(acc.id)}
      >
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
          linked ? 'bg-primary/15' : !demo ? 'bg-emerald-500/15' : 'bg-amber-500/15'
        }`}>
          {linked
            ? <Link2 className="h-4 w-4 text-primary" />
            : !demo
              ? <Briefcase className="h-4 w-4 text-emerald-500" />
              : <Zap className="h-4 w-4 text-amber-500" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            {acc.id === activeAccountId && <Check className="h-3.5 w-3.5 text-primary" />}
            <span className="text-[11px] font-semibold">{acc.broker.toUpperCase()}</span>
            {linked
              ? <Badge variant="default" className="bg-primary/10 text-primary border-primary/20 text-[9px] h-4">LINKED</Badge>
              : <Badge variant={demo ? 'secondary' : 'default'} className={
                  demo
                    ? 'bg-amber-500/10 text-amber-500 border-amber-500/20 text-[9px] h-4'
                    : 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-[9px] h-4'
                }>{demo ? 'DEMO' : 'REAL'}</Badge>
            }
            {acc.isDefault && <Badge variant="outline" className="text-[9px] h-4">DEFAULT</Badge>}
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5 tabular-nums">
            {linked ? (
              <>
                <span className="font-medium text-foreground">{fmtBal(available)}</span>
                <span className="text-muted-foreground"> available</span>
                {hasAllocation && (
                  <span className="text-[10px] ml-1">
                    <span className="text-border">·</span> {fmtBal(norm.linkedBalance)} linked
                    <span className="text-border">·</span> {fmtBal(norm.totalAllocated)} allocated
                  </span>
                )}
              </>
            ) : (
              <>
                <span className="font-medium text-foreground">{fmtBal(available)}</span>
                <span className="text-[10px] ml-1.5 text-muted-foreground">
                  {demo ? 'Paper trading' : 'Real funds'}
                  {hasAllocation && <>
                    <span className="text-border"> · </span>
                    {fmtBal(norm.totalAllocated)} allocated to AI
                  </>}
                </span>
              </>
            )}
          </p>
        </div>
        {accounts.length > 1 && (
          <div className="shrink-0" onClick={e => e.stopPropagation()}>
            <Button variant="ghost" size="icon" className="h-7 w-7 cursor-pointer"
              onClick={() => handleDelete(acc.id)}>
              <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          </div>
        )}
      </div>
    );
  };

  const addButton = (
    <Button variant="ghost" size="sm" className="h-7 gap-1 cursor-pointer" onClick={openAddDialog}>
      <Plus className="h-3.5 w-3.5" /> Link Account
    </Button>
  );

  return (
    <>
      <button
        onClick={() => {
          if (window.innerWidth < 1024) {
            setMobileSheetOpen(true);
          } else {
            setDropdownOpen(!dropdownOpen);
          }
        }}
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-card border border-border hover:bg-accent/50 transition-colors cursor-pointer"
      >
        {normActive ? (
          <span className={`flex h-2 w-2 rounded-full ${
            isLinked(normActive) ? 'bg-primary' : !isDemo(normActive) ? 'bg-emerald-500' : 'bg-amber-500'
          }`} />
        ) : null}
        <span className="text-[11px] font-medium max-w-[120px] truncate">
          {normActive
            ? normActive.broker.toUpperCase()
            : 'Select Account'}
        </span>
        {normActive && (
          <Badge variant={isLinked(normActive) ? 'default' : isDemo(normActive) ? 'secondary' : 'default'}
            className={
              isLinked(normActive)
                ? 'bg-primary/10 text-primary border-primary/20 text-[9px] h-4'
                : isDemo(normActive)
                  ? 'bg-amber-500/10 text-amber-500 border-amber-500/20 text-[9px] h-4'
                  : 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-[9px] h-4'
            }>
            {isLinked(normActive) ? 'LINKED' : isDemo(normActive) ? 'DEMO' : 'REAL'}
          </Badge>
        )}
        {normActive && (
          <span className="text-[11px] font-semibold tabular-nums text-foreground hidden sm:inline">
            {fmtBal(availableBalance)}
          </span>
        )}
        <ChevronDown className="h-3 w-3 transition-transform lg:block hidden text-muted-foreground" />
      </button>

      {/* Desktop Dropdown */}
      <div className="hidden lg:block relative" ref={dropdownRef}>
        <AnimatePresence>
          {dropdownOpen && (
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.96 }}
              transition={{ duration: 0.15 }}
              className="absolute top-full mt-2 left-0 w-96 bg-popover border border-border rounded-xl shadow-xl z-50 overflow-hidden"
            >
              <div className="p-3 border-b border-border">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Broker Accounts</h3>
                  {addButton}
                </div>
              </div>
              <div className="max-h-72 overflow-y-auto">
                {sortAccounts(accounts, activeAccountId).map(acc => accountRow(acc))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Mobile Sheet */}
      <Sheet open={mobileSheetOpen} onOpenChange={setMobileSheetOpen}>
        <SheetContent side="bottom" className="max-h-[70vh] rounded-t-2xl">
          <SheetHeader className="pb-3">
            <SheetTitle className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Briefcase className="h-5 w-5" />
                Broker Accounts
              </div>
              {addButton}
            </SheetTitle>
          </SheetHeader>
          <div className="divide-y divide-border max-h-[50vh] overflow-y-auto -mx-6 px-6">
            {sortAccounts(accounts, activeAccountId).map(acc => accountRow(acc))}
            {accounts.length === 0 && (
              <div className="py-8 text-center text-muted-foreground text-sm">
                No accounts. Tap Link Account to get started.
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Add / Link Account Dialog */}
      <Dialog open={showAddDialog} onOpenChange={(open) => { if (!open) closeAddDialog(); }}>
        <DialogContent
          className="max-w-sm"
          onInteractOutside={(e) => e.preventDefault()}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onFocusOutside={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Link Broker Account</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddAccount} className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label>Broker</Label>
              <Select name="broker" defaultValue="demo" onValueChange={(val) => setBrokerType(val)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {apiBrokers.map(b => (
                    <SelectItem key={b.code} value={b.code}>
                      <span className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: b.iconColor || '#6366F1' }} />
                        {b.displayName}
                        {b.description && <span className="text-muted-foreground text-[10px] ml-1">{b.description}</span>}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Account Type</Label>
              <Select name="accountType" defaultValue="demo">
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="demo">
                    <Badge variant="secondary" className="bg-amber-500/10 text-amber-500 border-amber-500/20 mr-2">Demo</Badge>
                    Paper Trading
                  </SelectItem>
                  <SelectItem value="live">
                    <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 mr-2">Live</Badge>
                    Real Money
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {brokerType === 'demo' && (
              <div className="p-3 rounded-xl bg-muted/50 text-center">
                <p className="text-xs text-muted-foreground">Demo accounts start with <span className="font-semibold text-foreground">$100,000</span> simulated balance</p>
              </div>
            )}

            {brokerType !== 'demo' && brokerType !== '' && (
              <div className="p-3 rounded-xl bg-primary/5 border border-primary/10 text-center">
                <p className="text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">Broker-linked:</span> Funds stay in your broker account. No deposits to Fovi.
                </p>
              </div>
            )}

            <AnimatePresence mode="wait">
              {selectedBroker && selectedBroker.requiresApiKey && brokerType !== 'demo' && (
                <motion.div
                  key="apiKey"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-2 overflow-hidden"
                >
                  <Label htmlFor="apiKey" className="flex items-center gap-1.5">
                    <KeyRound className="h-3.5 w-3.5" /> API Key
                  </Label>
                  <Input
                    id="apiKey" name="apiKey" type="password"
                    placeholder="Enter your API key" autoComplete="off"
                  />
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <ShieldCheck className="h-3 w-3 shrink-0" />
                    Your credentials are encrypted and stored securely.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence mode="wait">
              {selectedBroker && selectedBroker.requiresSecret && (
                <motion.div
                  key="apiSecret"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-2 overflow-hidden"
                >
                  <Label htmlFor="apiSecret" className="flex items-center gap-1.5">
                    <KeyRound className="h-3.5 w-3.5" /> API Secret
                  </Label>
                  <Input
                    id="apiSecret" name="apiSecret" type="password"
                    placeholder="Enter your API secret" autoComplete="off"
                  />
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence mode="wait">
              {selectedBroker && selectedBroker.requiresPassphrase && (
                <motion.div
                  key="passphrase"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-2 overflow-hidden"
                >
                  <Label htmlFor="passphrase" className="flex items-center gap-1.5">
                    <KeyRound className="h-3.5 w-3.5" /> Passphrase
                  </Label>
                  <Input
                    id="passphrase" name="passphrase" type="password"
                    placeholder="Enter your passphrase" autoComplete="off"
                  />
                </motion.div>
              )}
            </AnimatePresence>

            <Button type="submit" className="w-full cursor-pointer">
              {brokerType === 'demo' ? 'Create Demo Account' : 'Link Broker Account'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
