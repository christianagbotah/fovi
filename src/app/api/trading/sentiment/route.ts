import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getDemoPrice, BASE_PRICES } from '@/lib/broker/demo';

// Demo sentiment baseline data
const DEMO_ASSETS = [
  {
    symbol: 'BTC',
    sentiment: 72,
    socialVolume: 'high',
    trend: 'bullish',
    mentionCount: 18420,
    positiveMentions: 11830,
    negativeMentions: 6590,
  },
  {
    symbol: 'ETH',
    sentiment: 68,
    socialVolume: 'high',
    trend: 'bullish',
    mentionCount: 14210,
    positiveMentions: 9200,
    negativeMentions: 5010,
  },
  {
    symbol: 'AAPL',
    sentiment: 55,
    socialVolume: 'medium',
    trend: 'neutral',
    mentionCount: 8240,
    positiveMentions: 4120,
    negativeMentions: 4120,
  },
  {
    symbol: 'NVDA',
    sentiment: 78,
    socialVolume: 'high',
    trend: 'bullish',
    mentionCount: 22890,
    positiveMentions: 16320,
    negativeMentions: 6570,
  },
  {
    symbol: 'TSLA',
    sentiment: 42,
    socialVolume: 'high',
    trend: 'bearish',
    mentionCount: 19540,
    positiveMentions: 6400,
    negativeMentions: 13140,
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

// Derive a sentiment score (0-100) from a price change percentage.
// Positive change → higher sentiment; negative → lower.
function scoreFromPriceChange(changePct: number): number {
  // Clamp change to [-10, +10] then map to [10, 95]
  const clamped = Math.max(-10, Math.min(10, changePct));
  const score = 50 + clamped * 4.5; // 50 +/- 45
  return Math.round(Math.max(5, Math.min(95, score)));
}

function buildDemoResponse() {
  const fearGreedIndex = 65;
  return {
    fearGreedIndex,
    label: labelForScore(fearGreedIndex),
    updatedAt: new Date().toISOString(),
    assets: DEMO_ASSETS.map((a) => ({ ...a, label: labelForScore(a.sentiment) })),
    source: 'demo',
  };
}

export async function GET() {
  // We always generate demo data — sentiment can't be fetched from external APIs here.
  // If db is available we still use deterministic demo values, but we can layer on
  // recent price changes from the demo broker to make values feel more dynamic.

  try {
    // Compute live sentiment scores from demo price walks for major symbols
    const symbols = ['BTC', 'ETH', 'AAPL', 'NVDA', 'TSLA'];
    const assets = symbols.map((symbol) => {
      const base = BASE_PRICES[symbol] ?? 100;
      const current = getDemoPrice(symbol);
      const changePct = ((current - base) / base) * 100;
      const sentiment = scoreFromPriceChange(changePct);
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
      source: 'demo',
    });
  } catch (error: unknown) {
    // Fallback to hardcoded demo data
    if (error instanceof Error && error.message.includes('validating datasource')) {
      return NextResponse.json(buildDemoResponse());
    }
    // Even on unexpected error, return demo data — sentiment must not break the UI
    return NextResponse.json(buildDemoResponse());
  }
}

// Touch db to ensure the import is meaningful in case db becomes required later
void db;
