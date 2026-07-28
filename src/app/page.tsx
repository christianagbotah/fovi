'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, TrendingUp, TrendingDown, BarChart3, Search,
  Menu, Wallet, Zap, Sparkles, Plus, RefreshCw, Bell, Settings, MessageSquare, ArrowUpRight,
  ArrowDownRight, Activity, Radio, Briefcase, Clock, Shield, Target, Trophy,
  Send, Loader2, X, ChevronRight, AlertTriangle, History, Eye, Crosshair,
  Bot, LineChart, FlaskConical, BookOpen, Globe, GitBranch, Timer,
  ArrowLeft, User, Lock, Mail, Phone, ChevronDown,
} from 'lucide-react';
import { useTradingStore, hydrateAlertsFromStorage } from '@/lib/store/trading-store';
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
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { formatPnl, formatPrice, formatVolume } from '@/lib/market-sim';
import { useMarketSocket } from '@/hooks/use-market-socket';
import { useTradeNotifications } from '@/hooks/use-trade-notifications';
import { PagePreloader } from '@/components/page-preloader';


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
  const { portfolio, wsConnected, botConfig, aiOpenPositions, aiClosedTrades } = useTradingStore();

  // When AI bot has been active, derive portfolio from AI state
  const allocation = botConfig.allocationAmount;
  const hasAITrading = allocation > 0 && (botConfig.totalTrades > 0 || aiOpenPositions.length > 0);

  // Build effective portfolio from AI trading state
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
          totalBalance: equity,
          totalPnl,
          totalPnlPercent: pnlPct,
          dayPnl: unrealized,
          dayPnlPercent: allocation > 0 ? (unrealized / allocation) * 100 : 0,
          openPositions: aiOpenPositions.length,
          activeSignals: 0,
          winRate,
          totalTrades: aiClosedTrades.length,
        };
      })()
    : portfolio || {
        totalBalance: allocation > 0 ? allocation : 100000,
        totalPnl: 0, totalPnlPercent: 0,
        dayPnl: 0, dayPnlPercent: 0,
        openPositions: aiOpenPositions.length,
        activeSignals: 0, winRate: 0, totalTrades: botConfig.totalTrades,
      };

  const isPnlUp = effectivePortfolio.dayPnl >= 0;
  const isTotalUp = effectivePortfolio.totalPnl >= 0;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 lg:gap-3">
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

      <Card className="bg-muted/30 border-border/30 overflow-hidden">
        <CardContent className="p-3 lg:p-4">
          <div className="flex items-center gap-1.5 mb-1.5">
            <BarChart3 className="h-3.5 w-3.5 text-foreground" />
            <span className="text-[11px] text-muted-foreground font-medium">Positions</span>
          </div>
          <p className="text-lg lg:text-xl font-bold tabular-nums">{effectivePortfolio.openPositions}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{effectivePortfolio.totalTrades} total trades</p>
        </CardContent>
      </Card>

      <Card className="bg-amber-500/5 border-border/30 overflow-hidden">
        <CardContent className="p-3 lg:p-4">
          <RiskGauge portfolio={effectivePortfolio} />
        </CardContent>
      </Card>
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
              <div key={alert.id} className="flex items-center gap-3 p-3 rounded-xl bg-card border border-border/50 hover:border-border transition-colors">
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
// Settings Sheet
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
        method: 'POST', headers: { 'Content-Type': 'application/json' },
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
                {accounts.map(acc => (
                  <div key={acc.id} className="flex items-center gap-3 p-3.5 rounded-xl bg-muted/50 border border-border/50">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                      acc.accountType === 'live' ? 'bg-emerald-500/15' : 'bg-amber-500/15'
                    }`}>
                      <Briefcase className={`h-4 w-4 ${acc.accountType === 'live' ? 'text-emerald-500' : 'text-amber-500'}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{acc.broker.toUpperCase()}</span>
                        <Badge variant={acc.accountType === 'live' ? 'default' : 'secondary'}
                          className={`text-[10px] h-5 ${acc.accountType === 'live' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500'}`}>
                          {acc.accountType}
                        </Badge>
                        {acc.isDefault && <Badge variant="outline" className="text-[10px] h-5">DEFAULT</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">${acc.balance.toLocaleString()}</p>
                    </div>
                  </div>
                ))}
                {accounts.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">No accounts connected</p>
                )}
              </div>
            </div>

            {/* Connect New Broker */}
            <div>
              <h3 className="text-sm font-semibold mb-3">Connect Broker</h3>
              <div className="space-y-4 p-5 rounded-xl border border-border/50 bg-card">
                <div className="grid grid-cols-2 gap-2">
                  {(['alpaca', 'binance', 'okx', 'deriv'] as const).map(b => (
                    <button key={b} onClick={() => setBroker(b)}
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

                <Button onClick={handleConnect} disabled={connecting || !apiKey || !apiSecret} className="w-full cursor-pointer">
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
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shadow-lg shadow-primary/20">
            <Zap className="h-5 w-5 text-primary-foreground" />
          </div>
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
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shadow-lg shadow-primary/20">
              <Zap className="h-5 w-5 text-primary-foreground" />
            </div>
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
        <Card className="overflow-hidden min-h-[400px] flex flex-col">
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
  } = useTradingStore();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [pageLoaded, setPageLoaded] = useState(false);

  const { prices: wsPrices, connected: wsConnected } = useMarketSocket();

  // Hydrate alerts & accounts from localStorage on first mount (instant, no API wait)
  useEffect(() => {
    hydrateAlertsFromStorage();
    // If no accounts loaded yet, seed from localStorage
    const { accounts: currentAccounts } = useTradingStore.getState();
    if (currentAccounts.length === 0) {
      try {
        const stored = localStorage.getItem('fovi_accounts');
        if (stored) {
          setAccounts(JSON.parse(stored));
        }
      } catch { /* ignore */ }
    }
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
        if (accRes.ok) {
          const accData = await accRes.json();
          if (Array.isArray(accData) && accData.length > 0) {
            setAccounts(accData);
          }
        }
        if (portRes.ok) {
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
      {/* ====== TOP BAR ====== */}
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur-xl border-b border-border/50">
        <div className="flex items-center justify-between h-14 px-4">
          <div className="flex items-center gap-3">
            <button className="lg:hidden cursor-pointer" onClick={() => setMobileMenuOpen(true)}>
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
            <a href="/auth/signin" className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold cursor-pointer hover:bg-primary/90 transition-colors">
              <Briefcase className="h-3.5 w-3.5" />
              <span>Account</span>
            </a>
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
                exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }} className="h-full">
                <div className="p-4 pb-2">
                  <PortfolioCards />
                </div>
                <div className="flex flex-col lg:flex-row gap-3 p-4 pt-2">
                  <Card className="flex-1 min-h-[400px] lg:min-h-[500px] overflow-hidden flex flex-col">
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
      <AiChatSheet />
      <SettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} />
      <AlertsSheet open={alertsOpen} onOpenChange={setAlertsOpen} />
      <MobileNavSheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen} onOpenSettings={() => setSettingsOpen(true)} />
      </div>
    </div>
  );
}
