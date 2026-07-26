'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, TrendingUp, TrendingDown, BarChart3, Search,
  Menu, Wallet, Zap, Sparkles, Plus, RefreshCw, Bell, Settings, MessageSquare, ArrowUpRight,
  ArrowDownRight, Activity, Wifi, WifiOff, ChevronRight, X, Send, Loader2,
  Shield, Target, Trophy, Clock, Radio, Briefcase,
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
import { formatPnl, formatPrice, formatVolume } from '@/lib/market-sim';
import { useMarketSocket } from '@/hooks/use-market-socket';

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
  const { activeTab, setActiveTab, setOrderSheetOpen, aiChatOpen, setAiChatOpen, wsConnected } = useTradingStore();

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 lg:hidden bg-background/95 backdrop-blur-xl border-t border-border safe-area-pb">
      <div className="flex items-center justify-around h-16">
        {MOBILE_TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg transition-all duration-200 ${
                isActive ? 'text-primary scale-105' : 'text-muted-foreground'
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
          <div className="w-10 h-10 rounded-full bg-emerald-600 flex items-center justify-center -mt-5 shadow-lg shadow-emerald-600/30 active:scale-95 transition-transform">
            <Plus className="h-5 w-5 text-white" />
          </div>
          <span className="text-[10px] font-medium text-emerald-500">Trade</span>
        </button>
        <button
          onClick={() => setAiChatOpen(!aiChatOpen)}
          className={`flex flex-col items-center gap-0.5 px-3 py-1.5 transition-colors ${
            aiChatOpen ? 'text-primary' : 'text-muted-foreground'
          }`}
        >
          <div className="relative">
            <MessageSquare className="h-5 w-5" />
            {wsConnected && (
              <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-emerald-500" />
            )}
          </div>
          <span className="text-[10px] font-medium">AI</span>
        </button>
      </div>
    </div>
  );
}

