import { NextResponse } from 'next/server';
import { getAllDemoSymbols } from '@/lib/broker/demo';
import { fetchAllRealPrices } from '@/lib/market-data';
import { provenanceHeaders, createDemoProvenance, type Provenance } from '@/lib/provenance';
import {
  getVerifiedQuote,
  getVerifiedCandles,
  normalizeMarketSymbol,
  toProvenance,
  type MarketDataFailureCode,
} from '@/lib/verified-market-data';
import type { Timeframe } from '@/lib/types';

function failureStatus(code: MarketDataFailureCode): number {
  if (code === 'UNSUPPORTED_MARKET_DATA' || code === 'TIMEFRAME_MISMATCH') return 422;
  return 503;
}

function failureResponse(code: MarketDataFailureCode, message: string) {
  return NextResponse.json(
    { error: message, code, dataPolicy: 'verified-only' },
    { status: failureStatus(code), headers: { 'x-data-policy': 'verified-only' } },
  );
}

export async function GET(req: globalThis.Request) {
  const { searchParams } = new URL(req.url);
  const rawSymbol = searchParams.get('symbol');
  const timeframeParam = searchParams.get('timeframe');
  const limit = Math.max(1, Math.min(500, Number.parseInt(searchParams.get('limit') || '100', 10) || 100));

  if (rawSymbol && !timeframeParam) {
    const result = await getVerifiedQuote(rawSymbol);
    if (!result.ok) return failureResponse(result.code, result.message);

    const provenance = toProvenance(result.metadata);
    return NextResponse.json(
      {
        symbol: result.quote.symbol,
        price: result.quote.price,
        volume: result.quote.volume,
        changePercent: result.quote.changePercent24h,
        _realData: true,
        provenance,
        dataPolicy: 'verified-only',
      },
      { headers: { ...provenanceHeaders(provenance), 'x-data-policy': 'verified-only' } },
    );
  }

  if (rawSymbol && timeframeParam) {
    const symbol = normalizeMarketSymbol(rawSymbol);
    const timeframe = timeframeParam as Timeframe;
    const result = await getVerifiedCandles(symbol, timeframe, limit);
    if (!result.ok) return failureResponse(result.code, result.message);

    const provenance = toProvenance(result.metadata);
    return NextResponse.json(
      {
        candles: result.candles,
        provenance,
        timeframe: result.metadata.timeframe,
        volumeAvailable: result.metadata.volumeAvailable,
        dataPolicy: 'verified-only',
      },
      { headers: { ...provenanceHeaders(provenance), 'x-data-policy': 'verified-only' } },
    );
  }

  // Presentation-only market overview. Auto-trade and signal generation never
  // consume this mixed real/demo list.
  const [realPricesMap, demoSymbols] = await Promise.all([
    fetchAllRealPrices(),
    Promise.resolve(getAllDemoSymbols()),
  ]);

  const enrichedSymbols = demoSymbols.map((sym) => {
    const real = realPricesMap.get(sym.symbol);
    if (real) {
      const provenance: Provenance = {
        environment: 'unknown',
        isSynthetic: false,
        source: 'legacy-market-overview',
        observedAt: new Date().toISOString(),
      };
      return {
        ...sym,
        price: real.price,
        change: real.change,
        changePercent: real.changePercent,
        volume: real.volume,
        high24h: real.high24h,
        low24h: real.low24h,
        provenance,
        tradeable: false,
      };
    }
    const provenance = createDemoProvenance();
    return { ...sym, provenance, tradeable: false };
  });

  return NextResponse.json(enrichedSymbols, { headers: { 'x-data-policy': 'presentation-only' } });
}
