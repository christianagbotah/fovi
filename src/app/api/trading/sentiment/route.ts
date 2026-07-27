import { NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';
import { getDemoPrice, BASE_PRICES } from '@/lib/broker/demo';

// -- Lazy ZAI SDK initialization (same pattern as ai-chat) ------
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
    console.error('[Sentiment] ZAI SDK init failed:', err instanceof Error ? err.message : err);
    zaiInitFailed = true;
    return null;
  }
}

// -- Sentiment keyword dictionaries ------------------------------
const POSITIVE_KEYWORDS = [
  'surge', 'rally', 'bullish', 'breakout', 'ath', 'all-time high',
  'soar', 'jump', 'gain', 'profit', 'boom', 'record', 'recover',
  'upside', 'momentum', 'adoption', 'institutional', 'upgrade',
  'outperform', 'buy', 'strong', 'growth', 'optimism', 'positive',
];

const NEGATIVE_KEYWORDS = [
  'crash', 'plunge', 'bearish', 'breakdown', 'dump', 'sell-off',
  'drop', 'fall', 'loss', 'bust', 'fear', 'recession', 'concern',
  'risk', 'warning', 'downgrade', 'overbought', 'bubble', 'correction',
  'volatile', 'decline', 'weak', 'negative', 'pessimism', 'regulation',
  'ban', 'hack', 'fraud', 'investigation', 'lawsuit',
];

// -- Headline type -----------------------------------------------
interface Headline {
  source: string;
  title: string;
  sentiment: 'positive' | 'negative' | 'neutral';
}

function classifyHeadline(title: string): 'positive' | 'negative' | 'neutral' {
  const lower = title.toLowerCase();
  let pos = 0;
  let neg = 0;
  for (const kw of POSITIVE_KEYWORDS) {
    if (lower.includes(kw.toLowerCase())) pos++;
  }
  for (const kw of NEGATIVE_KEYWORDS) {
    if (lower.includes(kw.toLowerCase())) neg++;
  }
  if (pos > neg) return 'positive';
  if (neg > pos) return 'negative';
  return 'neutral';
}

// -- Web search for market headlines ------------------------------
async function searchHeadlines(zai: NonNullable<Awaited<ReturnType<typeof getZAI>>>): Promise<Headline[]> {
  const queries = [
    'Bitcoin BTC market news today',
    'Ethereum ETH price news',
    'NVIDIA NVDA stock news today',
  ];
  const allHeadlines: Headline[] = [];

  for (const query of queries) {
    try {
      const results = await zai.web.search({ query, limit: 5 });
      const items = (results as unknown as { results?: { title?: string; url?: string }[] }).results;
      if (Array.isArray(items)) {
        for (const item of items.slice(0, 3)) {
          if (item.title) {
            allHeadlines.push({
              source: extractDomain(item.url || ''),
              title: item.title,
              sentiment: classifyHeadline(item.title),
            });
          }
        }
      }
    } catch (searchErr) {
      console.error('[Sentiment] Web search failed for query:', query, searchErr instanceof Error ? searchErr.message : searchErr);
    }
  }

  const seen = new Set<string>();
  return allHeadlines.filter(h => {
    const key = h.title.slice(0, 40).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 5);
}

function extractDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    return hostname.replace(/^www\./, '');
  } catch {
    return 'news';
  }
}

// -- Derive sentiment adjustment from headlines -------------------
function headlinesToAdjustment(headlines: Headline[]): { totalAdjustment: number; perSymbol: Record<string, number> } {
  const perSymbol: Record<string, number> = { BTC: 0, ETH: 0, NVDA: 0 };
  let total = 0;

  for (const h of headlines) {
    const upper = h.title.toUpperCase();
    let affectedSymbols: string[] = [];
    if (upper.includes('BITCOIN') || upper.includes(' BTC')) affectedSymbols.push('BTC');
    if (upper.includes('ETHEREUM') || upper.includes(' ETH')) affectedSymbols.push('ETH');
    if (upper.includes('NVIDIA') || upper.includes(' NVDA')) affectedSymbols.push('NVDA');
    if (upper.includes('CRYPTO') || upper.includes('MARKET')) {
      affectedSymbols = ['BTC', 'ETH', 'NVDA'];
    }

    const weight = h.sentiment === 'positive' ? 3 : h.sentiment === 'negative' ? -3 : 0;
    total += weight;
    for (const sym of affectedSymbols) {
      perSymbol[sym] = (perSymbol[sym] || 0) + weight;
    }
  }

  return { totalAdjustment: total, perSymbol };
}

