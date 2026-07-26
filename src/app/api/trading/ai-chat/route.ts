import { NextRequest, NextResponse } from 'next/server';
import ZAI from 'z-ai-web-dev-sdk';
import { db } from '@/lib/db';
import { getAllDemoSymbols } from '@/lib/broker/demo';
import { generateAnalysisSummary } from '@/lib/ai/signals';
import { getDemoCandles } from '@/lib/broker/demo';

const TRADING_SYSTEM_PROMPT = `You are Fovi AI, a world-class AI trading assistant integrated into the Fovi auto-trading platform. You have deep expertise in:
- Technical analysis (RSI, MACD, Bollinger Bands, Stochastic, ADX, ATR, candlestick patterns)
- Risk management and position sizing
- Market psychology and sentiment analysis
- Multi-asset trading (stocks, crypto, forex, commodities, indices)
- Algorithmic trading strategies

Your tone is professional, concise, and actionable. You provide specific trade ideas with entry, stop-loss, and take-profit levels. You always mention risk considerations. You never guarantee profits.

You have access to real-time market data for these symbols and can analyze any of them. When users ask about a specific symbol, provide a detailed technical analysis with actionable insights.

Important: You are powered by AI and should always add appropriate disclaimers about risk when giving trading advice.`;

// In-memory conversation storage (per session)
const conversations = new Map<string, { role: string; content: string }[]>();
const MAX_HISTORY = 20;

let zaiInstance: Awaited<ReturnType<typeof ZAI.create>> | null = null;

async function getZAI() {
  if (!zaiInstance) {
    zaiInstance = await ZAI.create();
  }
  return zaiInstance;
}

function getConversation(sessionId: string) {
  if (!conversations.has(sessionId)) {
    conversations.set(sessionId, [
      { role: 'assistant', content: TRADING_SYSTEM_PROMPT },
    ]);
  }
  return conversations.get(sessionId)!;
}

function trimConversation(history: { role: string; content: string }[]) {
  if (history.length <= MAX_HISTORY) return history;
  return [history[0], ...history.slice(-(MAX_HISTORY - 1))];
}

function buildMarketContext(): string {
  const symbols = getAllDemoSymbols();
  const topMovers = [...symbols]
    .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent))
    .slice(0, 8);

  let context = '\n\n**Current Market Snapshot:**\n';
  for (const s of topMovers) {
    const arrow = s.changePercent >= 0 ? '↑' : '↓';
    context += `- ${s.symbol} ($${s.price.toFixed(2)}): ${arrow} ${s.changePercent >= 0 ? '+' : ''}${s.changePercent.toFixed(2)}%\n`;
  }
  return context;
}

function buildSymbolAnalysis(symbol: string): string {
  const validSymbols = ['AAPL', 'GOOGL', 'MSFT', 'AMZN', 'NVDA', 'TSLA', 'META', 'NFLX', 'AMD', 'INTC',
    'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'AVAX', 'DOT', 'LINK',
    'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'XAUUSD', 'XAGUSD', 'US30', 'NAS100'];

  if (!validSymbols.includes(symbol.toUpperCase())) return '';

  try {
    const candles = getDemoCandles(symbol.toUpperCase(), '1d', 100);
    if (candles.length >= 30) {
      return '\n\n**Technical Analysis for ' + symbol.toUpperCase() + ':**\n' +
        generateAnalysisSummary(symbol.toUpperCase(), candles);
    }
  } catch {
    // fallback: no analysis
  }
  return '';
}

export async function POST(req: NextRequest) {
  try {
    const { message, sessionId = 'default' } = await req.json();

    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    const zai = await getZAI();
    const history = getConversation(sessionId);

    // Build enhanced prompt with market context
    const marketContext = buildMarketContext();

    // Check if user is asking about a specific symbol
    const symbolMatch = message.match(/\b([A-Z]{2,6})\b/);
    let symbolContext = '';
    if (symbolMatch) {
      const possibleSymbol = symbolMatch[1];
      symbolContext = buildSymbolAnalysis(possibleSymbol);
    }

    // Add user message with context
    const enhancedMessage = symbolContext
      ? `${message}\n\n[Here is the current technical analysis data for context:]${symbolContext}${marketContext}`
      : `${message}${marketContext}`;

    history.push({ role: 'user', content: enhancedMessage });

    // Trim if too long
    const trimmedHistory = trimConversation(history);

    const completion = await zai.chat.completions.create({
      messages: trimmedHistory.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      thinking: { type: 'disabled' },
    });

    const aiResponse = completion.choices[0]?.message?.content ||
      'I apologize, but I was unable to generate a response. Please try again.';

    // Save to DB for persistence
    try {
      const userId = 'usr_demo_1';
      let conversation = await db.aiConversation.findFirst({
        where: { userId, id: sessionId },
      });

      if (!conversation) {
        conversation = await db.aiConversation.create({
          data: { id: sessionId, userId, title: message.slice(0, 50) },
        });
      }

      await db.aiMessage.createMany({
        data: [
          { conversationId: conversation.id, role: 'user', content: message },
          { conversationId: conversation.id, role: 'assistant', content: aiResponse },
        ],
      });
    } catch {
      // DB save is non-critical
    }

    // Update history (store the original message, not the enhanced one)
    history.push({ role: 'assistant', content: aiResponse });
    conversations.set(sessionId, trimConversation(history));

    return NextResponse.json({
      success: true,
      response: aiResponse,
      messageCount: history.length - 1,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'AI chat failed';
    console.error('[AI Chat Error]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get('sessionId') || 'default';
  conversations.delete(sessionId);
  return NextResponse.json({ success: true });
}
