'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeftRight, Plus, Trash2, ChevronDown, Check, Wallet,
  Briefcase, Zap, Landmark,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { useTradingStore } from '@/lib/store/trading-store';
import type { TradingAccount, BrokerProvider } from '@/lib/types';

export function AccountSwitcher() {
  const {
    accounts, activeAccountId, setActiveAccount, setAccounts,
  } = useTradingStore();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
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
    // Use a small delay to avoid closing immediately on the same click
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handler);
    }, 10);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handler);
    };
  }, [dropdownOpen]);

  const handleSwitch = async (id: string) => {
    if (id === activeAccountId) return;
    try {
      await fetch('/api/trading/accounts/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: id }),
      });
    } catch { /* non-critical */ }
    setActiveAccount(id);
    setDropdownOpen(false);
    setMobileSheetOpen(false);
  };

  const handleAddAccount = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    await fetch('/api/trading/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        broker: data.get('broker'),
        accountType: data.get('accountType'),
        balance: parseFloat(data.get('balance') as string) || 100000,
      }),
    });
    setShowAddDialog(false);
    const res = await fetch('/api/trading/accounts');
    const accs = await res.json();
    setAccounts(accs);
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/trading/accounts/${id}`, { method: 'DELETE' });
    const res = await fetch('/api/trading/accounts');
    const accs = await res.json();
    setAccounts(accs);
  };

  const accountRow = (acc: TradingAccount, onClose: () => void) => (
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
      {accounts.length > 1 && (
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 cursor-pointer"
          onClick={e => { e.stopPropagation(); handleDelete(acc.id); }}>
          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      )}
    </div>
  );

  const addAccountDialog = (
    <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1 cursor-pointer">
          <Plus className="h-3.5 w-3.5" /> Add
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm" onInteractOutside={(e: React.MouseEvent) => e.preventDefault()} onOpenAutoFocus={(e: Event) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Add Trading Account</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleAddAccount} className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label>Broker</Label>
            <Select name="broker" defaultValue="demo">
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
          <Button type="submit" className="w-full cursor-pointer">Create Account</Button>
        </form>
      </DialogContent>
    </Dialog>
  );

  return (
    <>
      {/* Trigger Button */}
      <button
        onClick={() => {
          // Use Sheet on mobile, dropdown on desktop
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
        ) : (
          <span className="flex h-2 w-2 rounded-full bg-amber-500" />
        )}
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
              className="absolute top-full mt-2 right-0 w-80 bg-popover border border-border rounded-xl shadow-xl z-50 overflow-hidden"
            >
              <div className="p-3 border-b border-border">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Trading Accounts</h3>
                  {addAccountDialog}
                </div>
              </div>
              <div className="max-h-64 overflow-y-auto">
                {accounts.map(acc => accountRow(acc, () => setDropdownOpen(false)))}
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
              {addAccountDialog}
            </SheetTitle>
          </SheetHeader>
          <div className="divide-y divide-border max-h-[50vh] overflow-y-auto -mx-6 px-6">
            {accounts.map(acc => accountRow(acc, () => setMobileSheetOpen(false)))}
            {accounts.length === 0 && (
              <div className="py-8 text-center text-muted-foreground text-sm">
                No accounts. Tap Add to create one.
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