// -- Demo sentiment baseline data ---------------------------------
const DEMO_ASSETS = [
  {
    symbol: 'BTC',
    sentiment: 72, socialVolume: 'high', trend: 'bullish',
    mentionCount: 18420, positiveMentions: 11830, negativeMentions: 6590,
  },
  {
    symbol: 'ETH',
    sentiment: 68, socialVolume: 'high', trend: 'bullish',
    mentionCount: 14210, positiveMentions: 9200, negativeMentions: 5010,
  },
  {
    symbol: 'AAPL',
    sentiment: 55, socialVolume: 'medium', trend: 'neutral',
    mentionCount: 8240, positiveMentions: 4120, negativeMentions: 4120,
  },
  {
    symbol: 'NVDA',
    sentiment: 78, socialVolume: 'high', trend: 'bullish',
    mentionCount: 22890, positiveMentions: 16320, negativeMentions: 6570,
  },
  {
    symbol: 'TSLA',
    sentiment: 42, socialVolume: 'high', trend: 'bearish',
    mentionCount: 19540, positiveMentions: 6400, negativeMentions: 13140,
  },
];

function labelForScore(score: number): string {
  if (score >= 75) return 'Extreme Greed';
  if (score >= 55) return 'Greed';
  if (score >= 45) return 'Neutral';
  if (score >= 25) return 'Fear';
  return 'Extreme Fear';
}

function trendForScore(score: number): 'bullish' | 'bearish' | 'neutral' {
  if (score >= 60) return 'bullish';
  if (score <= 40) return 'bearish';
  return 'neutral';
}

function scoreFromPriceChange(changePct: number): number {
  const clamped = Math.max(-10, Math.min(10, changePct));
  const score = 50 + clamped * 4.5;
  return Math.round(Math.max(5, Math.min(95, score)));
}

function buildDemoResponse() {
  const fearGreedIndex = 65;
  return {
    fearGreedIndex,
    label: labelForScore(fearGreedIndex),
    updatedAt: new Date().toISOString(),
    assets: DEMO_ASSETS.map((a) => ({ ...a, label: labelForScore(a.sentiment) })),
    headlines: [] as Headline[],
    source: 'demo' as const,
  };
}

export async function GET() {
  try {
    const zai = await getZAI();
    let headlines: Headline[] = [];
    let headlineAdjustment = { totalAdjustment: 0, perSymbol: {} as Record<string, number> };
    let source: 'live' | 'demo' = 'demo';

    // Try to fetch live headlines via SDK
    if (zai) {
      try {
        headlines = await searchHeadlines(zai);
        if (headlines.length > 0) {
          headlineAdjustment = headlinesToAdjustment(headlines);
          source = 'live';
        }
      } catch (searchErr) {
        console.error('[Sentiment] Headline search failed, using price-walk fallback:', searchErr instanceof Error ? searchErr.message : searchErr);
      }
    }

    // Compute sentiment scores from demo price walks for major symbols
    const symbols = ['BTC', 'ETH', 'AAPL', 'NVDA', 'TSLA'];
    const assets = symbols.map((symbol) => {
      const base = BASE_PRICES[symbol] ?? 100;
      const current = getDemoPrice(symbol);
      const changePct = ((current - base) / base) * 100;
      let sentiment = scoreFromPriceChange(changePct);

      // Blend in headline-based adjustment for BTC, ETH, NVDA
      const symAdjust = headlineAdjustment.perSymbol[symbol];
      if (symAdjust !== undefined && symAdjust !== 0) {
        sentiment = Math.round(Math.max(5, Math.min(95, sentiment + symAdjust * 2)));
      }

      const socialVolume = sentiment > 65 ? 'high' : sentiment > 40 ? 'medium' : 'low';
      const mentionCount = 5000 + Math.floor(Math.abs(sentiment - 50) * 400 + Math.random() * 2000);
      const positiveRatio = sentiment / 100;
      return {
        symbol,
        sentiment,
        label: labelForScore(sentiment),
        socialVolume,
        trend: trendForScore(sentiment),
        mentionCount,
        positiveMentions: Math.round(mentionCount * positiveRatio),
        negativeMentions: Math.round(mentionCount * (1 - positiveRatio)),
      };
    });

    const fearGreedIndex = Math.round(
      assets.reduce((s, a) => s + a.sentiment, 0) / assets.length,
    );

    return NextResponse.json({
      fearGreedIndex,
      label: labelForScore(fearGreedIndex),
      updatedAt: new Date().toISOString(),
      assets,
      headlines,
      source,
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('validating datasource')) {
      return NextResponse.json(buildDemoResponse());
    }
    return NextResponse.json(buildDemoResponse());
  }
}

// Touch db to ensure the import is meaningful in case db becomes required later
void db;
void hasModel;