// ============================================================
// Portfolio Summary Cards - Enhanced
// ============================================================
function PortfolioCards() {
  const { portfolio, wsConnected } = useTradingStore();
  if (!portfolio) return null;

  const isPnlUp = portfolio.dayPnl >= 0;
  const isTotalUp = portfolio.totalPnl >= 0;

  const cards = [
    {
      label: 'Portfolio Value',
      value: `$${portfolio.totalBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      sub: `${isPnlUp ? '+' : ''}${portfolio.dayPnlPercent.toFixed(2)}% today`,
      color: isPnlUp ? 'text-emerald-500' : 'text-red-500',
      icon: Wallet,
      bg: isPnlUp ? 'bg-emerald-500/5' : 'bg-red-500/5',
    },
    {
      label: 'Unrealized P&L',
      value: formatPnl(portfolio.totalPnl),
      sub: `${isTotalUp ? '+' : ''}${portfolio.totalPnlPercent.toFixed(2)}%`,
      color: isTotalUp ? 'text-emerald-500' : 'text-red-500',
      icon: isTotalUp ? TrendingUp : TrendingDown,
      bg: isTotalUp ? 'bg-emerald-500/5' : 'bg-red-500/5',
    },
    {
      label: 'Open Positions',
      value: String(portfolio.openPositions),
      sub: `${portfolio.totalTrades} total trades`,
      color: 'text-foreground',
      icon: BarChart3,
      bg: 'bg-muted/30',
    },
    {
      label: 'AI Win Rate',
      value: `${portfolio.winRate.toFixed(0)}%`,
      sub: `${portfolio.activeSignals} active signals`,
      color: portfolio.winRate >= 50 ? 'text-amber-500' : 'text-orange-500',
      icon: Trophy,
      bg: 'bg-amber-500/5',
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 lg:gap-3">
      {cards.map(card => {
        const Icon = card.icon;
        return (
          <Card key={card.label} className={`${card.bg} border-border/30 overflow-hidden`}>
            <CardContent className="p-3 lg:p-4">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5">
                  <Icon className={`h-3.5 w-3.5 ${card.color}`} />
                  <span className="text-[11px] text-muted-foreground font-medium">{card.label}</span>
                </div>
                {wsConnected && (
                  <span className="flex items-center gap-0.5 text-[9px] text-emerald-500 font-medium">
                    <Radio className="h-2.5 w-2.5" /> LIVE
                  </span>
                )}
              </div>
              <p className={`text-lg lg:text-xl font-bold tabular-nums tracking-tight ${card.color}`}>{card.value}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{card.sub}</p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ============================================================
// Quick Trade Buttons (Mobile - visible on market symbols)
// ============================================================
function QuickTradeButtons({ symbol, name }: { symbol: string; name: string }) {
  const { setOrderSheetOpen, setOrderSymbol } = useTradingStore();

  const handleTrade = (side: 'buy' | 'sell') => {
    setOrderSymbol(symbol);
    setOrderSheetOpen(true);
  };

  return (
    <div className="flex gap-2">
      <Button size="sm" className="h-8 px-3 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium"
        onClick={(e) => { e.stopPropagation(); handleTrade('buy'); }}>
        Buy
      </Button>
      <Button size="sm" variant="outline" className="h-8 px-3 text-red-500 border-red-500/30 hover:bg-red-500/10 text-xs font-medium"
        onClick={(e) => { e.stopPropagation(); handleTrade('sell'); }}>
        Sell
      </Button>
    </div>
  );
}

// ============================================================
// Ticker Strip - Live scrolling prices
// ============================================================
function TickerStrip() {
  const { livePrices, allSymbols, wsConnected, setSelectedSymbol, setAllSymbols } = useTradingStore();
  const prices = livePrices.length > 0 ? livePrices : allSymbols;
  const topMovers = useMemo(() =>
    [...prices].sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent)).slice(0, 10),
    [prices]
  );

  // Sync WebSocket prices to allSymbols in the store
  useEffect(() => {
    if (livePrices.length > 0) setAllSymbols(livePrices);
  }, [livePrices, setAllSymbols]);

  if (topMovers.length === 0) return null;

  return (
    <div className="border-b border-border/50 bg-muted/20">
      <ScrollArea className="w-full">
        <div className="flex gap-4 px-4 py-1.5 min-w-max">
          {wsConnected && (
            <span className="flex items-center gap-1 text-[10px] text-emerald-500 font-semibold shrink-0">
              <Radio className="h-3 w-3" /> LIVE
            </span>
          )}
          {topMovers.map(sym => {
            const isUp = sym.changePercent >= 0;
            return (
              <button
                key={sym.symbol}
                onClick={() => setSelectedSymbol(sym.symbol)}
                className="flex items-center gap-1.5 shrink-0 hover:opacity-80 transition-opacity"
              >
                <span className="text-[11px] font-semibold">{sym.symbol}</span>
                <span className={`text-[11px] font-medium tabular-nums ${isUp ? 'text-emerald-500' : 'text-red-500'}`}>
                  {formatPrice(sym.price, sym.symbol)}
                </span>
                <span className={`text-[10px] font-medium tabular-nums ${isUp ? 'text-emerald-500' : 'text-red-500'}`}>
                  {isUp ? '+' : ''}{sym.changePercent.toFixed(2)}%
                </span>
              </button>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

// ============================================================
// AI Chat Sheet - Enhanced with real LLM
// ============================================================
function AiChatSheet() {
  const { aiChatOpen, setAiChatOpen, selectedSymbol, portfolio, positions, signals, wsConnected } = useTradingStore();
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([
    { role: 'assistant', content: `Welcome to **Fovi AI**. I'm your intelligent trading assistant with real-time market analysis capabilities.\n\nI can help you with:\n• **Technical Analysis** — RSI, MACD, Bollinger Bands, patterns\n• **Trade Ideas** — Entry, stop-loss, take-profit levels\n• **Risk Management** — Position sizing and portfolio analysis\n• **Market Insights** — Real-time market commentary\n\nTry asking: "Analyze AAPL" or "What's the crypto market doing?"` },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sessionId = useRef(`session_${Date.now()}`);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (aiChatOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [aiChatOpen]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || sending) return;
    const userMsg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setSending(true);

    try {
      const res = await fetch('/api/trading/ai-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg, sessionId: sessionId.current }),
      });
      const data = await res.json();
      if (data.success) {
        setMessages(prev => [...prev, { role: 'assistant', content: data.response }]);
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: `Sorry, I encountered an error: ${data.error}. Please try again.` }]);
      }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'I\'m having trouble connecting. Please check your connection and try again.' }]);
    } finally {
      setSending(false);
    }
  }, [input, sending]);

  const quickActions = [
    { label: `Analyze ${selectedSymbol || 'AAPL'}`, prompt: `Give me a detailed technical analysis of ${selectedSymbol || 'AAPL'} with trade recommendations` },
    { label: 'Market Overview', prompt: 'Give me a summary of the current market conditions across all asset classes' },
    { label: 'Risk Check', prompt: 'Analyze my current portfolio risk and suggest adjustments' },
  ];

  return (
    <Sheet open={aiChatOpen} onOpenChange={setAiChatOpen}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
        {/* Header */}
        <SheetHeader className="px-4 pt-4 pb-3 border-b border-border shrink-0">
          <SheetTitle className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-bold">Fovi AI</span>
                {wsConnected && (
                  <span className="flex items-center gap-1 text-[10px] text-emerald-500 font-medium">
                    <Wifi className="h-3 w-3" /> Connected
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">AI Trading Assistant</p>
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8"
              onClick={() => setMessages([{ role: 'assistant', content: 'Conversation cleared. How can I help you with your trading today?' }])}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </SheetTitle>
        </SheetHeader>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div className={`max-w-[88%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground rounded-br-md'
                  : 'bg-muted rounded-bl-md'
              }`}>
                <MarkdownContent content={msg.content} />
              </div>
            </motion.div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-2xl rounded-bl-md px-4 py-3">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                  <span className="text-xs text-muted-foreground">Fovi AI is analyzing...</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Quick Actions (show when few messages) */}
        {messages.length <= 2 && !sending && (
          <div className="px-4 pb-2 flex gap-2 overflow-x-auto">
            {quickActions.map(action => (
              <button
                key={action.label}
                onClick={() => { setInput(action.prompt); }}
                className="shrink-0 px-3 py-1.5 text-xs font-medium rounded-full border border-border hover:bg-accent transition-colors"
              >
                {action.label}
              </button>
            ))}
          </div>
        )}

        {/* Input */}
        <div className="p-3 border-t border-border shrink-0">
          <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="flex gap-2">
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Ask about any market, signal, or trade..."
              className="flex-1 h-10 px-4 rounded-xl bg-muted text-sm outline-none focus:ring-2 focus:ring-primary/50 transition-shadow"
              disabled={sending}
            />
            <Button type="submit" size="icon" disabled={sending || !input.trim()} className="h-10 w-10 rounded-xl">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </form>
          <p className="text-[10px] text-muted-foreground mt-1.5 text-center">
            AI-generated analysis. Not financial advice. Always do your own research.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ============================================================
// Simple Markdown renderer (no external dep needed)
// ============================================================
function MarkdownContent({ content }: { content: string }) {
  const lines = content.split('\n');
  return (
    <>
      {lines.map((line, j) => {
        if (!line.trim()) return <br key={j} />;
        if (line.startsWith('### ')) return <h4 key={j} className="font-bold text-sm mt-3 mb-1">{line.slice(4)}</h4>;
        if (line.startsWith('## ')) return <h3 key={j} className="font-bold text-base mt-3 mb-1">{line.slice(3)}</h3>;
        if (line.startsWith('**') && line.endsWith('**')) return <p key={j} className="font-bold mt-2 first:mt-0">{line.replace(/\*\*/g, '')}</p>;
        if (line.startsWith('- ') || line.startsWith('* ')) {
          const text = line.slice(2);
          // Handle inline bold
          const parts = text.split(/(\*\*[^*]+\*\*)/);
          return (
            <p key={j} className="ml-2 flex items-start gap-1">
              <span className="text-primary mt-0.5">•</span>
              <span>{parts.map((part, k) =>
                part.startsWith('**') && part.endsWith('**')
                  ? <strong key={k}>{part.replace(/\*\*/g, '')}</strong>
                  : part
              )}</span>
            </p>
          );
        }
        // Inline formatting
        const parts = line.split(/(\*\*[^*]+\*\*)/);
        if (line.startsWith('*') && line.endsWith('*') && !line.includes(' ')) {
          return <p key={j} className="text-xs opacity-60 mt-2 italic">{line.replace(/\*/g, '')}</p>;
        }
        return <p key={j}>{parts.map((part, k) =>
          part.startsWith('**') && part.endsWith('**')
            ? <strong key={k}>{part.replace(/\*\*/g, '')}</strong>
            : part
        )}</p>;
      })}
    </>
  );
}

// ============================================================
// Settings Sheet - Broker Connect
// ============================================================
function SettingsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { accounts, setAccounts } = useTradingStore();
  const [connecting, setConnecting] = useState(false);
  const [broker, setBroker] = useState('alpaca');
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [accountType, setAccountType] = useState('demo');

  const handleConnect = async () => {
    if (!apiKey || !apiSecret) return;
    setConnecting(true);
    try {
      const res = await fetch('/api/trading/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ broker, accountType, apiKey, apiSecret }),
      });
      if (res.ok) {
        const accs = await (await fetch('/api/trading/accounts')).json();
        setAccounts(accs);
        setApiKey(''); setApiSecret('');
        onOpenChange(false);
      }
    } catch { /* */ } finally { setConnecting(false); }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader className="pb-4">
          <SheetTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Settings & Brokers
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-6 pb-8">
          {/* Connected Accounts */}
          <div>
            <h3 className="text-sm font-semibold mb-3">Connected Accounts</h3>
            <div className="space-y-2">
              {accounts.map(acc => (
                <div key={acc.id} className="flex items-center gap-3 p-3 rounded-xl bg-muted/50 border border-border/50">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    acc.accountType === 'live' ? 'bg-emerald-500/15' : 'bg-amber-500/15'
                  }`}>
                    <Briefcase className={`h-4 w-4 ${acc.accountType === 'live' ? 'text-emerald-500' : 'text-amber-500'}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{acc.broker.toUpperCase()}</span>
                      <Badge variant={acc.accountType === 'live' ? 'default' : 'secondary'}
                        className={`text-[10px] h-5 ${acc.accountType === 'live'
                          ? 'bg-emerald-500/10 text-emerald-500'
                          : 'bg-amber-500/10 text-amber-500'}`}>
                        {acc.accountType}
                      </Badge>
                      {acc.isDefault && <Badge variant="outline" className="text-[10px] h-5">DEFAULT</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">${acc.balance.toLocaleString()}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Connect New Broker */}
          <div>
            <h3 className="text-sm font-semibold mb-3">Connect Broker</h3>
            <div className="space-y-3 p-4 rounded-xl border border-border/50 bg-card">
              <div className="grid grid-cols-3 gap-2">
                {(['alpaca', 'binance', 'deriv'] as const).map(b => (
                  <button key={b} onClick={() => setBroker(b)}
                    className={`p-2.5 rounded-lg text-xs font-medium border transition-colors ${
                      broker === b ? 'bg-primary/10 border-primary text-primary' : 'border-border hover:bg-accent'
                    }`}>
                    {b.charAt(0).toUpperCase() + b.slice(1)}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setAccountType('demo')}
                  className={`p-2 rounded-lg text-xs font-medium border transition-colors ${
                    accountType === 'demo' ? 'bg-amber-500/10 border-amber-500/30 text-amber-500' : 'border-border'
                  }`}>
                  Demo / Paper
                </button>
                <button onClick={() => setAccountType('live')}
                  className={`p-2 rounded-lg text-xs font-medium border transition-colors ${
                    accountType === 'live' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500' : 'border-border'
                  }`}>
                  Live Trading
                </button>
              </div>

              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">API Key</label>
                <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)}
                  placeholder="Enter your API key"
                  className="w-full h-10 px-3 rounded-lg bg-muted text-sm outline-none focus:ring-2 focus:ring-primary/50" />
              </div>
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">API Secret</label>
                <input type="password" value={apiSecret} onChange={e => setApiSecret(e.target.value)}
                  placeholder="Enter your API secret"
                  className="w-full h-10 px-3 rounded-lg bg-muted text-sm outline-none focus:ring-2 focus:ring-primary/50" />
              </div>

              <Button onClick={handleConnect} disabled={connecting || !apiKey || !apiSecret} className="w-full">
                {connecting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Shield className="h-4 w-4 mr-2" />}
                Connect {broker.charAt(0).toUpperCase() + broker.slice(1)}
              </Button>

              {accountType === 'live' && (
                <p className="text-[10px] text-red-500 flex items-center gap-1">
                  <Shield className="h-3 w-3" /> Live trading uses real money. Ensure you understand the risks.
                </p>
              )}
            </div>
          </div>

          {/* Platform Info */}
          <div className="p-4 rounded-xl bg-muted/30 border border-border/30">
            <h4 className="text-xs font-semibold mb-2">About Fovi AI</h4>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Fovi is a world-class AI auto-trading platform combining technical analysis,
              machine learning signals, and real-time market data. Connect your preferred
              broker to start trading with AI assistance.
            </p>
            <div className="flex gap-2 mt-3">
              <Badge variant="outline" className="text-[10px]">v1.0.0</Badge>
              <Badge variant="outline" className="text-[10px]">Next.js 16</Badge>
              <Badge variant="outline" className="text-[10px]">Prisma</Badge>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ============================================================
// Desktop Sidebar
// ============================================================
function DesktopSidebar() {
  const { activeTab, setActiveTab, setOrderSheetOpen } = useTradingStore();

  const sidebarItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'markets', label: 'Markets', icon: Search },
    { id: 'positions', label: 'Positions', icon: Wallet },
    { id: 'signals', label: 'AI Signals', icon: Sparkles },
  ];

  return (
    <aside className="hidden lg:flex flex-col w-56 border-r border-border bg-card/30 shrink-0">
      <div className="p-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shadow-lg shadow-primary/20">
            <Zap className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="font-bold text-base tracking-tight">Fovi AI</h1>
            <p className="text-[10px] text-muted-foreground font-medium">Auto-Trading Platform</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-2 space-y-0.5">
        {sidebarItems.map(item => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
              }`}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="p-3 border-t border-border">
        <Button className="w-full gap-2" onClick={() => setOrderSheetOpen(true)}>
          <Plus className="h-4 w-4" /> New Trade
        </Button>
      </div>
    </aside>
  );
}

// ============================================================
// Main Trading Dashboard Page
// ============================================================
export default function TradingDashboard() {
  const {
    activeTab, setAccounts, setPortfolio, setAllSymbols, setLivePrices, setWsConnected,
    accounts, livePrices, allSymbols,
  } = useTradingStore();
  const [settingsOpen, setSettingsOpen] = useState(false);

  // WebSocket market data
  const { prices: wsPrices, connected: wsConnected } = useMarketSocket();

  // Sync WebSocket data to store
  useEffect(() => {
    if (wsPrices.length > 0) {
      setLivePrices(wsPrices);
      setWsConnected(wsConnected);
    }
  }, [wsPrices, wsConnected, setLivePrices, setWsConnected]);

  // Periodic data refresh
  useEffect(() => {
    async function loadData() {
      try {
        const [accRes, portRes, symRes] = await Promise.all([
          fetch('/api/trading/accounts'),
          fetch('/api/trading/portfolio'),
          fetch('/api/trading/market/symbols'),
        ]);
        if (accRes.ok) setAccounts(await accRes.json());
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
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur-xl border-b border-border/50">
        <div className="flex items-center justify-between h-14 px-4">
          <div className="flex items-center gap-3">
            <button className="lg:hidden" onClick={() => setSettingsOpen(true)}>
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2 lg:hidden">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center">
                <Zap className="h-4 w-4 text-primary-foreground" />
              </div>
              <span className="font-bold text-lg">Fovi</span>
            </div>
            <AccountSwitcher />
          </div>

          <div className="flex items-center gap-1.5">
            {wsConnected ? (
              <span className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-500/10 text-emerald-500 text-[10px] font-semibold">
                <Wifi className="h-3 w-3" /> LIVE
              </span>
            ) : (
              <span className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-md bg-muted text-muted-foreground text-[10px] font-semibold">
                <WifiOff className="h-3 w-3" /> DEMO
              </span>
            )}
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => window.location.reload()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-9 w-9 relative">
              <Bell className="h-4 w-4" />
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-red-500 text-[10px] text-white flex items-center justify-center font-bold">3</span>
            </Button>
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setSettingsOpen(true)}>
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* ====== TICKER STRIP ====== */}
      <TickerStrip />

      {/* ====== MAIN LAYOUT ====== */}
      <div className="flex-1 flex overflow-hidden">
        {/* Desktop Sidebar */}
        <DesktopSidebar />

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto pb-20 lg:pb-4">
          <AnimatePresence mode="wait">
            {/* ====== DASHBOARD TAB ====== */}
            {activeTab === 'dashboard' && (
              <motion.div
                key="dashboard"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.15 }}
                className="h-full"
              >
                <div className="p-4 pb-2">
                  <PortfolioCards />
                </div>

                <div className="flex flex-col lg:flex-row gap-3 p-4 pt-2">
                  <Card className="flex-1 min-h-[400px] lg:min-h-[500px] overflow-hidden">
                    <PriceChart />
                  </Card>

                  <Card className="hidden lg:block w-80 overflow-hidden">
                    <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-amber-500" />
                        <h3 className="text-sm font-semibold">AI Signals</h3>
                      </div>
                      <Badge variant="outline" className="text-[10px] h-5 bg-amber-500/5 text-amber-500 border-amber-500/20">
                        AI Powered
                      </Badge>
                    </div>
                    <div className="h-[calc(100%-49px)] overflow-y-auto">
                      <SignalsPanel />
                    </div>
                  </Card>
                </div>

                {/* Desktop: Positions Table */}
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

            {/* ====== SIGNALS TAB (Mobile) ====== */}
            {activeTab === 'signals' && (
              <motion.div
                key="signals"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.15 }}
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

            {/* ====== POSITIONS TAB (Mobile) ====== */}
            {activeTab === 'positions' && (
              <motion.div
                key="positions"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.15 }}
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

            {/* ====== MARKETS TAB (Mobile) ====== */}
            {activeTab === 'markets' && (
              <motion.div
                key="markets"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.15 }}
                className="lg:hidden h-full"
              >
                <Card className="m-4 overflow-hidden" style={{ height: 'calc(100vh - 160px)' }}>
                  <MarketOverview />
                </Card>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>

      {/* ====== MOBILE BOTTOM TAB BAR ====== */}
      <MobileTabBar />

      {/* ====== SHEETS & MODALS ====== */}
      <OrderForm />
      <SignalDetailSheet />
      <AiChatSheet />
      <SettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
