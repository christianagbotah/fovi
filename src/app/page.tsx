'use client';

import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, TrendingUp, TrendingDown, BarChart3, Search,
  Menu, Wallet, Zap, Sparkles, Plus, RefreshCw, Bell, Settings, MessageSquare, ArrowUpRight,
} from 'lucide-react';
import { useTradingStore } from '@/lib/store/trading-store';
import { AccountSwitcher } from '@/components/trading/account-switcher';
import { PriceChart } from '@/components/trading/price-chart';
import { PositionsPanel } from '@/components/trading/positions-panel';
import { SignalsPanel } from '@/components/trading/signals-panel';
import { OrderForm } from '@/components/trading/order-form';
import { MarketOverview } from '@/components/trading/market-overview';
import { SignalDetailSheet } from '@/components/trading/signal-detail-sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { formatPnl } from '@/lib/market-sim';

// ============================================================
// Mobile Bottom Tab Bar
// ============================================================
const MOBILE_TABS = [
  { id: 'dashboard', label: 'Trade', icon: LayoutDashboard },
  { id: 'signals', label: 'Signals', icon: Sparkles },
  { id: 'positions', label: 'Positions', icon: Wallet },
  { id: 'markets', label: 'Markets', icon: Search },
];

function MobileTabBar() {
  const { activeTab, setActiveTab, setOrderSheetOpen, aiChatOpen, setAiChatOpen } = useTradingStore();

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 lg:hidden bg-background/95 backdrop-blur-lg border-t border-border safe-area-pb">
      <div className="flex items-center justify-around h-16">
        {MOBILE_TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg transition-colors ${
                isActive ? 'text-primary' : 'text-muted-foreground'
              }`}
            >
              <Icon className={`h-5 w-5 ${isActive ? 'stroke-[2.5px]' : ''}`} />
              <span className="text-[10px] font-medium">{tab.label}</span>
            </button>
          );
        })}
        <button
          onClick={() => setOrderSheetOpen(true)}
          className="flex flex-col items-center gap-0.5 px-3 py-1.5"
        >
          <div className="w-10 h-10 rounded-full bg-emerald-600 flex items-center justify-center -mt-5 shadow-lg shadow-emerald-600/30">
            <Plus className="h-5 w-5 text-white" />
          </div>
          <span className="text-[10px] font-medium text-emerald-500">Trade</span>
        </button>
        <button
          onClick={() => setAiChatOpen(!aiChatOpen)}
          className={`flex flex-col items-center gap-0.5 px-3 py-1.5 ${
            aiChatOpen ? 'text-primary' : 'text-muted-foreground'
          }`}
        >
          <MessageSquare className="h-5 w-5" />
          <span className="text-[10px] font-medium">AI</span>
        </button>
      </div>
    </div>
  );
}

// ============================================================
// Portfolio Summary Cards
// ============================================================
function PortfolioCards() {
  const { portfolio } = useTradingStore();
  if (!portfolio) return null;

  const isPnlUp = portfolio.dayPnl >= 0;

  const cards = [
    {
      label: 'Balance',
      value: `$${portfolio.totalBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      sub: `${isPnlUp ? '+' : ''}${portfolio.dayPnlPercent.toFixed(2)}% today`,
      color: isPnlUp ? 'text-emerald-500' : 'text-red-500',
      icon: Wallet,
    },
    {
      label: 'Open P&L',
      value: formatPnl(portfolio.totalPnl),
      sub: `${isPnlUp ? '+' : ''}${portfolio.totalPnlPercent.toFixed(2)}%`,
      color: portfolio.totalPnl >= 0 ? 'text-emerald-500' : 'text-red-500',
      icon: portfolio.totalPnl >= 0 ? TrendingUp : TrendingDown,
    },
    {
      label: 'Positions',
      value: String(portfolio.openPositions),
      sub: `${portfolio.totalTrades} total trades`,
      color: 'text-foreground',
      icon: BarChart3,
    },
    {
      label: 'AI Signals',
      value: String(portfolio.activeSignals),
      sub: `${portfolio.winRate.toFixed(0)}% win rate`,
      color: 'text-amber-500',
      icon: Sparkles,
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 lg:gap-3">
      {cards.map(card => {
        const Icon = card.icon;
        return (
          <Card key={card.label} className="bg-card/50 border-border/50">
            <CardContent className="p-3 lg:p-4">
              <div className="flex items-center gap-1.5 mb-1">
                <Icon className={`h-3.5 w-3.5 ${card.color}`} />
                <span className="text-[11px] text-muted-foreground">{card.label}</span>
              </div>
              <p className={`text-lg lg:text-xl font-bold tabular-nums ${card.color}`}>{card.value}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{card.sub}</p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ============================================================
// AI Chat Sheet (Mobile)
// ============================================================
function AiChatSheet() {
  const { aiChatOpen, setAiChatOpen } = useTradingStore();
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([
    { role: 'assistant', content: 'Welcome to Fovi AI. I can analyze markets, explain signals, and help with trading decisions. What would you like to know?' },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || sending) return;
    const userMsg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setSending(true);

    try {
      const res = await fetch('/api/trading/market/symbols');
      const symbols = await res.json();
      const topGainers = [...symbols].sort((a, b) => b.changePercent - a.changePercent).slice(0, 5);
      const topLosers = [...symbols].sort((a, b) => a.changePercent - b.changePercent).slice(0, 5);

      const aiResponse = `Here's the current market overview:\n\n**Top Movers:**\n${topGainers.map((s: any) => `• ${s.symbol}: ${s.changePercent >= 0 ? '+' : ''}${s.changePercent.toFixed(2)}%`).join('\n')}\n\nThe market shows ${topGainers[0]?.changePercent > 1 ? 'strong momentum' : 'moderate activity'}. Use the Signals tab to generate AI-powered trading opportunities for any symbol.\n\n*This is a simulated AI response. Connect your preferred LLM API (OpenAI, Claude) for real-time AI analysis.*`;

      setMessages(prev => [...prev, { role: 'assistant', content: aiResponse }]);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'I encountered an error. Please try again.' }]);
    } finally {
      setSending(false);
    }
  };

  return (
    <Sheet open={aiChatOpen} onOpenChange={setAiChatOpen}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0">
        <SheetHeader className="px-4 pt-4 pb-3 border-b border-border">
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-amber-500" />
            Fovi AI Assistant
          </SheetTitle>
        </SheetHeader>
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4" style={{ height: 'calc(100vh - 160px)' }}>
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground rounded-br-md'
                  : 'bg-muted rounded-bl-md'
              }`}>
                {msg.content.split('\n').map((line, j) => {
                  if (line.startsWith('**') && line.endsWith('**')) {
                    return <p key={j} className="font-bold mt-2 first:mt-0">{line.replace(/\*\*/g, '')}</p>;
                  }
                  if (line.startsWith('• ')) {
                    return <p key={j} className="ml-2">{line}</p>;
                  }
                  if (line.startsWith('*') && line.endsWith('*')) {
                    return <p key={j} className="text-xs opacity-60 mt-2 italic">{line.replace(/\*/g, '')}</p>;
                  }
                  return line ? <p key={j}>{line}</p> : <br key={j} />;
                })}
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-2xl rounded-bl-md px-4 py-3">
                <div className="flex gap-1">
                  <div className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="p-3 border-t border-border">
          <div className="flex gap-2">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSend()}
              placeholder="Ask about markets, signals..."
              className="flex-1 h-10 px-4 rounded-xl bg-muted text-sm outline-none focus:ring-2 focus:ring-primary/50"
            />
            <Button size="icon" onClick={handleSend} disabled={sending || !input.trim()} className="h-10 w-10 rounded-xl">
              <ArrowUpRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ============================================================
// Main Trading Dashboard Page
// ============================================================
export default function TradingDashboard() {
  const {
    activeTab, setAccounts, setPortfolio, setAllSymbols,
    setActiveAccount, activeAccountId, accounts,
  } = useTradingStore();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Periodic data refresh
  useEffect(() => {
    async function loadData() {
      try {
        const [accRes, portRes, symRes] = await Promise.all([
          fetch('/api/trading/accounts'),
          fetch('/api/trading/portfolio'),
          fetch('/api/trading/market/symbols'),
        ]);
        if (accRes.ok) {
          const accs = await accRes.json();
          setAccounts(accs);
        }
        if (portRes.ok) setPortfolio(await portRes.json());
        if (symRes.ok) setAllSymbols(await symRes.json());
      } catch { /* */ }
    }
    loadData();
    const interval = setInterval(loadData, 15000);
    return () => clearInterval(interval);
  }, [setAccounts, setPortfolio, setAllSymbols]);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* ====== TOP BAR ====== */}
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur-lg border-b border-border">
        <div className="flex items-center justify-between h-14 px-4">
          {/* Left: Logo + Account Switcher */}
          <div className="flex items-center gap-3">
            <button className="lg:hidden" onClick={() => setSidebarOpen(!sidebarOpen)}>
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                <Zap className="h-4 w-4 text-primary-foreground" />
              </div>
              <span className="font-bold text-lg hidden sm:block">Fovi AI</span>
            </div>
            <AccountSwitcher />
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => window.location.reload()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-9 w-9 relative">
              <Bell className="h-4 w-4" />
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-red-500 text-[10px] text-white flex items-center justify-center font-bold">3</span>
            </Button>
            <Button variant="ghost" size="icon" className="h-9 w-9 hidden sm:flex">
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* ====== MAIN CONTENT ====== */}
      <main className="flex-1 pb-20 lg:pb-4">
        <AnimatePresence mode="wait">
          {activeTab === 'dashboard' && (
            <motion.div
              key="dashboard"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="h-full"
            >
              {/* Portfolio Cards */}
              <div className="p-4 pb-2">
                <PortfolioCards />
              </div>

              {/* Chart + Signals (Desktop: side by side, Mobile: stacked) */}
              <div className="flex flex-col lg:flex-row gap-3 p-4 pt-2">
                <Card className="flex-1 min-h-[400px] lg:min-h-[500px] overflow-hidden">
                  <PriceChart />
                </Card>

                {/* Signals - Desktop Sidebar */}
                <Card className="hidden lg:block w-80 overflow-hidden">
                  <div className="px-4 py-3 border-b border-border flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-amber-500" />
                    <h3 className="text-sm font-semibold">AI Signals</h3>
                  </div>
                  <div className="h-[calc(100%-49px)] overflow-y-auto">
                    <SignalsPanel />
                  </div>
                </Card>
              </div>

              {/* Positions Table (below chart on desktop) */}
              <div className="px-4 pb-4 hidden lg:block">
                <Card className="overflow-hidden">
                  <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Wallet className="h-4 w-4" />
                      <h3 className="text-sm font-semibold">Open Positions</h3>
                    </div>
                    <Button size="sm" className="h-7 gap-1" onClick={() => useTradingStore.getState().setOrderSheetOpen(true)}>
                      <Plus className="h-3 w-3" /> New Trade
                    </Button>
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    <PositionsPanel />
                  </div>
                </Card>
              </div>
            </motion.div>
          )}

          {activeTab === 'signals' && (
            <motion.div
              key="signals"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
              className="lg:hidden h-full"
            >
              <Card className="m-4 overflow-hidden" style={{ height: 'calc(100vh - 160px)' }}>
                <div className="px-4 py-3 border-b border-border flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-amber-500" />
                  <h3 className="text-sm font-semibold">AI Trading Signals</h3>
                </div>
                <SignalsPanel />
              </Card>
            </motion.div>
          )}

          {activeTab === 'positions' && (
            <motion.div
              key="positions"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
              className="lg:hidden h-full"
            >
              <Card className="m-4 overflow-hidden" style={{ height: 'calc(100vh - 160px)' }}>
                <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Wallet className="h-4 w-4" />
                    <h3 className="text-sm font-semibold">Positions</h3>
                  </div>
                  <Button size="sm" className="h-7 gap-1" onClick={() => useTradingStore.getState().setOrderSheetOpen(true)}>
                    <Plus className="h-3 w-3" /> New
                  </Button>
                </div>
                <PositionsPanel />
              </Card>
            </motion.div>
          )}

          {activeTab === 'markets' && (
            <motion.div
              key="markets"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
              className="lg:hidden h-full"
            >
              <Card className="m-4 overflow-hidden" style={{ height: 'calc(100vh - 160px)' }}>
                <MarketOverview />
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* ====== MOBILE BOTTOM TAB BAR ====== */}
      <MobileTabBar />

      {/* ====== SHEETS & MODALS ====== */}
      <OrderForm />
      <SignalDetailSheet />
      <AiChatSheet />
    </div>
  );
}
