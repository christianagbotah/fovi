'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, TrendingUp, TrendingDown, BarChart3, Search,
  Menu, Wallet, Sparkles, Plus, RefreshCw, Bell, Settings, MessageSquare, ArrowUpRight,
  ArrowDownRight, Activity, Radio, Briefcase, Clock, Shield, Target, Trophy,
  Send, Loader2, X, ChevronRight, AlertTriangle, History, Eye, Crosshair,
  Bot, LineChart, FlaskConical, BookOpen, Globe, GitBranch, Timer,
  ArrowLeft, User, Lock, Mail, Phone, ChevronDown, Link2, Zap,
  LogOut, ShieldCheck, Smartphone, KeyRound, CreditCard, Building2,
  CheckCircle2, Circle, MessageCircle, Receipt, Crown, Server, Save,
} from 'lucide-react';
import { useTradingStore, hydrateAlertsFromStorage } from '@/lib/store/trading-store';
import { SettingsAccountRow } from '@/components/trading/settings-account-row';
import { AdminBrokersPanel } from '@/components/trading/admin-brokers-panel';
import { AccountSwitcher } from '@/components/trading/account-switcher';
import { PriceChart } from '@/components/trading/price-chart';
import { PositionsPanel } from '@/components/trading/positions-panel';
import { SignalsPanel } from '@/components/trading/signals-panel';
import { OrderForm } from '@/components/trading/order-form';
import { MarketOverview } from '@/components/trading/market-overview';
import { AITradingDashboard } from '@/components/trading/ai-trading-dashboard';
import { BacktestPanel } from '@/components/trading/backtest-panel';
import { AnalyticsPanel } from '@/components/trading/analytics-panel';
import { JournalPanel } from '@/components/trading/journal-panel';
import { SentimentPanel } from '@/components/trading/sentiment-panel';
import { CorrelationPanel } from '@/components/trading/correlation-panel';
import { SessionsPanel } from '@/components/trading/sessions-panel';
import { WebhookPanel } from '@/components/trading/webhook-panel';
import { LeaderboardPanel } from '@/components/trading/leaderboard-panel';
import { SignalDetailSheet } from '@/components/trading/signal-detail-sheet';
import { PositionDetailSheet } from '@/components/trading/position-detail-sheet';
import { SwipeableItem } from '@/components/trading/swipeable-item';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { formatPnl, formatPrice, formatVolume } from '@/lib/market-sim';
import { useMarketSocket } from '@/hooks/use-market-socket';
import { useTradeNotifications } from '@/hooks/use-trade-notifications';
import { PagePreloader } from '@/components/page-preloader';
import { DemoBanner } from '@/components/trading/demo-banner';
import { toast } from 'sonner';


// ============================================================
// Mobile Bottom Tab Bar
// ============================================================
const MOBILE_TABS = [
  { id: 'autotrade', label: 'AI Bot', icon: Bot },
  { id: 'markets', label: 'Markets', icon: Search },
  { id: 'signals', label: 'Signals', icon: Sparkles },
  { id: 'analytics', label: 'Stats', icon: BarChart3 },
];

