import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';
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

// Lazy ZAI SDK initialization with error tolerance
let zaiInstance: Awaited<ReturnType<typeof import('z-ai-web-dev-sdk').default.create>> | null = null;
let zaiInitFailed = false;

async function getZAI() {
  if (zaiInitFailed) return null;
  if (zaiInstance) return zaiInstance;
  try {
    const ZAI = (await import('z-ai-web-dev-sdk')).default;
    zaiInstance = await ZAI.create();
    return zaiInstance;
  } catch (err) {
    console.error('[ZAI SDK] Failed to initialize (AI chat unavailable):', err instanceof Error ? err.message : err);
    zaiInitFailed = true;
    return null;
  }
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

// Fallback AI response using simple rule-based analysis when SDK is unavailable
function generateFallbackResponse(message: string, marketContext: string, symbolContext: string): string {
  const lower = message.toLowerCase();
  
  // Check for specific symbol queries
  const symbolMatch = message.match(/\b([A-Z]{2,6})\b/);
  const symbol = symbolMatch ? symbolMatch[1] : null;
  
  if (lower.includes('help') || lower.includes('what can')) {
    return `**Fovi AI Trading Assistant** 🤖\n\nI can help you with:\n- **Market Analysis** — Ask about any symbol (e.g., "Analyze AAPL" or "What's happening with BTC?")\n- **Trading Signals** — I provide AI-generated signals based on technical analysis\n- **Risk Management** — Position sizing and portfolio advice\n- **Market Overview** — Current market conditions and trends\n\n*Note: AI chat is currently running in offline mode. Full AI capabilities require network connectivity.*`;
  }
  
  if (symbol && (lower.includes('analyze') || lower.includes('analysis') || lower.includes('what') || lower.includes('how') || lower.includes('price') || lower.includes('buy') || lower.includes('sell'))) {
    const symbols = getAllDemoSymbols();
    const sym = symbols.find(s => s.symbol === symbol.toUpperCase());
    if (sym) {
      const trend = sym.changePercent >= 0 ? 'bullish' : 'bearish';
      const arrow = sym.changePercent >= 0 ? '↑' : '↓';
      return `**${sym.symbol} Analysis** (${sym.assetType})\n\n**Current Price:** $${sym.price.toFixed(2)} ${arrow} ${sym.changePercent >= 0 ? '+' : ''}${sym.changePercent.toFixed(2)}%\n**Trend:** ${trend.charAt(0).toUpperCase() + trend.slice(1)}\n\n${symbolContext ? '**Technical Indicators:**' + symbolContext : ''}\n\n*⚠️ AI chat is in offline mode. Full technical analysis requires network connectivity. Connect Alpaca or Binance for live data.*`;
    }
  }
  
  if (lower.includes('market') || lower.includes('overview') || lower.includes('summary')) {
    return `**Market Overview**\n\n${marketContext}\n*⚠️ Running in offline mode. Real-time AI analysis requires network connectivity.*`;
  }
  
  return `I'm currently running in **offline mode** — full AI capabilities require network connectivity to the Fovi AI backend.\n\nYou can still:\n- View real-time prices and charts\n- Place and manage trades\n- Receive AI trading signals\n- Connect your broker accounts\n\nTry asking me to **analyze a specific symbol** (e.g., "Analyze NVDA") for a quick technical overview, or check the **Markets** tab for live data.`;
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

    let aiResponse: string;

    if (zai) {
      // Full AI mode — SDK is available
      const enhancedMessage = symbolContext
        ? `${message}\n\n[Here is the current technical analysis data for context:]${symbolContext}${marketContext}`
        : `${message}${marketContext}`;

      history.push({ role: 'user', content: enhancedMessage });
      const trimmedHistory = trimConversation(history);

      try {
        const completion = await zai.chat.completions.create({
          messages: trimmedHistory.map(m => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
          })),
          thinking: { type: 'disabled' },
        });

        aiResponse = completion.choices[0]?.message?.content ||
          'I apologize, but I was unable to generate a response. Please try again.';
      } catch (sdkErr) {
        console.error('[ZAI SDK] Chat completion failed:', sdkErr instanceof Error ? sdkErr.message : sdkErr);
        zaiInitFailed = true;
        zaiInstance = null;
        // Fallback to offline response
        history.push({ role: 'user', content: message });
        aiResponse = generateFallbackResponse(message, marketContext, symbolContext);
      }
    } else {
      // Offline mode — SDK unavailable
      history.push({ role: 'user', content: message });
      aiResponse = generateFallbackResponse(message, marketContext, symbolContext);
    }

    // Save to DB for persistence (non-critical)
    if (db && hasModel('aiConversation')) {
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
      } catch (error) {
        // DB save is non-critical — keep returning the AI response as fallback.
        // Includes Prisma validation errors (e.g., "Error validating datasource `db`:
        // the URL must start with the protocol `postgresql://`") which happen when
        // PrismaClient construction succeeded but the DB URL is misconfigured.
        if (error instanceof Error && error.message.includes('validating datasource')) {
          console.warn('[AI Chat] DB unavailable (Prisma validation error) — skipping persistence');
        }
      }
    }

    // Update history (store the original message, not the enhanced one)
    history.push({ role: 'assistant', content: aiResponse });
    conversations.set(sessionId, trimConversation(history));

    return NextResponse.json({
      success: true,
      response: aiResponse,
      offline: !zai,
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
