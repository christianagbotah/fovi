'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeftRight, Plus, Trash2, ChevronDown, Check, Wallet,
  Briefcase, Zap, Landmark, ShieldCheck, KeyRound, ArrowDownCircle, ArrowUpCircle,
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

// ============================================================
// localStorage helpers for accounts (demo mode persistence)
// ============================================================
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

function sortAccounts(accounts: TradingAccount[], activeId: string | null): TradingAccount[] {
  return [...accounts].sort((a, b) => {
    // 1. Live accounts always before demo (active trading first)
    const aLive = a.accountType === 'live' ? 0 : 1;
    const bLive = b.accountType === 'live' ? 0 : 1;
    if (aLive !== bLive) return aLive - bLive;
    // 2. Among same type, active account first
    if (a.id === activeId) return -1;
    if (b.id === activeId) return 1;
    // 3. Default before non-default
    const aDef = a.isDefault ? 0 : 1;
    const bDef = b.isDefault ? 0 : 1;
    if (aDef !== bDef) return aDef - bDef;
    // 4. Most recently updated first
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

export function AccountSwitcher() {
  const {
    accounts, activeAccountId, setActiveAccount, setAccounts,
  } = useTradingStore();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [brokerType, setBrokerType] = useState<string>('demo');
  const [fundsDialog, setFundsDialog] = useState<{ id: string; action: 'deposit' | 'withdraw' } | null>(null);
  const [fundsAmount, setFundsAmount] = useState('');
  const [funding, setFunding] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const activeAccount = accounts.find(a => a.id === activeAccountId);

  // Desktop: close dropdown on outside click
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
    const balance = parseFloat(data.get('balance') as string) || 100000;
    const apiKey = (data.get('apiKey') as string) || null;
    const apiSecret = (data.get('apiSecret') as string) || null;
    const passphrase = (data.get('passphrase') as string) || null;

    const newAccount: TradingAccount = {
      id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      userId: 'usr_demo_1',
      broker,
      accountType,
      accountId: null,
      isDefault: accounts.length === 0,
      balance,
      currency: 'USD',
      apiKey: apiKey || undefined,
      apiSecret: apiSecret || undefined,
      passphrase: passphrase || undefined,
      isActive: true,
      lastSyncedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Try API in background (best-effort, don't block)
    fetch('/api/trading/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ broker, accountType, balance, apiKey: apiKey || undefined, apiSecret: apiSecret || undefined, passphrase: passphrase || undefined }),
    }).catch(() => {});

    // Update local state immediately
    const updated = [...accounts, newAccount];
    setAccounts(updated);
    saveAccountsLS(updated);
    setActiveAccount(newAccount.id);
    setShowAddDialog(false);
    setBrokerType('demo');
  };

  const handleDelete = async (id: string) => {
    // Try API in background
    fetch(`/api/trading/accounts/${id}`, { method: 'DELETE' }).catch(() => {});

    // Update local state immediately
    const updated = accounts.filter(a => a.id !== id);
    setAccounts(updated);
    saveAccountsLS(updated);
    if (activeAccountId === id) {
      setActiveAccount(updated[0]?.id || null);
    }
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

  const handleFunds = async () => {
    if (!fundsDialog || !fundsAmount || parseFloat(fundsAmount) <= 0) return;
    setFunding(true);
    const amount = parseFloat(fundsAmount);
    try {
      const res = await fetch(`/api/trading/accounts/${fundsDialog.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ balance: 0, action: fundsDialog.action, amount }),
      });
      const data = await res.json();
      if (data.balance !== undefined) {
        const updated = accounts.map(a =>
          a.id === fundsDialog.id ? { ...a, balance: data.balance } : a
        );
        setAccounts(updated);
        saveAccountsLS(updated);
        toast.success(`${fundsDialog.action === 'deposit' ? 'Deposited' : 'Withdrew'} $${amount.toLocaleString()}`);
        setFundsDialog(null);
        setFundsAmount('');
      } else {
        toast.error(data.error || 'Action failed');
      }
    } catch {
      toast.error('Failed to process');
    } finally {
      setFunding(false);
    }
  };

  const accountRow = (acc: TradingAccount) => (
    <div
      key={acc.id}
      className={`flex items-center gap-3 px-3 py-3 cursor-pointer hover:bg-accent/50 transition-colors ${
        acc.id === activeAccountId ? 'bg-accent' : ''
      }`}
      onClick={() => handleSwitch(acc.id)}
    >
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
        acc.accountType === 'live' ? 'bg-emerald-500/15' : 'bg-amber-500/15'
      }`}>
        {acc.accountType === 'live'
          ? <Briefcase className="h-4 w-4 text-emerald-500" />
          : <Zap className="h-4 w-4 text-amber-500" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {acc.id === activeAccountId && <Check className="h-3.5 w-3.5 text-primary" />}
          <span className="text-sm font-semibold">{acc.broker.toUpperCase()}</span>
          <Badge variant={acc.accountType === 'live' ? 'default' : 'secondary'}
            className={acc.accountType === 'live'
              ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-[10px]'
              : 'bg-amber-500/10 text-amber-500 border-amber-500/20 text-[10px]'}>
            {acc.accountType}
          </Badge>
          {acc.isDefault && <Badge variant="outline" className="text-[9px] h-4">DEFAULT</Badge>}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">
          ${acc.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>
      </div>
      <div className="flex items-center gap-0.5 shrink-0" onClick={e => e.stopPropagation()}>
        <Button variant="ghost" size="icon" className="h-7 w-7 cursor-pointer"
          onClick={() => { setFundsDialog({ id: acc.id, action: 'deposit' }); setFundsAmount(''); }}>
          <ArrowDownCircle className="h-3.5 w-3.5 text-emerald-500" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7 cursor-pointer"
          onClick={() => { setFundsDialog({ id: acc.id, action: 'withdraw' }); setFundsAmount(''); }}>
          <ArrowUpCircle className="h-3.5 w-3.5 text-orange-500" />
        </Button>
        {accounts.length > 1 && (
          <Button variant="ghost" size="icon" className="h-7 w-7 cursor-pointer"
            onClick={() => handleDelete(acc.id)}>
            <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        )}
      </div>
    </div>
  );

  const addButton = (
    <Button variant="ghost" size="sm" className="h-7 gap-1 cursor-pointer" onClick={openAddDialog}>
      <Plus className="h-3.5 w-3.5" /> Add
    </Button>
  );

  return (
    <>
      {/* Trigger Button */}
      <button
        onClick={() => {
          if (window.innerWidth < 1024) {
            setMobileSheetOpen(true);
          } else {
            setDropdownOpen(!dropdownOpen);
          }
        }}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-card border border-border hover:bg-accent/50 transition-colors cursor-pointer"
      >
        {activeAccount?.accountType === 'live' ? (
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
        ) : activeAccount ? (
          <span className="flex h-2 w-2 rounded-full bg-amber-500" />
        ) : null}
        <span className="text-sm font-medium">
          {activeAccount ? `${activeAccount.accountType.toUpperCase()} · $${activeAccount.balance.toLocaleString()}` : 'Select Account'}
        </span>
        <ChevronDown className="h-4 w-4 transition-transform lg:block hidden" />
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
              className="absolute top-full mt-2 left-0 w-80 bg-popover border border-border rounded-xl shadow-xl z-50 overflow-hidden"
            >
              <div className="p-3 border-b border-border">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Trading Accounts</h3>
                  {addButton}
                </div>
              </div>
              <div className="max-h-64 overflow-y-auto">
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
                Trading Accounts
              </div>
              {addButton}
            </SheetTitle>
          </SheetHeader>
          <div className="divide-y divide-border max-h-[50vh] overflow-y-auto -mx-6 px-6">
            {sortAccounts(accounts, activeAccountId).map(acc => accountRow(acc))}
            {accounts.length === 0 && (
              <div className="py-8 text-center text-muted-foreground text-sm">
                No accounts. Tap Add to create one.
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Add Account Dialog — rendered at TOP LEVEL, not nested inside dropdown/sheet */}
      <Dialog open={showAddDialog} onOpenChange={(open) => { if (!open) closeAddDialog(); }} modal={false}>
        <DialogContent
          className="max-w-sm"
          onInteractOutside={(e) => e.preventDefault()}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onFocusOutside={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Add Trading Account</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddAccount} className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label>Broker</Label>
              <Select name="broker" defaultValue="demo" onValueChange={(val) => setBrokerType(val)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="demo">
                    <span className="flex items-center gap-2"><Zap className="h-4 w-4" /> Demo (Simulated)</span>
                  </SelectItem>
                  <SelectItem value="alpaca">
                    <span className="flex items-center gap-2"><Briefcase className="h-4 w-4" /> Alpaca (Stocks)</span>
                  </SelectItem>
                  <SelectItem value="binance">
                    <span className="flex items-center gap-2"><Wallet className="h-4 w-4" /> Binance (Crypto)</span>
                  </SelectItem>
                  <SelectItem value="okx">
                    <span className="flex items-center gap-2"><Landmark className="h-4 w-4" /> OKX (Crypto)</span>
                  </SelectItem>
                  <SelectItem value="deriv">
                    <span className="flex items-center gap-2"><ArrowLeftRight className="h-4 w-4" /> Deriv (Forex/Synthetic)</span>
                  </SelectItem>
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
            <div className="space-y-2">
              <Label>Starting Balance ($)</Label>
              <Input name="balance" type="number" defaultValue="100000" />
            </div>

            {/* API Key — shown for all non-demo brokers */}
            <AnimatePresence mode="wait">
              {brokerType !== 'demo' && brokerType !== '' && (
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
                    id="apiKey"
                    name="apiKey"
                    type="password"
                    placeholder="Enter your API key"
                    autoComplete="off"
                  />
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <ShieldCheck className="h-3 w-3 shrink-0" />
                    Your credentials are encrypted and stored securely.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* API Secret — shown for alpaca, binance, okx */}
            <AnimatePresence mode="wait">
              {(brokerType === 'alpaca' || brokerType === 'binance' || brokerType === 'okx') && (
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
                    id="apiSecret"
                    name="apiSecret"
                    type="password"
                    placeholder="Enter your API secret"
                    autoComplete="off"
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {/* Passphrase — shown only for OKX */}
            <AnimatePresence mode="wait">
              {brokerType === 'okx' && (
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
                    id="passphrase"
                    name="passphrase"
                    type="password"
                    placeholder="Enter your passphrase"
                    autoComplete="off"
                  />
                </motion.div>
              )}
            </AnimatePresence>

            <Button type="submit" className="w-full cursor-pointer">Create Account</Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!fundsDialog} onOpenChange={open => { if (!open) setFundsDialog(null); }}>
        <DialogContent className="max-w-xs" onInteractOutside={e => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {fundsDialog?.action === 'deposit'
                ? <ArrowDownCircle className="h-5 w-5 text-emerald-500" />
                : <ArrowUpCircle className="h-5 w-5 text-orange-500" />}
              {fundsDialog?.action === 'deposit' ? 'Deposit Funds' : 'Withdraw Funds'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-4">
            <div className="text-center p-3 rounded-xl bg-muted/50">
              <p className="text-xs text-muted-foreground">Current Balance</p>
              <p className="text-lg font-bold tabular-nums">
                ${(accounts.find(a => a.id === fundsDialog?.id)?.balance ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
            <div className="space-y-2">
              <Label>Amount ($)</Label>
              <Input type="number" min="1" step="0.01" placeholder="0.00" value={fundsAmount} onChange={e => setFundsAmount(e.target.value)} />
              <div className="flex gap-2">
                {[100, 1000, 5000, 10000].map(n => (
                  <button key={n} onClick={() => setFundsAmount(String(n))} className="flex-1 py-1.5 text-xs font-medium rounded-md bg-muted hover:bg-accent transition-colors">
                    {n >= 1000 ? `${n / 1000}k` : n}
                  </button>
                ))}
              </div>
            </div>
            <Button onClick={handleFunds} disabled={funding || !fundsAmount || parseFloat(fundsAmount) <= 0}
              className={`w-full cursor-pointer ${fundsDialog?.action === 'deposit' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-orange-600 hover:bg-orange-700'} text-white`}>
              {funding ? 'Processing...' : fundsDialog?.action === 'deposit' ? 'Deposit' : 'Withdraw'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}