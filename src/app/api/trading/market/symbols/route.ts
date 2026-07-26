import { NextResponse } from 'next/server';
import { getAllDemoSymbols, getDemoCandles } from '@/lib/broker/demo';
import { generateSignals } from '@/lib/ai/signals';

export async function GET(req: globalThis.Request) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get('symbol');
  const timeframe = searchParams.get('timeframe') || '1d';
  const limit = parseInt(searchParams.get('limit') || '100');

  // Get candles for a specific symbol
  if (symbol) {
    const candles = getDemoCandles(symbol, timeframe, limit);
    return NextResponse.json(candles);
  }

  // Get all available symbols
  const symbols = getAllDemoSymbols();
  return NextResponse.json(symbols);
}
