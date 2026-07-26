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
import { useTradingStore } from '@/lib/store/trading-store';
import type { TradingAccount, BrokerProvider } from '@/lib/types';

export function AccountSwitcher() {
  const {
    accounts, activeAccountId, setActiveAccount, setAccounts,
  } = useTradingStore();
  const [open, setOpen] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const activeAccount = accounts.find(a => a.id === activeAccountId);

  useEffect(() => {
    // Close dropdown on outside click
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSwitch = async (id: string) => {
    await fetch('/api/trading/accounts/switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: id }),
    });
    setActiveAccount(id);
    setOpen(false);
    window.location.reload();
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

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger Button */}
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-card border border-border hover:bg-accent/50 transition-colors"
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
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown */}
      <AnimatePresence>
        {open && (
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
                <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
                  <DialogTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-7 gap-1">
                      <Plus className="h-3.5 w-3.5" /> Add
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
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
                      <Button type="submit" className="w-full">Create Account</Button>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
            </div>
            <div className="max-h-64 overflow-y-auto">
              {accounts.map(acc => (
                <div
                  key={acc.id}
                  className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-accent/50 transition-colors ${
                    acc.id === activeAccountId ? 'bg-accent' : ''
                  }`}
                  onClick={() => acc.id !== activeAccountId && handleSwitch(acc.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {acc.id === activeAccountId && <Check className="h-3.5 w-3.5 text-primary" />}
                      <span className="text-sm font-medium">{acc.broker.toUpperCase()}</span>
                      <Badge variant={acc.accountType === 'live' ? 'default' : 'secondary'}
                        className={acc.accountType === 'live'
                          ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-[10px]'
                          : 'bg-amber-500/10 text-amber-500 border-amber-500/20 text-[10px]'}>
                        {acc.accountType}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      ${acc.balance.toLocaleString()}
                    </p>
                  </div>
                  {accounts.length > 1 && (
                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                      onClick={e => { e.stopPropagation(); handleDelete(acc.id); }}>
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