function MobileTabBar() {
  const { activeTab, setActiveTab, setOrderSheetOpen, aiChatOpen, setAiChatOpen } = useTradingStore();

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 lg:hidden bg-background/95 backdrop-blur-xl border-t border-border safe-area-pb">
      <div className="flex items-center justify-around h-16">
        {MOBILE_TABS.slice(0, 4).map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex flex-col items-center gap-0.5 px-2.5 py-1.5 rounded-lg transition-all duration-200 cursor-pointer ${
                isActive ? 'text-primary scale-105' : 'text-muted-foreground'
              }`}>
              <Icon className={`h-5 w-5 ${isActive ? 'stroke-[2.5px]' : ''}`} />
              <span className="text-[10px] font-medium">{tab.label}</span>
            </button>
          );
        })}
        <button onClick={() => setOrderSheetOpen(true)} className="flex flex-col items-center gap-0.5 px-2.5 py-1.5 cursor-pointer">
          <div className="w-10 h-10 rounded-full bg-emerald-600 flex items-center justify-center -mt-5 shadow-lg shadow-emerald-600/30 active:scale-95 transition-transform">
            <Plus className="h-5 w-5 text-white" />
          </div>
          <span className="text-[10px] font-medium text-emerald-500">Trade</span>
        </button>
        <button onClick={() => setAiChatOpen(!aiChatOpen)}
          className={`flex flex-col items-center gap-0.5 px-2.5 py-1.5 transition-colors cursor-pointer ${aiChatOpen ? 'text-primary' : 'text-muted-foreground'}`}>
          <MessageSquare className="h-5 w-5" />
          <span className="text-[10px] font-medium">AI</span>
        </button>
      </div>
    </div>
  );
}

// ============================================================
// Equity Sparkline (30-day simulated P&L curve)
// ============================================================
function EquitySparkline({ portfolio }: { portfolio: NonNullable<ReturnType<typeof useTradingStore.getState>['portfolio']> }) {
  const points = useMemo(() => {
    const data: number[] = [];
    let val = portfolio.totalBalance - portfolio.totalPnl;
    for (let i = 0; i < 30; i++) {
      val += (Math.random() - 0.45) * (portfolio.totalBalance * 0.008);
      data.push(val);
    }
    data.push(portfolio.totalBalance);
    return data;
  }, [portfolio.totalBalance, portfolio.totalPnl]);

  const min = Math.min(...points);
  const max = Math.max(...points);
   const range = max - min || 1;
  const w = 200, h = 40;
  const toX = (i: number) => (i / (points.length - 1)) * w;
  const toY = (v: number) => h - ((v - min) / range) * h;
   const isUp = points[points.length - 1] >= points[0];
  const color = isUp ? '#10b981' : '#ef4444';

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(p).toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${w},${h} L0,${h} Z`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-10 mt-1" preserveAspectRatio="none">
      <defs>
        <linearGradient id={`eqGrad_${isUp ? 'up' : 'dn'}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#eqGrad_${isUp ? 'up' : 'dn'})`} />
      <path d={linePath} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ============================================================
// Risk Score Gauge
// ============================================================
function RiskGauge({ portfolio }: { portfolio: NonNullable<ReturnType<typeof useTradingStore.getState>['portfolio']> }) {
  const score = useMemo(() => {
    const posRisk = Math.min(portfolio.openPositions / 10, 1) * 40;
    const pnlRisk = portfolio.totalBalance > 0 ? Math.min(Math.abs(portfolio.totalPnl) / (portfolio.totalBalance * 0.05), 1) * 35 : 0;
    const signalRisk = Math.min(portfolio.activeSignals / 5, 1) * 25;
    return Math.round(posRisk + pnlRisk + signalRisk);
  }, [portfolio]);

  const label = score <= 33 ? 'Low' : score <= 66 ? 'Medium' : 'High';
  const color = score <= 33 ? 'text-emerald-500' : score <= 66 ? 'text-amber-500' : 'text-red-500';
  const strokeColor = score <= 33 ? '#10b981' : score <= 66 ? '#f59e0b' : '#ef4444';
  const pct = score / 100;
  const r = 28;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - pct);

  return (
    <div className="flex items-center gap-3">
      <svg width="64" height="44" viewBox="0 0 64 44" className="shrink-0">
        <circle cx="32" cy="32" r={r} fill="none" stroke="currentColor" strokeWidth="5" className="text-muted/30"
          strokeDasharray={circ * 0.75} strokeDashoffset="0" strokeLinecap="round"
          transform="rotate(135 32 32)" />
        <circle cx="32" cy="32" r={r} fill="none" stroke={strokeColor} strokeWidth="5"
          strokeDasharray={circ * 0.75} strokeDashoffset={offset} strokeLinecap="round"
          transform="rotate(135 32 32)" style={{ transition: 'stroke-dashoffset 0.6s ease' }} />
        <text x="32" y="30" textAnchor="middle" className="fill-foreground" fontSize="11" fontWeight="700">{score}</text>
      </svg>
      <div>
        <p className="text-xs font-semibold">Risk Score</p>
        <p className={`text-xs font-bold ${color}`}>{label} Risk</p>
      </div>
    </div>
  );
}

// ============================================================
// Performance Metrics Row
// ============================================================
function PerformanceMetrics({ portfolio }: { portfolio: NonNullable<ReturnType<typeof useTradingStore.getState>['portfolio']> }) {
  const isPnlUp = portfolio.dayPnl >= 0;

  const metrics = [
    {
      label: 'Day P&L',
      value: formatPnl(portfolio.dayPnl),
      sub: `${isPnlUp ? '+' : ''}${portfolio.dayPnlPercent.toFixed(2)}%`,
      color: isPnlUp ? 'text-emerald-500' : 'text-red-500',
      icon: isPnlUp ? TrendingUp : TrendingDown,
    },
    {
      label: 'Win Rate',
      value: `${portfolio.winRate.toFixed(0)}%`,
      sub: `${portfolio.totalTrades} trades`,
      color: portfolio.winRate >= 50 ? 'text-emerald-500' : 'text-orange-500',
      icon: Target,
      progress: portfolio.winRate,
    },
    {
      label: 'Active Signals',
      value: String(portfolio.activeSignals),
      sub: `${portfolio.openPositions} positions`,
      color: 'text-amber-500',
      icon: Crosshair,
    },
    {
      label: 'AI Accuracy',
      value: `${Math.min(portfolio.winRate + 8, 97).toFixed(0)}%`,
      sub: 'Signal precision',
      color: 'text-primary',
      icon: Sparkles,
      progress: Math.min(portfolio.winRate + 8, 97),
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 lg:gap-3">
      {metrics.map(m => {
        const Icon = m.icon;
        return (
          <Card key={m.label} className="border-border/30 overflow-hidden">
            <CardContent className="p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <Icon className={`h-3 w-3 ${m.color}`} />
                <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">{m.label}</span>
              </div>
              <p className={`text-base font-bold tabular-nums ${m.color}`}>{m.value}</p>
              {'progress' in m && m.progress !== undefined && (
                <div className="w-full h-1 bg-muted rounded-full mt-1.5 overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-500 ${m.progress >= 50 ? 'bg-emerald-500' : 'bg-orange-500'}`}
                    style={{ width: `${m.progress}%` }} />
                </div>
              )}
              {!('progress' in m) && (
                <p className="text-[10px] text-muted-foreground mt-0.5 tabular-nums">{m.sub}</p>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ============================================================
// Portfolio Summary Cards - Enhanced
// ============================================================
function PortfolioCards() {
  const { portfolio, wsConnected, botConfig, aiOpenPositions, aiClosedTrades, accounts, activeAccountId } = useTradingStore();

  // Get active account info
  const activeAccount = accounts.find(a => a.id === activeAccountId);
  const linkedBalance = activeAccount?.linkedBalance ?? activeAccount?.balance ?? 100000;
  const totalAllocated = activeAccount?.totalAllocated ?? 0;
  const availableBalance = Math.max(0, linkedBalance - totalAllocated);
  const isLiveAccount = activeAccount?.accountType === 'live';
  const isLinkedBroker = activeAccount?.broker !== 'demo' && (activeAccount?.apiKey || activeAccount?.accountId);

  // When AI bot has been active, derive portfolio from AI state
  const allocation = botConfig.allocationAmount;
  const hasAITrading = allocation > 0 && (botConfig.totalTrades > 0 || aiOpenPositions.length > 0);

  const effectivePortfolio = hasAITrading
    ? (() => {
        const grossRealized = aiClosedTrades.reduce((s, t) => s + (t.grossPnl ?? t.realizedPnl), 0);
        const totalLevy = aiClosedTrades.reduce((s, t) => s + (t.adminLevy || 0), 0);
        const netRealized = grossRealized - totalLevy;
        const unrealized = aiOpenPositions.reduce((s, p) => s + p.unrealizedPnl, 0);
        const totalPnl = netRealized + unrealized;
        const equity = Math.max(0, allocation + totalPnl);
        const pnlPct = allocation > 0 ? (totalPnl / allocation) * 100 : 0;
        const wins = aiClosedTrades.filter(t => t.realizedPnl > 0).length;
        const winRate = aiClosedTrades.length > 0 ? Math.round((wins / aiClosedTrades.length) * 100) : 0;
        return {
          totalBalance: equity, totalPnl, totalPnlPercent: pnlPct,
          dayPnl: unrealized, dayPnlPercent: allocation > 0 ? (unrealized / allocation) * 100 : 0,
          openPositions: aiOpenPositions.length, activeSignals: 0, winRate, totalTrades: aiClosedTrades.length,
        };
      })()
    : portfolio || {
        totalBalance: allocation > 0 ? allocation : linkedBalance,
        totalPnl: 0, totalPnlPercent: 0,
        dayPnl: 0, dayPnlPercent: 0,
        openPositions: aiOpenPositions.length,
        activeSignals: 0, winRate: 0, totalTrades: botConfig.totalTrades,
      };

  const isPnlUp = effectivePortfolio.dayPnl >= 0;
  const isTotalUp = effectivePortfolio.totalPnl >= 0;

  return (
    <div className="space-y-2 lg:space-y-3">
      {/* Account mode indicator */}
      <div className="flex items-center gap-2">
        <span className={`flex h-2 w-2 rounded-full ${isLinkedBroker ? 'bg-primary' : isLiveAccount ? 'bg-emerald-500' : 'bg-amber-500'}`} />
        <span className="text-xs font-semibold">
          {activeAccount ? activeAccount.broker.toUpperCase() : 'DEMO'}
        </span>
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
          isLinkedBroker ? 'bg-primary/10 text-primary' : isLiveAccount ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500'
        }`}>
          {isLinkedBroker ? 'LINKED' : isLiveAccount ? 'REAL' : 'DEMO'}
        </span>
        {totalAllocated > 0 && (
          <span className="text-[10px] text-muted-foreground ml-auto">
            ${totalAllocated.toLocaleString(undefined, { minimumFractionDigits: 2 })} allocated to AI bot
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 lg:gap-3">
        {/* Portfolio Value */}
        <Card className={`${isPnlUp ? 'bg-emerald-500/5' : 'bg-red-500/5'} border-border/30 overflow-hidden col-span-2 lg:col-span-1`}>
          <CardContent className="p-3 lg:p-4">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1.5">
                <Wallet className={`h-3.5 w-3.5 ${isPnlUp ? 'text-emerald-500' : 'text-red-500'}`} />
                <span className="text-[11px] text-muted-foreground font-medium">Portfolio Value</span>
              </div>
              {wsConnected && (
                <span className="flex items-center gap-0.5 text-[9px] text-emerald-500 font-medium">
                  <Radio className="h-2.5 w-2.5" /> STREAMING
                </span>
              )}
            </div>
            <p className={`text-lg lg:text-xl font-bold tabular-nums tracking-tight ${isPnlUp ? 'text-emerald-500' : 'text-red-500'}`}>
              {'$'}{effectivePortfolio.totalBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {isPnlUp ? '+' : ''}{effectivePortfolio.dayPnlPercent.toFixed(2)}% today
            </p>
            <EquitySparkline portfolio={effectivePortfolio} />
          </CardContent>
        </Card>

        {/* Available Balance */}
        <Card className="bg-muted/30 border-border/30 overflow-hidden">
          <CardContent className="p-3 lg:p-4">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Wallet className="h-3.5 w-3.5 text-foreground" />
              <span className="text-[11px] text-muted-foreground font-medium">Available</span>
            </div>
            <p className="text-lg lg:text-xl font-bold tabular-nums">
              {'$'}{availableBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              of ${linkedBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })} linked
            </p>
          </CardContent>
        </Card>

        {/* Unrealized P&L */}
        <Card className={`${isTotalUp ? 'bg-emerald-500/5' : 'bg-red-500/5'} border-border/30 overflow-hidden`}>
          <CardContent className="p-3 lg:p-4">
            <div className="flex items-center gap-1.5 mb-1.5">
              {isTotalUp ? <TrendingUp className="h-3.5 w-3.5 text-emerald-500" /> : <TrendingDown className="h-3.5 w-3.5 text-red-500" />}
              <span className="text-[11px] text-muted-foreground font-medium">Unrealized P&L</span>
            </div>
            <p className={`text-lg lg:text-xl font-bold tabular-nums tracking-tight ${isTotalUp ? 'text-emerald-500' : 'text-red-500'}`}>
              {formatPnl(effectivePortfolio.totalPnl)}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {isTotalUp ? '+' : ''}{effectivePortfolio.totalPnlPercent.toFixed(2)}%
            </p>
          </CardContent>
        </Card>

        {/* Risk Score */}
        <Card className="bg-amber-500/5 border-border/30 overflow-hidden">
          <CardContent className="p-3 lg:p-4">
            <RiskGauge portfolio={effectivePortfolio} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ============================================================
// Ticker Strip
// ============================================================
function TickerStrip() {
  const { livePrices, allSymbols, wsConnected, setSelectedSymbol, setAllSymbols, setActiveTab } = useTradingStore();
  const prices = livePrices.length > 0 ? livePrices : allSymbols;
  const topMovers = useMemo(() =>
    [...prices].sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent)).slice(0, 12),
    [prices]
  );

  useEffect(() => {
    if (livePrices.length > 0) setAllSymbols(livePrices);
  }, [livePrices, setAllSymbols]);

  if (topMovers.length === 0) return null;

  return (
    <div className="border-b border-border/50 bg-muted/20">
      <ScrollArea className="w-full">
        <div className="flex gap-4 px-4 py-1.5 min-w-max">
          {topMovers.map(sym => {
            const isUp = sym.changePercent >= 0;
            return (
              <button key={sym.symbol} onClick={() => { setSelectedSymbol(sym.symbol); setActiveTab('markets'); }}
                className="flex items-center gap-1.5 shrink-0 hover:opacity-80 transition-opacity cursor-pointer">
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
// Simple Markdown renderer
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
          const parts = text.split(/(\*\*[^*]+\*\*)/);
          return (
            <p key={j} className="ml-2 flex items-start gap-1">
              <span className="text-primary mt-0.5">•</span>
              <span>{parts.map((part, k) =>
                part.startsWith('**') && part.endsWith('**') ? <strong key={k}>{part.replace(/\*\*/g, '')}</strong> : part
              )}</span>
            </p>
          );
        }
        const parts = line.split(/(\*\*[^*]+\*\*)/);
        if (line.startsWith('*') && line.endsWith('*') && !line.includes(' ')) {
          return <p key={j} className="text-xs opacity-60 mt-2 italic">{line.replace(/\*/g, '')}</p>;
        }
        return <p key={j}>{parts.map((part, k) =>
          part.startsWith('**') && part.endsWith('**') ? <strong key={k}>{part.replace(/\*\*/g, '')}</strong> : part
        )}</p>;
      })}
    </>
  );
}

// ============================================================
// AI Chat Sheet
// ============================================================
function AiChatSheet() {
  const { aiChatOpen, setAiChatOpen, selectedSymbol, wsConnected } = useTradingStore();
  const [messages, setMessages] = useState<{ role: string; content: string; offline?: boolean }[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sessionIdRef = useRef('');
  const loadedRef = useRef(false);

  // Stable session ID from localStorage
  if (!sessionIdRef.current && typeof window !== 'undefined') {
    sessionIdRef.current = localStorage.getItem('fovi_chat_session') || `sess_${Date.now()}`;
    localStorage.setItem('fovi_chat_session', sessionIdRef.current);
  }

  // Load conversation history on mount
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    fetch(`/api/trading/ai-chat?sessionId=${sessionIdRef.current}`)
      .then(r => r.json())
      .then(data => {
        if (data.messages?.length > 0) {
          setMessages(data.messages.map((m: { role: string; content: string }) => ({ role: m.role, content: m.content })));
        } else {
          setMessages([{
            role: 'assistant',
            content: `Welcome to **Fovi AI**. I'm your intelligent trading assistant with real-time market analysis capabilities.\n\nI can help you with:\n• **Technical Analysis** — RSI, MACD, Bollinger Bands, patterns\n• **Trade Ideas** — Entry, stop-loss, take-profit levels\n• **Risk Management** — Position sizing and portfolio analysis\n• **Market Insights** — Real-time market commentary\n\nTry asking: \"Analyze AAPL\" or \"What's the crypto market doing?"`,
          }]);
        }
      })
      .catch(() => {
        setMessages([{
          role: 'assistant',
          content: `Welcome to **Fovi AI**. I'm your intelligent trading assistant.\n\nAsk me to analyze any symbol or get market insights!`,
        }]);
      });
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (aiChatOpen && inputRef.current) setTimeout(() => inputRef.current?.focus(), 300);
  }, [aiChatOpen]);

  const handleClear = useCallback(async () => {
    try {
      await fetch(`/api/trading/ai-chat?sessionId=${sessionIdRef.current}`, { method: 'DELETE' });
    } catch { /* non-critical */ }
    // Generate a new session so old messages don't reload
    const newSession = `sess_${Date.now()}`;
    localStorage.setItem('fovi_chat_session', newSession);
    sessionIdRef.current = newSession;
    setMessages([{
      role: 'assistant',
      content: 'Conversation cleared. How can I help you with your trading today?',
    }]);
  }, []);

  const handleSend = useCallback(async () => {
    if (!input.trim() || sending) return;
    const userMsg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setSending(true);
    try {
      const res = await fetch('/api/trading/ai-chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg, sessionId: sessionIdRef.current }),
      });
      const data = await res.json();
      if (data.success) {
        setMessages(prev => [...prev, { role: 'assistant', content: data.response, offline: !!data.offline }]);
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
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col overflow-hidden">
        <SheetHeader className="px-5 pt-5 pb-4 border-b border-border shrink-0">
          <SheetTitle className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-500/20">
              <Sparkles className="h-4.5 w-4.5 text-white" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-bold">Fovi AI</span>
                <Badge variant="outline" className={`text-[9px] h-4 ${wsConnected ? 'text-emerald-500 border-emerald-500/30 bg-emerald-500/5' : 'text-muted-foreground'}`}>
                  {wsConnected ? 'Online' : 'Offline'}
                </Badge>
              </div>
              <p className="text-[11px] text-muted-foreground">AI Trading Assistant</p>
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8 cursor-pointer"
              onClick={handleClear}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </SheetTitle>
        </SheetHeader>

        <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0 px-5 py-4 space-y-4">
          {messages.map((msg, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[88%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                msg.role === 'user' ? 'bg-primary text-primary-foreground rounded-br-md' : 'bg-muted rounded-bl-md'
              }`}>
                <MarkdownContent content={msg.content} />
              </div>
            </motion.div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-2xl rounded-bl-md px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                  <span className="text-xs text-muted-foreground">Analyzing...</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {messages.length <= 2 && !sending && (
          <div className="px-5 pb-2 flex gap-2 overflow-x-auto">
            {quickActions.map(action => (
              <button key={action.label} onClick={() => setInput(action.prompt)}
                className="shrink-0 px-3 py-1.5 text-xs font-medium rounded-full border border-border hover:bg-accent transition-colors cursor-pointer">
                {action.label}
              </button>
            ))}
          </div>
        )}

        <div className="p-4 border-t border-border shrink-0">
          <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="flex gap-2">
            <input ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
              placeholder="Ask about any market, signal, or trade..."
              className="flex-1 h-10 px-4 rounded-xl bg-muted text-sm outline-none focus:ring-2 focus:ring-primary/50 transition-shadow"
              disabled={sending} />
            <Button type="submit" size="icon" disabled={sending || !input.trim()} className="h-10 w-10 rounded-xl cursor-pointer">
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
// Alerts Sheet
// ============================================================

function AlertsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { alerts, addAlert, removeAlert, allSymbols } = useTradingStore();
  const [showForm, setShowForm] = useState(false);
  const [newSymbol, setNewSymbol] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [newCondition, setNewCondition] = useState<'above' | 'below'>('above');

  const handleAdd = () => {
    if (!newSymbol || !newPrice) return;
    const sym = allSymbols.find(s => s.symbol.toUpperCase() === newSymbol.toUpperCase());
    addAlert({
      id: Date.now().toString(), symbol: newSymbol.toUpperCase(), condition: newCondition,
      targetPrice: parseFloat(newPrice), currentPrice: sym?.price || 0, triggered: false,
    });
    setNewSymbol(''); setNewPrice(''); setShowForm(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md flex flex-col overflow-hidden">
        <SheetHeader className="px-5 pt-5 pb-4 border-b border-border shrink-0">
          <SheetTitle className="flex items-center gap-2 pr-8">
            <Bell className="h-5 w-5" />
            Price Alerts
            <Badge variant="secondary" className="text-[10px] ml-auto">{alerts.length}</Badge>
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto min-h-0 px-5 py-4 space-y-3">
          {!showForm ? (
            <Button variant="outline" className="w-full gap-2 border-dashed cursor-pointer" onClick={() => setShowForm(true)}>
              <Plus className="h-4 w-4" /> Create Alert
            </Button>
          ) : (
            <div className="p-4 rounded-xl border border-primary/30 bg-primary/5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">New Price Alert</span>
                <button onClick={() => setShowForm(false)} className="cursor-pointer"><X className="h-4 w-4 text-muted-foreground" /></button>
              </div>
              <input value={newSymbol} onChange={e => setNewSymbol(e.target.value)} placeholder="Symbol (e.g. BTC)"
                className="w-full h-9 px-3 rounded-lg bg-muted text-sm outline-none focus:ring-2 focus:ring-primary/50" />
              <div className="flex gap-2">
                <button onClick={() => setNewCondition('above')}
                  className={`flex-1 p-2 rounded-lg text-xs font-medium border cursor-pointer transition-colors ${newCondition === 'above' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500' : 'border-border'}`}>
                  Price Above
                </button>
                <button onClick={() => setNewCondition('below')}
                  className={`flex-1 p-2 rounded-lg text-xs font-medium border cursor-pointer transition-colors ${newCondition === 'below' ? 'bg-red-500/10 border-red-500/30 text-red-500' : 'border-border'}`}>
                  Price Below
                </button>
              </div>
              <input type="number" value={newPrice} onChange={e => setNewPrice(e.target.value)} placeholder="Target price"
                className="w-full h-9 px-3 rounded-lg bg-muted text-sm outline-none focus:ring-2 focus:ring-primary/50" />
              <Button onClick={handleAdd} className="w-full cursor-pointer" size="sm">Create Alert</Button>
            </div>
          )}

          {alerts.length === 0 && (
            <div className="text-center py-8 text-muted-foreground text-sm">
              <Bell className="h-8 w-8 mx-auto mb-2 opacity-30" />
              No alerts set. Create one above.
            </div>
          )}

          {alerts.map(alert => {
            const diff = alert.currentPrice > 0 ? ((alert.targetPrice - alert.currentPrice) / alert.currentPrice * 100) : 0;
            return (
              <SwipeableItem key={alert.id} onSwipe={() => removeAlert(alert.id)} className="mb-3">
                <div className="flex items-center gap-3 p-3 rounded-xl bg-card border border-border/50 hover:border-border transition-colors">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                    alert.triggered ? 'bg-amber-500/15' : alert.condition === 'above' ? 'bg-emerald-500/15' : 'bg-red-500/15'
                  }`}>
                    {alert.triggered ? <AlertTriangle className={`h-4 w-4 text-amber-500`} /> : alert.condition === 'above'
                      ? <TrendingUp className="h-4 w-4 text-emerald-500" /> : <TrendingDown className="h-4 w-4 text-red-500" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold">{alert.symbol}</span>
                      <Badge variant={alert.triggered ? 'secondary' : 'outline'}
                        className={`text-[9px] ${alert.triggered ? 'bg-amber-500/10 text-amber-500' : ''}`}>
                        {alert.triggered ? 'Triggered' : alert.condition === 'above' ? 'Above $' + alert.targetPrice.toLocaleString() : 'Below $' + alert.targetPrice.toLocaleString()}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground tabular-nums">
                      Current: ${alert.currentPrice.toLocaleString()} · {diff >= 0 ? '+' : ''}{diff.toFixed(2)}%
                    </p>
                  </div>
                  <button onClick={() => removeAlert(alert.id)} className="cursor-pointer p-1 hover:bg-muted rounded-lg transition-colors">
                    <X className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                </div>
              </SwipeableItem>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ============================================================
// Order History Tab
// ============================================================
function OrderHistoryPanel() {
  const sampleOrders = [
    { id: 'o1', symbol: 'AAPL', side: 'buy', type: 'market', qty: 50, filledPrice: 195.42, status: 'filled', time: '2 min ago' },
    { id: 'o2', symbol: 'BTC', side: 'sell', type: 'limit', qty: 0.5, filledPrice: 68200, status: 'filled', time: '15 min ago' },
    { id: 'o3', symbol: 'NVDA', side: 'buy', type: 'limit', qty: 30, filledPrice: null, status: 'pending', time: '1 hr ago' },
    { id: 'o4', symbol: 'ETH', side: 'sell', type: 'stop', qty: 2, filledPrice: null, status: 'cancelled', time: '3 hrs ago' },
    { id: 'o5', symbol: 'TSLA', side: 'buy', type: 'market', qty: 20, filledPrice: 248.15, status: 'filled', time: '5 hrs ago' },
    { id: 'o6', symbol: 'GOOGL', side: 'sell', type: 'limit', qty: 15, filledPrice: 178.90, status: 'filled', time: '1 day ago' },
  ];

  const statusConfig: Record<string, { color: string; bg: string }> = {
    filled: { color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
    pending: { color: 'text-amber-500', bg: 'bg-amber-500/10' },
    cancelled: { color: 'text-muted-foreground', bg: 'bg-muted' },
    rejected: { color: 'text-red-500', bg: 'bg-red-500/10' },
    partially_filled: { color: 'text-blue-500', bg: 'bg-blue-500/10' },
  };

  return (
    <div className="divide-y divide-border">
      {sampleOrders.map(order => {
        const sc = statusConfig[order.status] || statusConfig.pending;
        return (
          <div key={order.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors cursor-pointer">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${order.side === 'buy' ? 'bg-emerald-500/10' : 'bg-red-500/10'}`}>
              {order.side === 'buy' ? <ArrowUpRight className="h-4 w-4 text-emerald-500" /> : <ArrowDownRight className="h-4 w-4 text-red-500" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold">{order.symbol}</span>
                <Badge variant="outline" className="text-[9px] uppercase">{order.type}</Badge>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {order.qty} shares · {order.filledPrice ? `$${order.filledPrice.toLocaleString()}` : '—'}
              </p>
            </div>
            <div className="text-right shrink-0">
              <Badge className={`text-[10px] h-5 ${sc.bg} ${sc.color} border-0`}>{order.status}</Badge>
              <p className="text-[10px] text-muted-foreground mt-1">{order.time}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// Tab Button helper for settings
// ============================================================
function SettingsTab({ id, label, icon: Icon, active, onClick }: { id: string; label: string; icon: React.ComponentType<{ className?: string }>; active: boolean; onClick: (id: string) => void }) {
  return (
    <button onClick={() => onClick(id)}
      className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'}`}>
      <Icon className="h-3.5 w-3.5" />{label}
    </button>
  );
}

// ============================================================
// Security Settings (2FA, SMS/Email OTP, Password, Subscription)
// ============================================================
function SecuritySettings() {
  const { authUser, clearAuth } = useTradingStore();
  const [activeSection, setActiveSection] = useState('security');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // 2FA state
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [qrCode, setQrCode] = useState('');
  const [setupSecret, setSetupSecret] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [disableCode, setDisableCode] = useState('');

  // Password state
  const [passwords, setPasswords] = useState({ current: '', newPw: '', confirm: '' });

  // SMS OTP state
  const [smsPhone, setSmsPhone] = useState('');
  const [smsOtpCode, setSmsOtpCode] = useState('');
  const [smsOtpSent, setSmsOtpSent] = useState(false);
  const [smsCountdown, setSmsCountdown] = useState(0);
  const [smsOtpEnabled, setSmsOtpEnabled] = useState(false);

  // Email OTP state
  const [emailOtpCode, setEmailOtpCode] = useState('');
  const [emailOtpSent, setEmailOtpSent] = useState(false);
  const [emailCountdown, setEmailCountdown] = useState(0);
  const [emailOtpEnabled, setEmailOtpEnabled] = useState(false);

  // Subscription state
  const [currentPlan, setCurrentPlan] = useState<any>(null);
  const [plans, setPlans] = useState<any[]>([]);
  const [subscribingPlan, setSubscribingPlan] = useState<string | null>(null);

  // Admin subscription management state
  const [adminUsers, setAdminUsers] = useState<any[]>([]);
  const [adminSubs, setAdminSubs] = useState<any[]>([]);
  const [sendLinkUser, setSendLinkUser] = useState('');
  const [sendLinkPlan, setSendLinkPlan] = useState('');
  const [sendLinkPhone, setSendLinkPhone] = useState('');
  const [allPlans, setAllPlans] = useState<any[]>([]);

  // Admin config state
  const [hubtelSmsConfig, setHubtelSmsConfig] = useState({ clientId: '', clientSecret: '', senderName: 'FoviAI' });
  const [hubtelPayConfig, setHubtelPayConfig] = useState({ clientId: '', clientSecret: '', accountNumber: '', callbackUrl: '' });
  const [smtpConfig, setSmtpConfig] = useState({ host: '', port: '587', user: '', password: '', from: 'noreply@fovi.ai' });
  const [testPhone, setTestPhone] = useState('');
  const [testEmail, setTestEmail] = useState('');

  // Trading config state
  const [tradingConfig, setTradingConfig] = useState({
    defaultAdminLevyPercent: 10,
    defaultMaxPositions: 5,
    defaultStopLossPercent: 2.0,
    defaultTakeProfitPercent: 4.0,
    defaultMaxPositionSizePercent: 20,
  });

  // OTP config state
  const [otpConfig, setOtpConfig] = useState({ codeLength: 6, expiryMinutes: 10, maxAttempts: 5 });

  // Platform config state
  const [platformConfig, setPlatformConfig] = useState({ platformName: 'Fovi AI', supportEmail: 'support@fovi.ai', platformUrl: '' });

  // User management state
  const [showUserMgmt, setShowUserMgmt] = useState(false);
  const [resetPwUserId, setResetPwUserId] = useState<string | null>(null);
  const [resetPwValue, setResetPwValue] = useState('');

  // Plan edit state
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [editPlanForm, setEditPlanForm] = useState({ name: '', displayName: '', price: '', features: '', maxBots: '5', maxAccounts: '2' });
  const [showCreatePlan, setShowCreatePlan] = useState(false);
  const [newPlanForm, setNewPlanForm] = useState({ name: '', displayName: '', price: '', features: '', maxBots: '5', maxAccounts: '2' });

  const isAdmin = authUser?.role === 'admin' || authUser?.email === 'admin@fovi.ai';
  const token = typeof window !== 'undefined' ? localStorage.getItem('fovi_token') || '' : '';

  const showMsg = (type: 'success' | 'error', text: string) => { setMsg({ type, text }); setTimeout(() => setMsg(null), 5000); };

  // Load user settings on mount
  useEffect(() => {
    if (!authUser?.id) return;
    (async () => {
      try {
        const res = await fetch('/api/auth/two-factor/setup', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ _check: true }),
        });
        if (res.ok) { const d = await res.json(); if (d.twoFactorEnabled) setTwoFactorEnabled(true); }
      } catch { /* ignore */ }
      // Load subscription
      try {
        const subRes = await fetch('/api/subscriptions/current', { headers: { Authorization: `Bearer ${token}` } });
        if (subRes.ok) { const subData = await subRes.json(); if (subData.subscription) setCurrentPlan(subData.subscription); }
      } catch { /* ignore */ }
      // Load plans
      try {
        const plansRes = await fetch('/api/subscriptions/plans');
        if (plansRes.ok) { const plansData = await plansRes.json(); if (Array.isArray(plansData)) setPlans(plansData); }
      } catch { /* ignore */ }
      // Load admin configs
      if (isAdmin) {
        try {
          const [smsRes, payRes, smtpRes, tradingRes, otpRes, platformRes] = await Promise.all([
            fetch('/api/admin/config/hubtel-sms', { headers: { Authorization: `Bearer ${token}` } }),
            fetch('/api/admin/config/hubtel-payment', { headers: { Authorization: `Bearer ${token}` } }),
            fetch('/api/admin/config/smtp', { headers: { Authorization: `Bearer ${token}` } }),
            fetch('/api/admin/config/trading', { headers: { Authorization: `Bearer ${token}` } }),
            fetch('/api/admin/config/otp', { headers: { Authorization: `Bearer ${token}` } }),
            fetch('/api/admin/config/platform', { headers: { Authorization: `Bearer ${token}` } }),
          ]);
          if (smsRes.ok) { const d = await smsRes.json(); if (d.config) setHubtelSmsConfig(p => ({ ...p, ...d.config })); }
          if (payRes.ok) { const d = await payRes.json(); if (d.config) setHubtelPayConfig(p => ({ ...p, ...d.config })); }
          if (smtpRes.ok) { const d = await smtpRes.json(); if (d.config) setSmtpConfig(p => ({ ...p, ...d.config })); }
          if (tradingRes.ok) { const d = await tradingRes.json(); setTradingConfig(p => ({ ...p, ...d })); }
          if (otpRes.ok) { const d = await otpRes.json(); setOtpConfig(p => ({ ...p, ...d })); }
          if (platformRes.ok) { const d = await platformRes.json(); setPlatformConfig(p => ({ ...p, ...d })); }
        } catch { /* ignore */ }
      }
    })();
  }, [authUser?.id]);

  // SMS countdown timer
  useEffect(() => { if (smsCountdown <= 0) return; const t = setTimeout(() => setSmsCountdown(smsCountdown - 1), 1000); return () => clearTimeout(t); }, [smsCountdown]);
  // Email countdown timer
  useEffect(() => { if (emailCountdown <= 0) return; const t = setTimeout(() => setEmailCountdown(emailCountdown - 1), 1000); return () => clearTimeout(t); }, [emailCountdown]);

  // 2FA handlers
  const handleSetup2FA = async () => {
    if (!authUser?.id) return;
    setLoading(true);
    try {
      const res = await fetch('/api/auth/two-factor/setup', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (!res.ok) { showMsg('error', data.error || 'Failed to setup 2FA'); return; }
      setQrCode(data.qr_code_base64); setSetupSecret(data.secret); setShowSetup(true);
    } catch { showMsg('error', 'Network error'); } finally { setLoading(false); }
  };
  const handleVerify2FA = async () => {
    if (!authUser?.id) return; setLoading(true);
    try {
      const res = await fetch('/api/auth/two-factor/verify', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ code: verifyCode }) });
      const data = await res.json();
      if (!res.ok) { showMsg('error', data.error || 'Invalid code'); return; }
      setTwoFactorEnabled(true); setShowSetup(false); setVerifyCode(''); showMsg('success', 'Two-factor authentication enabled!');
    } catch { showMsg('error', 'Network error'); } finally { setLoading(false); }
  };
  const handleDisable2FA = async () => {
    if (!authUser?.id) return; setLoading(true);
    try {
      const res = await fetch('/api/auth/two-factor/disable', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ code: disableCode }) });
      const data = await res.json();
      if (!res.ok) { showMsg('error', data.error || 'Invalid code'); return; }
      setTwoFactorEnabled(false); setDisableCode(''); showMsg('success', '2FA disabled');
    } catch { showMsg('error', 'Network error'); } finally { setLoading(false); }
  };

  // Password handler
  const handleChangePassword = async () => {
    if (!passwords.current || !passwords.newPw || !passwords.confirm) return;
    if (passwords.newPw !== passwords.confirm) { showMsg('error', 'Passwords do not match'); return; }
    if (passwords.newPw.length < 8) { showMsg('error', 'Password must be at least 8 characters'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/change-password', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ currentPassword: passwords.current, newPassword: passwords.newPw }) });
      const data = await res.json();
      if (!res.ok) { showMsg('error', data.error || 'Failed to change password'); return; }
      setPasswords({ current: '', newPw: '', confirm: '' }); showMsg('success', 'Password changed successfully');
    } catch { showMsg('error', 'Network error'); } finally { setLoading(false); }
  };

  // SMS OTP handlers
  const handleSendSmsOtp = async () => {
    if (!smsPhone || !/^\+\d{10,15}$/.test(smsPhone)) { showMsg('error', 'Enter a valid phone number (e.g. +233XXXXXXXXX)'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/sms-otp/send', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ phoneNumber: smsPhone, purpose: 'verification' }) });
      const data = await res.json();
      if (!res.ok) { showMsg('error', data.error || 'Failed to send SMS OTP'); return; }
      setSmsOtpSent(true); setSmsCountdown(60); showMsg('success', 'SMS OTP sent!');
    } catch { showMsg('error', 'Network error'); } finally { setLoading(false); }
  };
  const handleVerifySmsOtp = async () => {
    if (smsOtpCode.length !== 6) return; setLoading(true);
    try {
      const res = await fetch('/api/auth/sms-otp/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: smsOtpCode, phoneNumber: smsPhone, purpose: 'verification' }) });
      const data = await res.json();
      if (!res.ok) { showMsg('error', data.error || 'Invalid OTP'); return; }
      setSmsOtpEnabled(true); setSmsOtpCode(''); setSmsOtpSent(false); showMsg('success', 'SMS OTP verified and enabled!');
    } catch { showMsg('error', 'Network error'); } finally { setLoading(false); }
  };

  // Email OTP handlers
  const handleSendEmailOtp = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/auth/email-otp/send', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ email: authUser?.email, purpose: 'verification' }) });
      const data = await res.json();
      if (!res.ok) { showMsg('error', data.error || 'Failed to send Email OTP'); return; }
      setEmailOtpSent(true); setEmailCountdown(60); showMsg('success', 'Email OTP sent!');
    } catch { showMsg('error', 'Network error'); } finally { setLoading(false); }
  };
  const handleVerifyEmailOtp = async () => {
    if (emailOtpCode.length !== 6) return; setLoading(true);
    try {
      const res = await fetch('/api/auth/email-otp/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: emailOtpCode, email: authUser?.email, purpose: 'verification' }) });
      const data = await res.json();
      if (!res.ok) { showMsg('error', data.error || 'Invalid OTP'); return; }
      setEmailOtpEnabled(true); setEmailOtpCode(''); setEmailOtpSent(false); showMsg('success', 'Email OTP verified and enabled!');
    } catch { showMsg('error', 'Network error'); } finally { setLoading(false); }
  };

  // Subscription handler
  const handleSubscribe = async (planId: string) => {
    setSubscribingPlan(planId); setLoading(true);
    try {
      const res = await fetch('/api/subscriptions/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ planId, phoneNumber: smsPhone, email: authUser?.email }) });
      const data = await res.json();
      if (!res.ok) { showMsg('error', data.error || 'Subscription failed'); return; }
      if (data.invoiceUrl) { window.open(data.invoiceUrl, '_blank'); showMsg('success', 'Payment page opened! Complete payment to activate.'); }
    } catch { showMsg('error', 'Network error'); } finally { setLoading(false); setSubscribingPlan(null); }
  };

  // Admin config save handlers
  const saveHubtelSms = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/config/hubtel-sms', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(hubtelSmsConfig) });
      const data = await res.json();
      if (!res.ok) { showMsg('error', data.error || 'Failed to save'); return; }
      showMsg('success', 'Hubtel SMS config saved!');
    } catch { showMsg('error', 'Network error'); } finally { setLoading(false); }
  };
  const saveHubtelPay = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/config/hubtel-payment', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(hubtelPayConfig) });
      const data = await res.json();
      if (!res.ok) { showMsg('error', data.error || 'Failed to save'); return; }
      showMsg('success', 'Hubtel Payment config saved!');
    } catch { showMsg('error', 'Network error'); } finally { setLoading(false); }
  };
  const saveSmtp = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/config/smtp', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(smtpConfig) });
      const data = await res.json();
      if (!res.ok) { showMsg('error', data.error || 'Failed to save'); return; }
      showMsg('success', 'SMTP config saved!');
    } catch { showMsg('error', 'Network error'); } finally { setLoading(false); }
  };
  const handleTestSms = async () => {
    if (!testPhone) { showMsg('error', 'Enter a phone number'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/admin/config/hubtel-sms', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ _action: 'test', phoneNumber: testPhone }) });
      const data = await res.json();
      if (!res.ok) { showMsg('error', data.error || 'Test failed'); return; }
      showMsg('success', 'Test SMS sent!');
    } catch { showMsg('error', 'Network error'); } finally { setLoading(false); }
  };
  const handleTestEmail = async () => {
    if (!testEmail) { showMsg('error', 'Enter an email address'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/admin/config/email-test', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ to: testEmail }) });
      const data = await res.json();
      if (!res.ok) { showMsg('error', data.error || 'Test failed'); return; }
      showMsg('success', 'Test email sent!');
    } catch { showMsg('error', 'Network error'); } finally { setLoading(false); }
  };

  // Config input helper
  const CInput = ({ value, onChange, placeholder, type = 'text' }: { value: string; onChange: (v: string) => void; placeholder: string; type?: string }) => (
    <input type={type} placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)}
      className="w-full h-9 px-3 rounded-lg bg-muted text-sm outline-none focus:ring-2 focus:ring-primary/50" />
  );

  // Admin subscription management handlers
  const loadAdminSubData = async () => {
    if (!isAdmin) return;
    try {
      const [usersRes, subsRes, plansRes] = await Promise.all([
        fetch('/api/admin/users', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/admin/subscriptions', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/subscriptions/plans', { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (usersRes.ok) { const d = await usersRes.json(); if (d.users) setAdminUsers(d.users); }
      if (subsRes.ok) { const d = await subsRes.json(); if (d.subscriptions) setAdminSubs(d.subscriptions); }
      if (plansRes.ok) { const d = await plansRes.json(); if (Array.isArray(d)) { setAllPlans(d); setPlans(d); } }
    } catch { /* ignore */ }
  };

  const handleSendPaymentLink = async () => {
    if (!sendLinkUser || !sendLinkPlan) { showMsg('error', 'Select a user and a plan'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/admin/subscriptions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ userId: sendLinkUser, planId: sendLinkPlan, phoneNumber: sendLinkPhone || undefined }),
      });
      const data = await res.json();
      if (!res.ok) { showMsg('error', data.error || 'Failed to send payment link'); return; }
      if (data.invoiceUrl) { window.open(data.invoiceUrl, '_blank'); showMsg('success', `Payment link sent to ${data.user?.email || 'user'} for ${data.plan}`); }
      setSendLinkUser(''); setSendLinkPlan(''); setSendLinkPhone('');
      loadAdminSubData();
    } catch { showMsg('error', 'Network error'); } finally { setLoading(false); }
  };

  // Save trading config
  const saveTradingConfig = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/config/trading', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(tradingConfig) });
      const data = await res.json();
      if (!res.ok) { showMsg('error', data.error || 'Failed to save'); return; }
      showMsg('success', 'Trading config saved!');
    } catch { showMsg('error', 'Network error'); } finally { setLoading(false); }
  };

  // Save OTP config
  const saveOtpConfig = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/config/otp', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(otpConfig) });
      const data = await res.json();
      if (!res.ok) { showMsg('error', data.error || 'Failed to save'); return; }
      showMsg('success', 'OTP config saved!');
    } catch { showMsg('error', 'Network error'); } finally { setLoading(false); }
  };

  // Save platform config
  const savePlatformConfig = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/config/platform', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(platformConfig) });
      const data = await res.json();
      if (!res.ok) { showMsg('error', data.error || 'Failed to save'); return; }
      showMsg('success', 'Platform config saved!');
    } catch { showMsg('error', 'Network error'); } finally { setLoading(false); }
  };

  // User management handlers
  const handleToggleUserActive = async (userId: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: 'toggle_active' }) });
      const data = await res.json();
      if (!res.ok) { showMsg('error', data.error || 'Failed to update user'); return; }
      showMsg('success', data.message);
      loadAdminSubData();
    } catch { showMsg('error', 'Network error'); } finally { setLoading(false); }
  };

  const handleResetUserPassword = async (userId: string) => {
    if (!resetPwValue || resetPwValue.length < 8) { showMsg('error', 'Password must be at least 8 characters'); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: 'reset_password', newPassword: resetPwValue }) });
      const data = await res.json();
      if (!res.ok) { showMsg('error', data.error || 'Failed to reset password'); return; }
      showMsg('success', data.message);
      setResetPwUserId(null); setResetPwValue('');
    } catch { showMsg('error', 'Network error'); } finally { setLoading(false); }
  };

  const handleDeleteUser = async (userId: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (!res.ok) { showMsg('error', data.error || 'Failed to delete user'); return; }
      showMsg('success', data.message);
      loadAdminSubData();
    } catch { showMsg('error', 'Network error'); } finally { setLoading(false); }
  };

  // Plan CRUD handlers
  const handleCreatePlanSubmit = async () => {
    if (!newPlanForm.name || !newPlanForm.displayName || !newPlanForm.price) { showMsg('error', 'Name, display name, and price are required'); return; }
    const price = parseFloat(newPlanForm.price);
    if (isNaN(price) || price < 0) { showMsg('error', 'Invalid price'); return; }
    setLoading(true);
    try {
      const features = newPlanForm.features.split(',').map((f: string) => f.trim()).filter(Boolean);
      const res = await fetch('/api/subscriptions/plans', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: newPlanForm.name.toLowerCase().replace(/\s+/g, '-'), displayName: newPlanForm.displayName, price, currency: 'GHS', features, maxBots: parseInt(newPlanForm.maxBots) || 5, maxAccounts: parseInt(newPlanForm.maxAccounts) || 2 }),
      });
      const data = await res.json();
      if (!res.ok) { showMsg('error', data.error || 'Failed to create plan'); return; }
      showMsg('success', `Plan "${newPlanForm.displayName}" created!`);
      setNewPlanForm({ name: '', displayName: '', price: '', features: '', maxBots: '5', maxAccounts: '2' });
      setShowCreatePlan(false);
      loadAdminSubData();
    } catch { showMsg('error', 'Network error'); } finally { setLoading(false); }
  };

  const handleEditPlan = (plan: any) => {
    setEditingPlanId(plan.id);
    setEditPlanForm({
      name: plan.name || '',
      displayName: plan.displayName || plan.name || '',
      price: String(plan.price || 0),
      features: plan.features ? (typeof plan.features === 'string' ? plan.features : JSON.parse(plan.features)).join(', ') : '',
      maxBots: String(plan.maxBots || 5),
      maxAccounts: String(plan.maxAccounts || 2),
    });
  };

  const handleUpdatePlan = async () => {
    if (!editingPlanId) return;
    if (!editPlanForm.displayName || !editPlanForm.price) { showMsg('error', 'Display name and price are required'); return; }
    const price = parseFloat(editPlanForm.price);
    if (isNaN(price) || price < 0) { showMsg('error', 'Invalid price'); return; }
    setLoading(true);
    try {
      const features = editPlanForm.features.split(',').map((f: string) => f.trim()).filter(Boolean);
      const res = await fetch(`/api/subscriptions/plans/${editingPlanId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ displayName: editPlanForm.displayName, price, currency: 'GHS', features, maxBots: parseInt(editPlanForm.maxBots) || 5, maxAccounts: parseInt(editPlanForm.maxAccounts) || 2 }),
      });
      const data = await res.json();
      if (!res.ok) { showMsg('error', data.error || 'Failed to update plan'); return; }
      showMsg('success', 'Plan updated!');
      setEditingPlanId(null);
      loadAdminSubData();
    } catch { showMsg('error', 'Network error'); } finally { setLoading(false); }
  };

  const handleDeletePlan = async (planId: string, planName: string) => {
    if (!confirm(`Delete plan "${planName}"? This cannot be undone.`)) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/subscriptions/plans/${planId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (!res.ok) { showMsg('error', data.error || 'Failed to delete plan'); return; }
      showMsg('success', 'Plan deleted!');
      loadAdminSubData();
    } catch { showMsg('error', 'Network error'); } finally { setLoading(false); }
  };

  const handleCreatePlan = async () => {
    setShowCreatePlan(true);
  };

  return (
    <div className="space-y-4">
      {msg && (
        <div className={`rounded-lg border px-3 py-2.5 text-xs font-medium ${msg.type === 'success' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500' : 'border-destructive/30 bg-destructive/10 text-destructive'}`}>{msg.text}</div>
      )}

      {/* User Info Card */}
      <div className="p-4 rounded-xl border border-border/50 bg-card">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center"><User className="h-5 w-5 text-primary" /></div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate">{authUser?.name || 'User'}</p>
            <p className="text-[11px] text-muted-foreground truncate">{authUser?.email}</p>
          </div>
          {isAdmin && <Badge className="bg-amber-500/10 text-amber-500 border-0 text-[10px]"><Crown className="h-3 w-3 mr-1" />Admin</Badge>}
        </div>
        <button onClick={() => { clearAuth(); window.location.href = '/'; }}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-red-500/20 text-red-500 text-xs font-medium hover:bg-red-500/10 transition-colors cursor-pointer">
          <LogOut className="h-3.5 w-3.5" /> Sign Out
        </button>
      </div>

      {/* Section Tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1 -mx-1 px-1">
        <SettingsTab id="security" label="Security" icon={Shield} active={activeSection === 'security'} onClick={setActiveSection} />
        <SettingsTab id="sms-email" label="SMS / Email" icon={Smartphone} active={activeSection === 'sms-email'} onClick={setActiveSection} />
        <SettingsTab id="subscription" label="Plan" icon={CreditCard} active={activeSection === 'subscription'} onClick={setActiveSection} />
        {isAdmin && <SettingsTab id="admin-sms" label="Hubtel SMS" icon={MessageCircle} active={activeSection === 'admin-sms'} onClick={setActiveSection} />}
        {isAdmin && <SettingsTab id="admin-pay" label="Payments" icon={Building2} active={activeSection === 'admin-pay'} onClick={setActiveSection} />}
        {isAdmin && <SettingsTab id="admin-smtp" label="SMTP" icon={Server} active={activeSection === 'admin-smtp'} onClick={setActiveSection} />}
        {isAdmin && <SettingsTab id="admin-trading" label="Trading" icon={Target} active={activeSection === 'admin-trading'} onClick={setActiveSection} />}
        {isAdmin && <SettingsTab id="admin-otp" label="OTP" icon={KeyRound} active={activeSection === 'admin-otp'} onClick={setActiveSection} />}
        {isAdmin && <SettingsTab id="admin-platform" label="Branding" icon={Globe} active={activeSection === 'admin-platform'} onClick={setActiveSection} />}
        {isAdmin && <SettingsTab id="admin-users" label="Users" icon={User} active={activeSection === 'admin-users'} onClick={() => { setActiveSection('admin-users'); loadAdminSubData(); }} />}
        {isAdmin && <SettingsTab id="admin-subs" label="Subs Mgmt" icon={Crown} active={activeSection === 'admin-subs'} onClick={() => { setActiveSection('admin-subs'); loadAdminSubData(); }} />}
        {isAdmin && <SettingsTab id="admin-brokers" label="Brokers" icon={Link2} active={activeSection === 'admin-brokers'} onClick={setActiveSection} />}
      </div>

      {/* ====== SECURITY TAB ====== */}
      {activeSection === 'security' && (
        <div className="space-y-4">
          {/* 2FA TOTP */}
          <div className="p-4 rounded-xl border border-border/50 bg-card">
            <h4 className="text-xs font-semibold mb-3 flex items-center gap-1.5">
              <KeyRound className="h-3.5 w-3.5" /> Two-Factor Authentication (TOTP)
              {twoFactorEnabled && <Badge className="ml-auto bg-emerald-500/10 text-emerald-500 border-0 text-[10px]">ON</Badge>}
            </h4>
            {showSetup ? (
              <div className="space-y-3">
                <p className="text-[11px] text-muted-foreground">Scan with Google Authenticator, Authy, or any TOTP app:</p>
                {qrCode && <img src={qrCode} alt="2FA QR" className="mx-auto w-40 h-40 rounded-lg border border-border" />}
                <p className="text-[10px] text-muted-foreground text-center font-mono bg-muted/50 rounded px-2 py-1 break-all">{setupSecret}</p>
                <input type="text" inputMode="numeric" maxLength={6} placeholder="000000" value={verifyCode} onChange={e => setVerifyCode(e.target.value.replace(/\D/g, ''))}
                  className="w-full h-10 px-3 rounded-lg bg-muted text-sm text-center tracking-[0.3em] font-mono outline-none focus:ring-2 focus:ring-primary/50" />
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1 text-xs cursor-pointer" onClick={() => { setShowSetup(false); setQrCode(''); setVerifyCode(''); }} disabled={loading}>Cancel</Button>
                  <Button className="flex-1 text-xs cursor-pointer" onClick={handleVerify2FA} disabled={loading || verifyCode.length !== 6}>
                    {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Verify & Enable'}</Button>
                </div>
              </div>
            ) : twoFactorEnabled ? (
              <div className="space-y-3">
                <p className="text-xs text-emerald-500 font-medium flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" /> 2FA is active</p>
                <input type="text" inputMode="numeric" maxLength={6} placeholder="Enter code to disable" value={disableCode} onChange={e => setDisableCode(e.target.value.replace(/\D/g, ''))}
                  className="w-full h-10 px-3 rounded-lg bg-muted text-sm text-center tracking-[0.3em] font-mono outline-none focus:ring-2 focus:ring-primary/50" />
                <Button variant="outline" className="w-full text-xs text-red-500 border-red-500/20 hover:bg-red-500/10 cursor-pointer"
                  onClick={handleDisable2FA} disabled={loading || disableCode.length !== 6}>
                  {loading ? <Loader2 className="h-3 w-3 animate-spin mr-2" /> : null} Disable 2FA
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-[11px] text-muted-foreground">Add an extra layer of security using an authenticator app.</p>
                <Button variant="outline" className="w-full gap-2 text-xs cursor-pointer" onClick={handleSetup2FA} disabled={loading}>
                  {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />} Enable 2FA
                </Button>
              </div>
            )}
          </div>

          {/* Change Password */}
          <div className="p-4 rounded-xl border border-border/50 bg-card">
            <h4 className="text-xs font-semibold mb-3 flex items-center gap-1.5"><Lock className="h-3.5 w-3.5" /> Change Password</h4>
            <div className="space-y-2">
              <CInput value={passwords.current} onChange={v => setPasswords(p => ({ ...p, current: v }))} placeholder="Current password" type="password" />
              <CInput value={passwords.newPw} onChange={v => setPasswords(p => ({ ...p, newPw: v }))} placeholder="New password (min 8 chars)" type="password" />
              <CInput value={passwords.confirm} onChange={v => setPasswords(p => ({ ...p, confirm: v }))} placeholder="Confirm new password" type="password" />
              <Button className="w-full text-xs cursor-pointer" onClick={handleChangePassword} disabled={loading || !passwords.current || !passwords.newPw || !passwords.confirm}>
                {loading ? <Loader2 className="h-3 w-3 animate-spin mr-2" /> : 'Update Password'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ====== SMS / EMAIL OTP TAB ====== */}
      {activeSection === 'sms-email' && (
        <div className="space-y-4">
          {/* SMS OTP */}
          <div className="p-4 rounded-xl border border-border/50 bg-card">
            <h4 className="text-xs font-semibold mb-2 flex items-center gap-1.5">
              <Smartphone className="h-3.5 w-3.5" /> SMS OTP (Hubtel)
              {smsOtpEnabled && <Badge className="ml-auto bg-emerald-500/10 text-emerald-500 border-0 text-[10px]">Active</Badge>}
            </h4>
            <p className="text-[11px] text-muted-foreground mb-3">Receive one-time codes via SMS for login verification. Requires Hubtel SMS to be configured by admin.</p>
            {!smsOtpSent ? (
              <div className="space-y-2">
                <CInput value={smsPhone} onChange={setSmsPhone} placeholder="+233XXXXXXXXX" />
                <Button variant="outline" className="w-full gap-2 text-xs cursor-pointer" onClick={handleSendSmsOtp} disabled={loading || smsCountdown > 0}>
                  {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                  {smsCountdown > 0 ? `Resend in ${smsCountdown}s` : 'Send SMS OTP'}
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-[11px] text-emerald-500 font-medium">Code sent to {smsPhone}</p>
                <input type="text" inputMode="numeric" maxLength={6} placeholder="000000" value={smsOtpCode} onChange={e => setSmsOtpCode(e.target.value.replace(/\D/g, ''))}
                  className="w-full h-10 px-3 rounded-lg bg-muted text-sm text-center tracking-[0.3em] font-mono outline-none focus:ring-2 focus:ring-primary/50" />
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1 text-xs cursor-pointer" onClick={() => { setSmsOtpSent(false); setSmsOtpCode(''); }} disabled={loading}>Cancel</Button>
                  <Button className="flex-1 text-xs cursor-pointer" onClick={handleVerifySmsOtp} disabled={loading || smsOtpCode.length !== 6}>
                    {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Verify'}</Button>
                </div>
              </div>
            )}
          </div>

          {/* Email OTP */}
          <div className="p-4 rounded-xl border border-border/50 bg-card">
            <h4 className="text-xs font-semibold mb-2 flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5" /> Email OTP
              {emailOtpEnabled && <Badge className="ml-auto bg-emerald-500/10 text-emerald-500 border-0 text-[10px]">Active</Badge>}
            </h4>
            <p className="text-[11px] text-muted-foreground mb-3">Receive one-time codes via email for login verification. Uses configured SMTP.</p>
            <p className="text-[11px] text-muted-foreground mb-2">Email: <span className="font-medium text-foreground">{authUser?.email}</span></p>
            {!emailOtpSent ? (
              <Button variant="outline" className="w-full gap-2 text-xs cursor-pointer" onClick={handleSendEmailOtp} disabled={loading || emailCountdown > 0}>
                {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Mail className="h-3 w-3" />}
                {emailCountdown > 0 ? `Resend in ${emailCountdown}s` : 'Send Email OTP'}
              </Button>
            ) : (
              <div className="space-y-2">
                <p className="text-[11px] text-emerald-500 font-medium">Code sent to {authUser?.email}</p>
                <input type="text" inputMode="numeric" maxLength={6} placeholder="000000" value={emailOtpCode} onChange={e => setEmailOtpCode(e.target.value.replace(/\D/g, ''))}
                  className="w-full h-10 px-3 rounded-lg bg-muted text-sm text-center tracking-[0.3em] font-mono outline-none focus:ring-2 focus:ring-primary/50" />
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1 text-xs cursor-pointer" onClick={() => { setEmailOtpSent(false); setEmailOtpCode(''); }} disabled={loading}>Cancel</Button>
                  <Button className="flex-1 text-xs cursor-pointer" onClick={handleVerifyEmailOtp} disabled={loading || emailOtpCode.length !== 6}>
                    {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Verify'}</Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ====== SUBSCRIPTION TAB ====== */}
      {activeSection === 'subscription' && (
        <div className="space-y-4">
          {currentPlan ? (
            <div className="p-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5">
              <h4 className="text-xs font-semibold mb-1 flex items-center gap-1.5"><Crown className="h-3.5 w-3.5 text-amber-500" /> Current Plan</h4>
              <p className="text-lg font-bold capitalize">{currentPlan.plan}</p>
              <div className="flex items-center gap-2 mt-1">
                <Badge className="bg-emerald-500/10 text-emerald-500 border-0 text-[10px]">Active</Badge>
                <span className="text-[11px] text-muted-foreground">Expires: {new Date(currentPlan.expiresAt).toLocaleDateString()}</span>
              </div>
            </div>
          ) : (
            <div className="p-4 rounded-xl border border-border/50 bg-card">
              <h4 className="text-xs font-semibold mb-1 flex items-center gap-1.5"><Crown className="h-3.5 w-3.5" /> Current Plan</h4>
              <p className="text-sm text-muted-foreground">Free Plan</p>
              <p className="text-[11px] text-muted-foreground mt-1">Upgrade to unlock more bots, accounts, and premium features.</p>
            </div>
          )}

          {plans.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-xs font-semibold">Available Plans</h4>
              {plans.filter((p: any) => p.name !== 'free').map((plan: any) => (
                <div key={plan.id} className="p-4 rounded-xl border border-border/50 bg-card">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <h5 className="text-sm font-bold capitalize">{plan.displayName || plan.name}</h5>
                      {plan.name === 'enterprise' && <Crown className="h-3.5 w-3.5 text-amber-500" />}
                    </div>
                    <div className="text-right">
                      <span className="text-lg font-bold">{plan.currency === 'GHS' ? 'GH₵' : '$'}{plan.price}</span>
                      <span className="text-[10px] text-muted-foreground">/mo</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {(plan.features ? JSON.parse(plan.features) : []).map((f: string, i: number) => (
                      <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{f}</span>
                    ))}
                  </div>
                  <Button className="w-full text-xs cursor-pointer gap-2" onClick={() => handleSubscribe(plan.id)} disabled={loading || subscribingPlan === plan.id}>
                    {loading && subscribingPlan === plan.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Receipt className="h-3 w-3" />}
                    {currentPlan?.plan === plan.name ? 'Current Plan' : 'Subscribe via Mobile Money'}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ====== ADMIN: HUBTEL SMS TAB ====== */}
      {activeSection === 'admin-sms' && isAdmin && (
        <div className="space-y-4">
          <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
            <p className="text-[11px] text-amber-600 font-medium">Admin Only — Configure Hubtel SMS service for the platform.</p>
          </div>
          <div className="p-4 rounded-xl border border-border/50 bg-card space-y-3">
            <h4 className="text-xs font-semibold flex items-center gap-1.5"><MessageCircle className="h-3.5 w-3.5" /> Hubtel SMS Configuration</h4>
            <CInput value={hubtelSmsConfig.clientId} onChange={v => setHubtelSmsConfig(p => ({ ...p, clientId: v }))} placeholder="Hubtel Client ID" />
            <CInput value={hubtelSmsConfig.clientSecret} onChange={v => setHubtelSmsConfig(p => ({ ...p, clientSecret: v }))} placeholder="Hubtel Client Secret" type="password" />
            <CInput value={hubtelSmsConfig.senderName} onChange={v => setHubtelSmsConfig(p => ({ ...p, senderName: v }))} placeholder="Sender Name (e.g. FoviAI)" />
            <Button className="w-full gap-2 text-xs cursor-pointer" onClick={saveHubtelSms} disabled={loading}>
              {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save SMS Config
            </Button>
            <div className="border-t border-border pt-3">
              <p className="text-[11px] text-muted-foreground mb-2">Send a test SMS:</p>
              <div className="flex gap-2">
                <CInput value={testPhone} onChange={setTestPhone} placeholder="+233XXXXXXXXX" />
                <Button variant="outline" className="shrink-0 text-xs cursor-pointer" onClick={handleTestSms} disabled={loading || !testPhone}>Test</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ====== ADMIN: HUBTEL PAYMENT TAB ====== */}
      {activeSection === 'admin-pay' && isAdmin && (
        <div className="space-y-4">
          <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
            <p className="text-[11px] text-amber-600 font-medium">Admin Only — Configure Hubtel Mobile Money payment gateway.</p>
          </div>
          <div className="p-4 rounded-xl border border-border/50 bg-card space-y-3">
            <h4 className="text-xs font-semibold flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5" /> Hubtel Payment Configuration</h4>
            <CInput value={hubtelPayConfig.clientId} onChange={v => setHubtelPayConfig(p => ({ ...p, clientId: v }))} placeholder="Hubtel Client ID" />
            <CInput value={hubtelPayConfig.clientSecret} onChange={v => setHubtelPayConfig(p => ({ ...p, clientSecret: v }))} placeholder="Hubtel Client Secret" type="password" />
            <CInput value={hubtelPayConfig.accountNumber} onChange={v => setHubtelPayConfig(p => ({ ...p, accountNumber: v }))} placeholder="Merchant Account Number" />
            <CInput value={hubtelPayConfig.callbackUrl} onChange={v => setHubtelPayConfig(p => ({ ...p, callbackUrl: v }))} placeholder="Callback URL (for payment notifications)" />
            <Button className="w-full gap-2 text-xs cursor-pointer" onClick={saveHubtelPay} disabled={loading}>
              {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save Payment Config
            </Button>
          </div>
        </div>
      )}

      {/* ====== ADMIN: SMTP TAB ====== */}
      {activeSection === 'admin-smtp' && isAdmin && (
        <div className="space-y-4">
          <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
            <p className="text-[11px] text-amber-600 font-medium">Admin Only — Configure SMTP email service for password reset, OTP, and notifications.</p>
          </div>
          <div className="p-4 rounded-xl border border-border/50 bg-card space-y-3">
            <h4 className="text-xs font-semibold flex items-center gap-1.5"><Server className="h-3.5 w-3.5" /> SMTP Configuration</h4>
            <CInput value={smtpConfig.host} onChange={v => setSmtpConfig(p => ({ ...p, host: v }))} placeholder="SMTP Host (e.g. smtp.gmail.com)" />
            <div className="grid grid-cols-2 gap-2">
              <CInput value={smtpConfig.port} onChange={v => setSmtpConfig(p => ({ ...p, port: v }))} placeholder="Port" />
              <CInput value={smtpConfig.from} onChange={v => setSmtpConfig(p => ({ ...p, from: v }))} placeholder="From Email" />
            </div>
            <CInput value={smtpConfig.user} onChange={v => setSmtpConfig(p => ({ ...p, user: v }))} placeholder="SMTP Username" />
            <CInput value={smtpConfig.password} onChange={v => setSmtpConfig(p => ({ ...p, password: v }))} placeholder="SMTP Password" type="password" />
            <Button className="w-full gap-2 text-xs cursor-pointer" onClick={saveSmtp} disabled={loading}>
              {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save SMTP Config
            </Button>
            <div className="border-t border-border pt-3">
              <p className="text-[11px] text-muted-foreground mb-2">Send a test email:</p>
              <div className="flex gap-2">
                <CInput value={testEmail} onChange={setTestEmail} placeholder="test@example.com" type="email" />
                <Button variant="outline" className="shrink-0 text-xs cursor-pointer" onClick={handleTestEmail} disabled={loading || !testEmail}>Test</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ====== ADMIN: TRADING CONFIG TAB ====== */}
      {activeSection === 'admin-trading' && isAdmin && (
        <div className="space-y-4">
          <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
            <p className="text-[11px] text-amber-600 font-medium">Admin Only — Configure global trading parameters and the mandatory admin levy.</p>
          </div>
          <div className="p-4 rounded-xl border border-border/50 bg-card space-y-3">
            <h4 className="text-xs font-semibold flex items-center gap-1.5"><Target className="h-3.5 w-3.5" /> Trading Configuration</h4>
            <div>
              <label className="text-[10px] text-muted-foreground font-medium mb-1 block">Admin Levy (%) <span className="text-red-400">*</span></label>
              <CInput value={String(tradingConfig.defaultAdminLevyPercent)} onChange={v => setTradingConfig(p => ({ ...p, defaultAdminLevyPercent: parseFloat(v) || 10 }))} placeholder="10" type="number" />
              <p className="text-[9px] text-muted-foreground mt-1">Percentage of profit deducted per trade. Users cannot modify this.</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-muted-foreground font-medium mb-1 block">Max Positions</label>
                <CInput value={String(tradingConfig.defaultMaxPositions)} onChange={v => setTradingConfig(p => ({ ...p, defaultMaxPositions: parseInt(v) || 5 }))} placeholder="5" type="number" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground font-medium mb-1 block">Max Position Size (%)</label>
                <CInput value={String(tradingConfig.defaultMaxPositionSizePercent)} onChange={v => setTradingConfig(p => ({ ...p, defaultMaxPositionSizePercent: parseFloat(v) || 20 }))} placeholder="20" type="number" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-muted-foreground font-medium mb-1 block">Default Stop Loss (%)</label>
                <CInput value={String(tradingConfig.defaultStopLossPercent)} onChange={v => setTradingConfig(p => ({ ...p, defaultStopLossPercent: parseFloat(v) || 2 }))} placeholder="2.0" type="number" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground font-medium mb-1 block">Default Take Profit (%)</label>
                <CInput value={String(tradingConfig.defaultTakeProfitPercent)} onChange={v => setTradingConfig(p => ({ ...p, defaultTakeProfitPercent: parseFloat(v) || 4 }))} placeholder="4.0" type="number" />
              </div>
            </div>
            <Button className="w-full gap-2 text-xs cursor-pointer" onClick={saveTradingConfig} disabled={loading}>
              {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save Trading Config
            </Button>
          </div>
        </div>
      )}

      {/* ====== ADMIN: OTP CONFIG TAB ====== */}
      {activeSection === 'admin-otp' && isAdmin && (
        <div className="space-y-4">
          <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
            <p className="text-[11px] text-amber-600 font-medium">Admin Only — Configure OTP verification settings for SMS and Email login.</p>
          </div>
          <div className="p-4 rounded-xl border border-border/50 bg-card space-y-3">
            <h4 className="text-xs font-semibold flex items-center gap-1.5"><KeyRound className="h-3.5 w-3.5" /> OTP Configuration</h4>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] text-muted-foreground font-medium mb-1 block">Code Length</label>
                <CInput value={String(otpConfig.codeLength)} onChange={v => setOtpConfig(p => ({ ...p, codeLength: parseInt(v) || 6 }))} placeholder="6" type="number" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground font-medium mb-1 block">Expiry (min)</label>
                <CInput value={String(otpConfig.expiryMinutes)} onChange={v => setOtpConfig(p => ({ ...p, expiryMinutes: parseInt(v) || 10 }))} placeholder="10" type="number" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground font-medium mb-1 block">Max Attempts</label>
                <CInput value={String(otpConfig.maxAttempts)} onChange={v => setOtpConfig(p => ({ ...p, maxAttempts: parseInt(v) || 5 }))} placeholder="5" type="number" />
              </div>
            </div>
            <p className="text-[9px] text-muted-foreground">Changes apply to new OTP codes. Previously sent codes keep their original expiry.</p>
            <Button className="w-full gap-2 text-xs cursor-pointer" onClick={saveOtpConfig} disabled={loading}>
              {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save OTP Config
            </Button>
          </div>
        </div>
      )}

      {/* ====== ADMIN: PLATFORM BRANDING TAB ====== */}
      {activeSection === 'admin-platform' && isAdmin && (
        <div className="space-y-4">
          <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
            <p className="text-[11px] text-amber-600 font-medium">Admin Only — Configure platform branding and contact information.</p>
          </div>
          <div className="p-4 rounded-xl border border-border/50 bg-card space-y-3">
            <h4 className="text-xs font-semibold flex items-center gap-1.5"><Globe className="h-3.5 w-3.5" /> Platform Branding</h4>
            <div>
              <label className="text-[10px] text-muted-foreground font-medium mb-1 block">Platform Name</label>
              <CInput value={platformConfig.platformName} onChange={v => setPlatformConfig(p => ({ ...p, platformName: v }))} placeholder="Fovi AI" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground font-medium mb-1 block">Support Email</label>
              <CInput value={platformConfig.supportEmail} onChange={v => setPlatformConfig(p => ({ ...p, supportEmail: v }))} placeholder="support@fovi.ai" type="email" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground font-medium mb-1 block">Platform URL</label>
              <CInput value={platformConfig.platformUrl} onChange={v => setPlatformConfig(p => ({ ...p, platformUrl: v }))} placeholder="https://fovi.lightworldtech.com" />
              <p className="text-[9px] text-muted-foreground mt-1">Used in email footers, payment callbacks, and OTP messages.</p>
            </div>
            <Button className="w-full gap-2 text-xs cursor-pointer" onClick={savePlatformConfig} disabled={loading}>
              {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save Platform Config
            </Button>
          </div>
        </div>
      )}

      {/* ====== ADMIN: USER MANAGEMENT TAB ====== */}
      {activeSection === 'admin-users' && isAdmin && (
        <div className="space-y-4">
          <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
            <p className="text-[11px] text-amber-600 font-medium">Admin Only — Manage user accounts: activate/deactivate, reset passwords, and delete users.</p>
          </div>
          <div className="p-4 rounded-xl border border-border/50 bg-card space-y-3">
            <h4 className="text-xs font-semibold flex items-center gap-1.5"><User className="h-3.5 w-3.5" /> Registered Users ({adminUsers.length})</h4>
            {adminUsers.length === 0 ? (
              <p className="text-[11px] text-muted-foreground text-center py-3">No users found.</p>
            ) : (
              <div className="max-h-96 overflow-y-auto space-y-2">
                {adminUsers.map((u: any) => (
                  <div key={u.id} className="p-3 rounded-lg bg-muted/50 border border-border/30 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold truncate">{u.name || 'No name'}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{u.email}</p>
                      </div>
                      <Badge className={`text-[10px] shrink-0 ml-2 ${u.isActive ? 'bg-emerald-500/10 text-emerald-500 border-0' : 'bg-red-500/10 text-red-500 border-0'}`}>
                        {u.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                    <p className="text-[9px] text-muted-foreground">Joined: {new Date(u.createdAt).toLocaleDateString()}</p>
                    <div className="flex gap-1.5 pt-1">
                      <button onClick={() => handleToggleUserActive(u.id)} className="flex-1 py-1.5 rounded-md text-[10px] font-medium border border-border/50 hover:bg-muted transition-colors cursor-pointer">
                        {u.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                      <button onClick={() => { setResetPwUserId(resetPwUserId === u.id ? null : u.id); setResetPwValue(''); }} className="flex-1 py-1.5 rounded-md text-[10px] font-medium border border-border/50 hover:bg-muted transition-colors cursor-pointer">
                        Reset Password
                      </button>
                      <button onClick={() => { if (confirm(`Delete user "${u.email}"? They will be deactivated.`)) handleDeleteUser(u.id); }} className="py-1.5 px-2 rounded-md text-[10px] font-medium border border-red-500/20 text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer">
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                    {resetPwUserId === u.id && (
                      <div className="flex gap-1.5 pt-1 border-t border-border/30">
                        <CInput value={resetPwValue} onChange={setResetPwValue} placeholder="New password (min 8 chars)" type="password" />
                        <Button size="sm" className="shrink-0 text-[10px] h-9 cursor-pointer" onClick={() => handleResetUserPassword(u.id)} disabled={loading || resetPwValue.length < 8}>Reset</Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ====== ADMIN: SUBSCRIPTION MANAGEMENT TAB ====== */}
      {activeSection === 'admin-subs' && isAdmin && (
        <div className="space-y-4">
          <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
            <p className="text-[11px] text-amber-600 font-medium">Admin Only — Manage subscription plans and send payment links to users via Hubtel Mobile Money.</p>
          </div>

          {/* Send Payment Link */}
          <div className="p-4 rounded-xl border border-border/50 bg-card space-y-3">
            <h4 className="text-xs font-semibold flex items-center gap-1.5"><Receipt className="h-3.5 w-3.5" /> Send Subscription Payment Link</h4>
            <div className="space-y-2">
              <label className="text-[10px] text-muted-foreground font-medium">Select User</label>
              <select value={sendLinkUser} onChange={e => setSendLinkUser(e.target.value)}
                className="w-full h-9 px-3 rounded-lg bg-muted text-sm outline-none focus:ring-2 focus:ring-primary/50">
                <option value="">-- Select user --</option>
                {adminUsers.map((u: any) => (
                  <option key={u.id} value={u.id}>{u.name || u.email} ({u.email})</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] text-muted-foreground font-medium">Select Plan</label>
              <select value={sendLinkPlan} onChange={e => setSendLinkPlan(e.target.value)}
                className="w-full h-9 px-3 rounded-lg bg-muted text-sm outline-none focus:ring-2 focus:ring-primary/50">
                <option value="">-- Select plan --</option>
                {allPlans.filter((p: any) => p.name !== 'free').map((plan: any) => (
                  <option key={plan.id} value={plan.id}>{plan.displayName || plan.name} — GH₵{plan.price}/mo</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] text-muted-foreground font-medium">User Phone (optional, for Mobile Money)</label>
              <CInput value={sendLinkPhone} onChange={setSendLinkPhone} placeholder="+233XXXXXXXXX" />
            </div>
            <Button className="w-full gap-2 text-xs cursor-pointer" onClick={handleSendPaymentLink} disabled={loading || !sendLinkUser || !sendLinkPlan}>
              {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />} Send Payment Link via Hubtel
            </Button>
          </div>

          {/* Create Plan */}
          <div className="p-4 rounded-xl border border-border/50 bg-card space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold flex items-center gap-1.5"><Plus className="h-3.5 w-3.5" /> Subscription Plans ({allPlans.length})</h4>
              <Button variant="outline" className="h-7 text-[10px] gap-1 cursor-pointer" onClick={handleCreatePlan} disabled={loading || showCreatePlan}>
                <Plus className="h-3 w-3" /> {showCreatePlan ? 'Cancel' : 'New Plan'}
              </Button>
            </div>

            {/* Create Plan Form */}
            {showCreatePlan && (
              <div className="p-3 rounded-lg bg-muted/30 border border-border/30 space-y-2">
                <p className="text-[10px] font-semibold text-muted-foreground">Create New Plan</p>
                <div className="grid grid-cols-2 gap-2">
                  <CInput value={newPlanForm.name} onChange={v => setNewPlanForm(p => ({ ...p, name: v }))} placeholder="Internal name (e.g. pro)" />
                  <CInput value={newPlanForm.displayName} onChange={v => setNewPlanForm(p => ({ ...p, displayName: v }))} placeholder="Display name (e.g. Pro Plan)" />
                </div>
                <CInput value={newPlanForm.price} onChange={v => setNewPlanForm(p => ({ ...p, price: v }))} placeholder="Price in GHS (e.g. 50)" type="number" />
                <CInput value={newPlanForm.features} onChange={v => setNewPlanForm(p => ({ ...p, features: v }))} placeholder="Features (comma-separated)" />
                <div className="grid grid-cols-2 gap-2">
                  <CInput value={newPlanForm.maxBots} onChange={v => setNewPlanForm(p => ({ ...p, maxBots: v }))} placeholder="Max bots (e.g. 5)" type="number" />
                  <CInput value={newPlanForm.maxAccounts} onChange={v => setNewPlanForm(p => ({ ...p, maxAccounts: v }))} placeholder="Max accounts (e.g. 2)" type="number" />
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1 text-[10px] cursor-pointer" onClick={() => { setShowCreatePlan(false); setNewPlanForm({ name: '', displayName: '', price: '', features: '', maxBots: '5', maxAccounts: '2' }); }}>Cancel</Button>
                  <Button className="flex-1 text-[10px] cursor-pointer" onClick={handleCreatePlanSubmit} disabled={loading}>Create Plan</Button>
                </div>
              </div>
            )}

            {allPlans.length === 0 && !showCreatePlan ? (
              <p className="text-[11px] text-muted-foreground text-center py-3">No plans created yet. Click "New Plan" to add one.</p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {allPlans.map((plan: any) => (
                  <div key={plan.id} className="rounded-lg bg-muted/50 border border-border/30">
                    {editingPlanId === plan.id ? (
                      <div className="p-3 space-y-2">
                        <p className="text-[10px] font-semibold text-muted-foreground">Editing: {plan.displayName || plan.name}</p>
                        <div className="grid grid-cols-2 gap-2">
                          <CInput value={editPlanForm.displayName} onChange={v => setEditPlanForm(p => ({ ...p, displayName: v }))} placeholder="Display name" />
                          <CInput value={editPlanForm.price} onChange={v => setEditPlanForm(p => ({ ...p, price: v }))} placeholder="Price (GHS)" type="number" />
                        </div>
                        <CInput value={editPlanForm.features} onChange={v => setEditPlanForm(p => ({ ...p, features: v }))} placeholder="Features (comma-separated)" />
                        <div className="grid grid-cols-2 gap-2">
                          <CInput value={editPlanForm.maxBots} onChange={v => setEditPlanForm(p => ({ ...p, maxBots: v }))} placeholder="Max bots" type="number" />
                          <CInput value={editPlanForm.maxAccounts} onChange={v => setEditPlanForm(p => ({ ...p, maxAccounts: v }))} placeholder="Max accounts" type="number" />
                        </div>
                        <div className="flex gap-2">
                          <Button variant="outline" className="flex-1 text-[10px] cursor-pointer" onClick={() => setEditingPlanId(null)}>Cancel</Button>
                          <Button className="flex-1 text-[10px] cursor-pointer" onClick={handleUpdatePlan} disabled={loading}>Save Changes</Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between p-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold truncate">{plan.displayName || plan.name}</p>
                          <p className="text-[10px] text-muted-foreground">GH₵{plan.price}/mo · {plan.maxBots} bots · {plan.maxAccounts} accounts</p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0 ml-2">
                          <Badge className={`text-[10px] ${plan.isActive ? 'bg-emerald-500/10 text-emerald-500 border-0' : 'bg-red-500/10 text-red-500 border-0'}`}>
                            {plan.isActive ? 'Active' : 'Inactive'}
                          </Badge>
                          <button onClick={() => handleEditPlan(plan)} className="p-1 rounded hover:bg-muted transition-colors cursor-pointer" title="Edit plan">
                            <Settings className="h-3 w-3 text-muted-foreground" />
                          </button>
                          <button onClick={() => handleDeletePlan(plan.id, plan.displayName || plan.name)} className="p-1 rounded hover:bg-red-500/10 transition-colors cursor-pointer" title="Delete plan">
                            <X className="h-3 w-3 text-red-400" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* All Subscriptions */}
          <div className="p-4 rounded-xl border border-border/50 bg-card space-y-3">
            <h4 className="text-xs font-semibold flex items-center gap-1.5"><History className="h-3.5 w-3.5" /> All Subscriptions ({adminSubs.length})</h4>
            {adminSubs.length === 0 ? (
              <p className="text-[11px] text-muted-foreground text-center py-3">No subscriptions yet.</p>
            ) : (
              <div className="max-h-64 overflow-y-auto space-y-2">
                {adminSubs.map((sub: any) => (
                  <div key={sub.id} className="p-2.5 rounded-lg bg-muted/50 border border-border/30">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-semibold truncate">{sub.user?.name || sub.user?.email || 'Unknown'}</p>
                      <Badge className={`text-[10px] shrink-0 ml-2 ${
                        sub.status === 'active' ? 'bg-emerald-500/10 text-emerald-500 border-0' :
                        sub.status === 'past_due' ? 'bg-amber-500/10 text-amber-500 border-0' :
                        'bg-red-500/10 text-red-500 border-0'
                      }`}>
                        {sub.status}
                      </Badge>
                    </div>
                    <p className="text-[10px] text-muted-foreground">{sub.plan} · GH₵{sub.amount} · {new Date(sub.createdAt).toLocaleDateString()}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {activeSection === 'admin-brokers' && isAdmin && (
        <AdminBrokersPanel />
      )}
    </div>
  );
}

// ============================================================
// Settings Sheet
// ============================================================
function SettingsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { accounts, setAccounts, setActiveAccount, isAuthenticated } = useTradingStore();
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState('');
  const [broker, setBroker] = useState('alpaca');
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [accountType, setAccountType] = useState('demo');
  const requiresPassphrase = broker === 'okx' || broker === 'bitget';

  const handleConnect = async () => {
    if (!apiKey || !apiSecret) return;
    setConnecting(true);
    setConnectError('');
    try {
      const res = await fetch('/api/trading/accounts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ broker, accountType, apiKey, apiSecret, passphrase: requiresPassphrase ? passphrase : undefined }),
      });
      if (res.ok) {
        const newAccount = await res.json();
        // Persist to localStorage immediately — survives refresh even without DB
        try {
          const existing = JSON.parse(localStorage.getItem('fovi_accounts') || '[]');
          const filtered = existing.filter((a: any) => a.id !== newAccount.id);
          localStorage.setItem('fovi_accounts', JSON.stringify([newAccount, ...filtered]));
        } catch { /* quota */ }
        // Refresh and merge accounts from API with localStorage
        let accs: any[] = [];
        try { accs = await (await fetch('/api/trading/accounts')).json(); } catch { /* */ }
        if (!Array.isArray(accs)) accs = [];
        try {
          const lsAccs = JSON.parse(localStorage.getItem('fovi_accounts') || '[]');
          const apiIds = new Set(accs.map((a: any) => a.id));
          const localOnly = lsAccs.filter((a: any) => !apiIds.has(a.id));
          if (localOnly.length > 0) accs = [...accs, ...localOnly];
        } catch { /* */ }
        setAccounts(accs);
        // Auto-switch to the newly connected account
        if (newAccount?.id) {
          setActiveAccount(newAccount.id);
          // Also persist the switch in DB
          if (!newAccount.id.startsWith('local_')) {
            fetch('/api/trading/accounts/switch', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ accountId: newAccount.id }),
            }).catch(() => {});
          }
        }
        setApiKey(''); setApiSecret(''); setPassphrase('');
        setConnectError('');
        onOpenChange(false);
        toast.success(`${broker.charAt(0).toUpperCase() + broker.slice(1)} account connected successfully`);
      } else {
        const data = await res.json().catch(() => ({}));
        const msg = data.error || `Connection failed (${res.status})`;
        setConnectError(msg);
        toast.error(msg);
      }
    } catch {
      const msg = 'Network error. Check your connection.';
      setConnectError(msg);
      toast.error(msg);
    } finally { setConnecting(false); }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md flex flex-col overflow-hidden">
        <SheetHeader className="px-5 pt-5 pb-4 border-b border-border shrink-0">
          <SheetTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Settings & Brokers
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="px-5 py-5 space-y-6">
            {/* Connected Accounts */}
            <div>
              <h3 className="text-sm font-semibold mb-3">Connected Accounts</h3>
              <div className="space-y-2">
                {accounts.map(function(acc) { return <SettingsAccountRow key={acc.id} acc={acc} />; })}
                {accounts.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">No accounts connected</p>
                )}
              </div>
            </div>

            {/* Connect New Broker */}
            <div>
              <h3 className="text-sm font-semibold mb-3">Connect Broker</h3>
              <div className="space-y-4 p-5 rounded-xl border border-border/50 bg-card">
                <div className="grid grid-cols-3 gap-2">
                  {(['alpaca', 'binance', 'okx', 'bybit', 'bitget', 'deriv'] as const).map(b => (
                    <button key={b} onClick={() => { setBroker(b); if (b !== 'demo') setAccountType('live'); }}
                      className={`p-2.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                        broker === b ? 'bg-primary/10 border-primary text-primary' : 'border-border hover:bg-accent'
                      }`}>
                      {b.charAt(0).toUpperCase() + b.slice(1)}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => setAccountType('demo')}
                    className={`p-2.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                      accountType === 'demo' ? 'bg-amber-500/10 border-amber-500/30 text-amber-500' : 'border-border'
                    }`}>
                    Demo / Paper
                  </button>
                  <button onClick={() => setAccountType('live')}
                    className={`p-2.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                      accountType === 'live' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500' : 'border-border'
                    }`}>
                    Live Trading
                  </button>
                </div>

                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground font-medium">API Key</label>
                  <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)}
                    placeholder="Enter your API key"
                    className="w-full h-10 px-3 rounded-lg bg-muted text-sm outline-none focus:ring-2 focus:ring-primary/50 transition-shadow" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground font-medium">API Secret</label>
                  <input type="password" value={apiSecret} onChange={e => setApiSecret(e.target.value)}
                    placeholder="Enter your API secret"
                    className="w-full h-10 px-3 rounded-lg bg-muted text-sm outline-none focus:ring-2 focus:ring-primary/50 transition-shadow" />
                </div>

                {requiresPassphrase && (
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground font-medium">Passphrase</label>
                    <input type="password" value={passphrase} onChange={e => setPassphrase(e.target.value)}
                      placeholder="Enter your passphrase"
                      className="w-full h-10 px-3 rounded-lg bg-muted text-sm outline-none focus:ring-2 focus:ring-primary/50 transition-shadow" />
                  </div>
                )}

                {connectError && (
                  <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-xs">
                    {connectError}
                  </div>
                )}

                <Button onClick={handleConnect} disabled={connecting || !apiKey || !apiSecret || (requiresPassphrase && !passphrase)} className="w-full cursor-pointer">
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
            <div className="p-5 rounded-xl bg-muted/30 border border-border/30">
              <h4 className="text-xs font-semibold mb-2">About Fovi AI</h4>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Fovi is a world-class AI auto-trading platform combining technical analysis,
                machine learning signals, and real-time market data across stocks, crypto, and forex.
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                <Badge variant="outline" className="text-[10px]">v1.1.0</Badge>
              </div>
            </div>

            {/* Login / Sign Up */}
            {isAuthenticated ? (
              <SecuritySettings />
            ) : (
              <div className="p-4 rounded-xl border border-primary/20 bg-primary/5">
                <h4 className="text-xs font-semibold mb-2 flex items-center gap-1.5">
                  <Briefcase className="h-3.5 w-3.5" />
                  Account
                </h4>
                <a
                  href="/auth/signin"
                  className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
                >
                  Sign In / Sign Up
                </a>
                <p className="text-[10px] text-muted-foreground text-center mt-1.5">
                  Connect your broker accounts after signing in
                </p>
              </div>
            )}
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
  const { activeTab, setActiveTab, setOrderSheetOpen, alerts } = useTradingStore();
  const [alertsOpen, setAlertsOpen] = useState(false);

  const sidebarItems = [
    { id: 'autotrade', label: 'AI Trading', icon: Bot },
    { id: 'dashboard', label: 'Overview', icon: LayoutDashboard },
    { id: 'markets', label: 'Markets', icon: Search },
    { id: 'signals', label: 'AI Signals', icon: Sparkles },
    { id: 'positions', label: 'Positions', icon: Wallet },
    { id: 'history', label: 'History', icon: Clock },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
    { id: 'backtest', label: 'Backtesting', icon: FlaskConical },
    { id: 'leaderboard', label: 'Leaderboard', icon: Trophy },
    { id: 'journal', label: 'Journal', icon: BookOpen },
    { id: 'sentiment', label: 'Sentiment', icon: Globe },
    { id: 'correlation', label: 'Correlation', icon: GitBranch },
    { id: 'sessions', label: 'Sessions', icon: Timer },
    { id: 'webhook', label: 'Webhooks', icon: Activity },
  ];

  return (
    <aside className="hidden lg:flex flex-col w-56 border-r border-border bg-card/30 shrink-0 min-h-0">
      <div className="p-4">
        <div className="flex items-center gap-2.5">
          <img src="/logo.png" alt="Fovi AI" className="w-9 h-9 rounded-xl" />
          <div>
            <h1 className="font-bold text-base tracking-tight">Fovi AI</h1>
            <p className="text-[10px] text-muted-foreground font-medium">Auto-Trading Platform</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-2 space-y-0.5 overflow-y-auto min-h-0">
        {sidebarItems.map(item => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button key={item.id} onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
              }`}>
              <Icon className="h-4 w-4" />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="p-3 space-y-2 border-t border-border">
        <Button variant="outline" className="w-full gap-2 justify-start cursor-pointer" onClick={() => setAlertsOpen(true)}>
          <Bell className="h-4 w-4" /> Alerts {alerts.length > 0 && <Badge variant="secondary" className="ml-auto text-[10px] h-4">{alerts.length}</Badge>}
        </Button>
        <Button className="w-full gap-2 cursor-pointer bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => setOrderSheetOpen(true)}>
          <Plus className="h-4 w-4" /> New Trade
        </Button>
      </div>

      <AlertsSheet open={alertsOpen} onOpenChange={setAlertsOpen} />
    </aside>
  );
}

// ============================================================
// Mobile Navigation Sheet (hamburger menu)
// ============================================================
function MobileNavSheet({ open, onOpenChange, onOpenSettings }: { open: boolean; onOpenChange: (o: boolean) => void; onOpenSettings: () => void }) {
  const { activeTab, setActiveTab, setOrderSheetOpen } = useTradingStore();

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'autotrade', label: 'AI Auto-Trade', icon: Bot },
    { id: 'bots', label: 'Bot Manager', icon: LineChart },
    { id: 'backtest', label: 'Backtesting', icon: FlaskConical },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
    { id: 'leaderboard', label: 'Leaderboard', icon: Trophy },
    { id: 'markets', label: 'Markets', icon: Search },
    { id: 'positions', label: 'Positions', icon: Wallet },
    { id: 'journal', label: 'Trade Journal', icon: BookOpen },
    { id: 'sentiment', label: 'Sentiment', icon: Globe },
    { id: 'correlation', label: 'Correlation', icon: GitBranch },
    { id: 'sessions', label: 'Sessions', icon: Timer },
    { id: 'webhook', label: 'Webhooks', icon: Activity },
    { id: 'history', label: 'History', icon: Clock },
    { id: 'signals', label: 'AI Signals', icon: Sparkles },
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-72 p-0 flex flex-col overflow-hidden">
        <SheetHeader className="px-5 pt-5 pb-4 border-b border-border shrink-0">
          <SheetTitle className="flex items-center gap-2.5">
            <img src="/logo.png" alt="Fovi AI" className="w-9 h-9 rounded-xl" />
            <div>
              <span className="font-bold text-base">Fovi AI</span>
              <p className="text-[10px] text-muted-foreground font-medium">Auto-Trading Platform</p>
            </div>
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto min-h-0 px-3 py-3 space-y-0.5">
          {navItems.map(item => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button key={item.id} onClick={() => { setActiveTab(item.id); onOpenChange(false); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                  isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                }`}>
                <Icon className="h-4 w-4" />
                {item.label}
              </button>
            );
          })}
        </div>

        <div className="p-3 space-y-2 border-t border-border shrink-0">
          <Button className="w-full gap-2 cursor-pointer bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => { setOrderSheetOpen(true); onOpenChange(false); }}>
            <Plus className="h-4 w-4" /> New Trade
          </Button>
          <Button variant="outline" className="w-full gap-2 justify-start cursor-pointer" onClick={() => { onOpenSettings(); onOpenChange(false); }}>
            <Settings className="h-4 w-4" /> Settings
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ============================================================
// Symbol Detail View (Markets tab with chart + list)
// ============================================================
function SymbolDetailView() {
  const { allSymbols, selectedSymbol, setSelectedSymbol, setActiveTab, livePrices } = useTradingStore();
  const showDetail = !!selectedSymbol;
  const symbols = livePrices.length > 0 ? livePrices : allSymbols;

  const selectedData = symbols.find(s => s.symbol === selectedSymbol);
  const lastCandle = selectedData;
  const isUp = (lastCandle?.changePercent ?? 0) >= 0;

  if (showDetail && selectedSymbol) {
    return (
      <div className="space-y-4">
        {/* Back button + header */}
        <div className="flex items-center gap-3">
          <button onClick={() => setSelectedSymbol(null)}
            className="p-2 rounded-lg hover:bg-accent transition-colors cursor-pointer">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold">{selectedSymbol}</h2>
              {lastCandle && (
                <Badge variant={isUp ? 'default' : 'destructive'} className={isUp ? 'bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 border-0' : ''}>
                  {isUp ? '+' : ''}{(lastCandle.changePercent ?? 0).toFixed(2)}%
                </Badge>
              )}
            </div>
            {lastCandle && (
              <p className="text-2xl font-bold tabular-nums mt-0.5">
                {formatPrice(lastCandle.price, selectedSymbol)}
              </p>
            )}
          </div>
          <div className="flex gap-1.5">
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white h-9 px-4 cursor-pointer"
              onClick={() => { useTradingStore.getState().setOrderSymbol(selectedSymbol); useTradingStore.getState().setOrderSheetOpen(true); }}>Buy</Button>
            <Button size="sm" variant="outline" className="text-red-500 border-red-500/30 hover:bg-red-500/10 h-9 px-4 cursor-pointer"
              onClick={() => { useTradingStore.getState().setOrderSymbol(selectedSymbol); useTradingStore.getState().setOrderSheetOpen(true); }}>Sell</Button>
          </div>
        </div>

        {/* Market info strip */}
        {lastCandle && (
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: 'Open', value: formatPrice(lastCandle.price * (1 - (lastCandle.changePercent || 0) / 100 * 0.5), selectedSymbol) },
              { label: 'High', value: formatPrice((lastCandle.high24h || lastCandle.price * 1.02), selectedSymbol) },
              { label: 'Low', value: formatPrice((lastCandle.low24h || lastCandle.price * 0.98), selectedSymbol) },
              { label: 'Vol', value: formatVolume(lastCandle.volume || 0) },
            ].map(item => (
              <div key={item.label} className="p-2.5 rounded-lg bg-muted/50 border border-border/30">
                <p className="text-[10px] text-muted-foreground font-medium">{item.label}</p>
                <p className="text-sm font-bold tabular-nums mt-0.5">{item.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Chart */}
        <Card className="overflow-hidden h-[500px] flex flex-col">
          <PriceChart />
        </Card>
      </div>
    );
  }

  // Symbol list view
  return <MarketOverview />;
}

// ============================================================
// Main Trading Dashboard Page
// ============================================================
export default function TradingDashboard() {
  const {
    activeTab, setActiveTab, setAccounts, setPortfolio, setAllSymbols, setLivePrices, setWsConnected,
    accounts, livePrices, allSymbols, selectedSymbol, setSelectedSymbol, alerts,
    isAuthenticated, authUser, clearAuth,
  } = useTradingStore();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [pageLoaded, setPageLoaded] = useState(false);

  const { prices: wsPrices, connected: wsConnected } = useMarketSocket();

  // Hydrate alerts, accounts & auth from localStorage on first mount
  // Validates JWT token with the server to ensure session is still valid
  useEffect(() => {
    hydrateAlertsFromStorage();
    // Restore auth state from localStorage, but validate the token with the server
    (async () => {
      try {
        const token = localStorage.getItem('fovi_token');
        const userStr = localStorage.getItem('fovi_user');
        if (token && userStr) {
          // Validate the JWT with the server
          const res = await fetch('/api/auth/me', {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.ok) {
            const data = await res.json();
            if (data.success && data.user) {
              useTradingStore.getState().setAuth(data.user, token);
            } else {
              // Token is invalid or expired — clear it
              localStorage.removeItem('fovi_token');
              localStorage.removeItem('fovi_user');
            }
          } else {
            // Token validation failed — clear it
            localStorage.removeItem('fovi_token');
            localStorage.removeItem('fovi_user');
          }
        }
      } catch {
        // Network error — try restoring from localStorage as fallback
        try {
          const token = localStorage.getItem('fovi_token');
          const userStr = localStorage.getItem('fovi_user');
          if (token && userStr) {
            const user = JSON.parse(userStr);
            if (user?.id && user?.email) {
              useTradingStore.getState().setAuth(user, token);
            }
          }
        } catch { /* ignore */ }
      }
    })();
    // If no accounts loaded yet, seed from localStorage
    // Also always restore the active account ID from localStorage
    const { accounts: currentAccounts, setActiveAccount: doSetActive } = useTradingStore.getState();
    if (currentAccounts.length === 0) {
      try {
        const stored = localStorage.getItem('fovi_accounts');
        if (stored) {
          setAccounts(JSON.parse(stored));
        }
      } catch { /* ignore */ }
    }
    // Always restore active account from localStorage (survives all merge logic)
    try {
      const raw = localStorage.getItem('fovi_active_account');
      const savedId = raw ? JSON.parse(raw) : null;
      if (savedId) doSetActive(savedId);
    } catch { /* ignore */ }
  }, []);

  // Simulate initial page load — show preloader for ~2s
  useEffect(() => {
    const timer = setTimeout(() => setPageLoaded(true), 2000);
    return () => clearTimeout(timer);
  }, []);

  // Real-time trade-notification toasts — polls
  // /api/trading/auto-trade/activity every 15s and fires a Sonner
  // toast for each newly detected AI trade while the page is visible.
  useTradeNotifications();

  useEffect(() => {
    if (wsPrices.length > 0) {
      setLivePrices(wsPrices);
      setWsConnected(wsConnected);
    }
  }, [wsPrices, wsConnected, setLivePrices, setWsConnected]);

  useEffect(() => {
    async function loadData() {
      try {
        const [accRes, portRes, symRes] = await Promise.all([
          fetch('/api/trading/accounts'),
          fetch('/api/trading/portfolio'),
          fetch('/api/trading/market/symbols'),
        ]);
        // Detect storage mode from response headers
        const accStorage = accRes.headers.get('x-storage') || 'unknown';
        const accIsDemo = accRes.headers.get('x-demo') === 'true';
        if (accIsDemo) {
          useTradingStore.getState().setDemoMode(true);
        }
        if (portRes.headers.get('x-demo') === 'true') {
          useTradingStore.getState().setDemoMode(true);
        }
        if (symRes.headers.get('x-demo') === 'true') {
          useTradingStore.getState().setDemoMode(true);
        }
        if (accRes.ok) {
          const accData = await accRes.json();
          if (Array.isArray(accData)) {
            // DB tells us which account is active via x-active-account header.
            // This is the single source of truth — no localStorage guessing.
            const dbActiveId = accRes.headers.get('x-active-account') || null;

            // When API is in demo/no-DB mode, merge with localStorage accounts
            // instead of overwriting them. This preserves connected broker accounts.
            if (accStorage === 'demo' || accStorage === 'none') {
              const lsAccs = (() => { try { return JSON.parse(localStorage.getItem('fovi_accounts') || '[]'); } catch { return []; } })();
              const realBrokerAccs = lsAccs.filter((a: any) => a.broker !== 'demo');
              if (realBrokerAccs.length > 0) {
                const apiIds = new Set(accData.map((a: any) => a.id));
                const localOnly = realBrokerAccs.filter((a: any) => !apiIds.has(a.id));
                setAccounts([...accData, ...localOnly], dbActiveId);
              } else {
                setAccounts(accData, dbActiveId);
              }
            } else {
              setAccounts(accData, dbActiveId);
            }
          }
        }
        // Only set portfolio from API when AI bot is NOT running
        // (AI dashboard manages portfolio state via setPortfolio)
        const botRunning = useTradingStore.getState().botConfig.status === 'running';
        if (portRes.ok && !botRunning) {
          const portData = await portRes.json();
          if (portData && typeof portData === 'object' && !portData.error) {
            setPortfolio(portData);
          }
        }
        if (symRes.ok) {
          const symData = await symRes.json();
          if (Array.isArray(symData) && symData.length > 0) {
            setAllSymbols(symData);
          }
        }
      } catch { /* network error — keep existing state */ }
    }
    loadData();
    const interval = setInterval(loadData, 15000);
    return () => clearInterval(interval);
  }, [setAccounts, setPortfolio, setAllSymbols]);

  return (
    <div className="h-screen overflow-hidden flex flex-col bg-background">
      <PagePreloader isLoaded={pageLoaded} onComplete={() => {}} />

      {/* ====== APP CONTENT ====== */}
      <div className={`flex flex-col flex-1 min-h-0 transition-opacity duration-500 ${pageLoaded ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
      {/* ====== DEMO MODE BANNER ====== */}
      <DemoBanner />

      {/* ====== TOP BAR ====== */}
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur-xl border-b border-border/50">
        <div className="flex items-center justify-between h-14 px-4">
          <div className="flex items-center gap-3">
            <button className="lg:hidden cursor-pointer" onClick={() => setMobileMenuOpen(true)}>
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2 lg:hidden">
              <img src="/logo.png" alt="Fovi" className="w-8 h-8 rounded-lg" />
              <span className="font-bold text-lg">Fovi</span>
            </div>
            <AccountSwitcher />
          </div>

          <div className="flex items-center gap-1.5">
            {wsConnected ? (
              <span className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-500/10 text-emerald-500 text-[10px] font-semibold">
                <Radio className="h-3 w-3" /> STREAMING
              </span>
            ) : (
              <span className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-md bg-muted text-muted-foreground text-[10px] font-semibold">
                <Activity className="h-3 w-3" /> OFFLINE
              </span>
            )}
            <Button variant="ghost" size="icon" className="h-9 w-9 cursor-pointer" onClick={() => window.location.reload()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-9 w-9 relative cursor-pointer" onClick={() => setAlertsOpen(true)}>
              <Bell className="h-4 w-4" />
              {alerts.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-red-500 text-[10px] text-white flex items-center justify-center font-bold">{alerts.length}</span>
              )}
            </Button>
            {isAuthenticated && authUser ? (
              <div className="relative group">
                <button className="hidden sm:flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold cursor-pointer hover:bg-primary/90 transition-colors">
                  <User className="h-3.5 w-3.5" />
                  <span>{authUser.name || authUser.email.split('@')[0]}</span>
                  <ChevronDown className="h-3 w-3" />
                </button>
                <div className="absolute right-0 top-full mt-1 w-52 rounded-xl border border-border bg-card shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50">
                  <div className="px-3 py-2.5 border-b border-border">
                    <p className="text-sm font-medium truncate">{authUser.name || 'User'}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{authUser.email}</p>
                  </div>
                  <div className="p-1.5">
                    <button onClick={() => { clearAuth(); window.location.href = '/'; }}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer">
                      <LogOut className="h-4 w-4" /> Sign Out
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <a href="/auth/signin" className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold cursor-pointer hover:bg-primary/90 transition-colors">
                <Briefcase className="h-3.5 w-3.5" />
                <span>Sign In</span>
              </a>
            )}
            <Button variant="ghost" size="icon" className="h-9 w-9 cursor-pointer" onClick={() => setSettingsOpen(true)}>
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* ====== TICKER STRIP ====== */}
      <TickerStrip />

      {/* ====== MAIN LAYOUT ====== */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        <DesktopSidebar />

        <main className="flex-1 overflow-y-auto min-h-0 pb-20 lg:pb-4">
          <AnimatePresence mode="wait">
            {/* ====== DASHBOARD / OVERVIEW TAB ====== */}
            {activeTab === 'dashboard' && (
              <motion.div key="dashboard" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }} className="min-h-full">
                <div className="p-4 pb-2">
                  <PortfolioCards />
                </div>
                <div className="flex flex-col lg:flex-row gap-3 p-4 pt-2">
                  <Card className="flex-1 h-[500px] overflow-hidden flex flex-col">
                    <PriceChart autoTick />
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
                <div className="px-4 pb-4 hidden lg:block">
                  <Card className="overflow-hidden">
                    <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Wallet className="h-4 w-4" />
                        <h3 className="text-sm font-semibold">Open Positions</h3>
                      </div>
                      <Button size="sm" className="h-7 gap-1 cursor-pointer bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => useTradingStore.getState().setOrderSheetOpen(true)}>
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

            {/* ====== AI AUTO-TRADE TAB ====== */}
            {activeTab === 'autotrade' && (
              <motion.div key="autotrade" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }} className="h-full">
                <div className="p-4"><AITradingDashboard /></div>
              </motion.div>
            )}

            {/* ====== BACKTESTING TAB ====== */}
            {activeTab === 'backtest' && (
              <motion.div key="backtest" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }} className="h-full">
                <div className="p-4" style={{ paddingBottom: '100px' }}><BacktestPanel /></div>
              </motion.div>
            )}

            {/* ====== ANALYTICS TAB ====== */}
            {activeTab === 'analytics' && (
              <motion.div key="analytics" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }} className="h-full">
                <div className="p-4" style={{ paddingBottom: '100px' }}><AnalyticsPanel /></div>
              </motion.div>
            )}

            {/* ====== LEADERBOARD TAB ====== */}
            {activeTab === 'leaderboard' && (
              <motion.div key="leaderboard" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }} className="h-full">
                <div className="p-4" style={{ paddingBottom: '100px' }}><LeaderboardPanel /></div>
              </motion.div>
            )}

            {/* ====== JOURNAL TAB ====== */}
            {activeTab === 'journal' && (
              <motion.div key="journal" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }} className="h-full">
                <div className="p-4" style={{ paddingBottom: '100px' }}><JournalPanel /></div>
              </motion.div>
            )}

            {/* ====== SENTIMENT TAB ====== */}
            {activeTab === 'sentiment' && (
              <motion.div key="sentiment" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }} className="h-full">
                <div className="p-4" style={{ paddingBottom: '100px' }}><SentimentPanel /></div>
              </motion.div>
            )}

            {/* ====== CORRELATION TAB ====== */}
            {activeTab === 'correlation' && (
              <motion.div key="correlation" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }} className="h-full">
                <div className="p-4" style={{ paddingBottom: '100px' }}><CorrelationPanel /></div>
              </motion.div>
            )}

            {/* ====== SESSIONS TAB ====== */}
            {activeTab === 'sessions' && (
              <motion.div key="sessions" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }} className="h-full">
                <div className="p-4" style={{ paddingBottom: '100px' }}><SessionsPanel /></div>
              </motion.div>
            )}

            {/* ====== WEBHOOK TAB ====== */}
            {activeTab === 'webhook' && (
              <motion.div key="webhook" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }} className="h-full">
                <div className="p-4" style={{ paddingBottom: '100px' }}><WebhookPanel /></div>
              </motion.div>
            )}

            {/* ====== SIGNALS TAB ====== */}
            {activeTab === 'signals' && (
              <motion.div key="signals" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.15 }} className="h-full">
                <div className="p-4" style={{ paddingBottom: '100px' }}><SignalsPanel /></div>
              </motion.div>
            )}

            {/* ====== POSITIONS TAB ====== */}
            {activeTab === 'positions' && (
              <motion.div key="positions" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.15 }} className="h-full">
                <div className="p-4" style={{ paddingBottom: '100px' }}><PositionsPanel /></div>
              </motion.div>
            )}

            {/* ====== HISTORY TAB ====== */}
            {activeTab === 'history' && (
              <motion.div key="history" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }} className="h-full">
                <Card className="m-4 overflow-hidden" style={{ height: 'calc(100vh - 160px)' }}>
                  <div className="px-4 py-3 border-b border-border flex items-center gap-2">
                    <Clock className="h-4 w-4" /><h3 className="text-sm font-semibold">Order History</h3>
                    <Badge variant="outline" className="text-[10px] ml-auto">6 orders</Badge>
                  </div>
                  <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 220px)' }}><OrderHistoryPanel /></div>
                </Card>
              </motion.div>
            )}

            {/* ====== MARKETS TAB ====== */}
            {activeTab === 'markets' && (
              <motion.div key="markets" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }} className="h-full">
                <div className="p-4" style={{ paddingBottom: '100px' }}><SymbolDetailView /></div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>

      <MobileTabBar />
      <OrderForm />
      <SignalDetailSheet />
      <PositionDetailSheet />
      <AiChatSheet />
      <SettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} />
      <AlertsSheet open={alertsOpen} onOpenChange={setAlertsOpen} />
      <MobileNavSheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen} onOpenSettings={() => setSettingsOpen(true)} />
      </div>
    </div>
  );
}
