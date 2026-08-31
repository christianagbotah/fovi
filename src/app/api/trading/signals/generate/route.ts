import { NextRequest, NextResponse } from 'next/server';
import { getUserId, AuthRequiredError, authRequiredResponse } from '@/lib/get-user-id';
import { generateSignals } from '@/lib/ai/signals';
import { getAssetType } from '@/lib/broker/demo';
import {
  getVerifiedCandles,
  VERIFIED_CRYPTO_SYMBOLS,
  toProvenance,
} from '@/lib/verified-market-data';
import type { Timeframe } from '@/lib/types';

const SCAN_SYMBOLS = [...VERIFIED_CRYPTO_SYMBOLS];

function getTimeframeMs(tf: Timeframe): number {
  const map: Record<Timeframe, number> = {
    '1m': 60_000, '5m': 300_000, '15m': 900_000,
    '1h': 3_600_000, '4h': 14_400_000, '1d': 86_400_000, '1w': 604_800_000,
  };
  return map[tf];
}

interface SignalOutput {
  id: string;
  symbol: string;
  assetType: string;
  direction: string;
  confidence: number;
  signalType: string;
  timeframe: Timeframe;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  reasoning: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  dataProvenance: {
    environment: 'live';
    isSynthetic: false;
    source: string;
    observedAt: string;
    volumeAvailable: false;
  };
}

export async function POST(req: NextRequest) {
  try {
    await getUserId(req);

    const body = await req.json().catch(() => ({}));
    const requestedSymbol = typeof body.symbol === 'string' ? body.symbol.trim().toUpperCase() : '';
    const timeframe = (typeof body.timeframe === 'string' ? body.timeframe : '4h') as Timeframe;
    const riskTolerance = body.riskTolerance || 'medium';
    const symbols = requestedSymbol ? [requestedSymbol] : SCAN_SYMBOLS;

    if (timeframe !== '4h') {
      return NextResponse.json(
        { error: `Verified ${timeframe} signal data is not currently available`, code: 'UNSUPPORTED_MARKET_DATA', dataPolicy: 'verified-only' },
        { status: 422, headers: { 'x-data-policy': 'verified-only' } },
      );
    }

    const allSignals: SignalOutput[] = [];
    const unavailable: Array<{ symbol: string; code: string }> = [];
    const now = new Date();
    const expiresAt = new Date(now.getTime() + getTimeframeMs(timeframe) * 3);

    for (const symbol of symbols) {
      const candleResult = await getVerifiedCandles(symbol, timeframe, 100);
      if (!candleResult.ok) {
        unavailable.push({ symbol, code: candleResult.code });
        continue;
      }

      const candidates = generateSignals(symbol, candleResult.candles, timeframe, riskTolerance);
      const lastClose = candleResult.candles[candleResult.candles.length - 1]?.close ?? 0;
      const prov = toProvenance(candleResult.metadata);

      for (const candidate of candidates) {
        allSignals.push({
          id: `sig_${crypto.randomUUID()}`,
          symbol,
          assetType: getAssetType(symbol),
          direction: candidate.direction,
          confidence: Math.round(candidate.confidence),
          signalType: candidate.signalType,
          timeframe,
          entryPrice: candidate.entryPrice || lastClose,
          stopLoss: candidate.stopLoss || 0,
          takeProfit: candidate.takeProfit || 0,
          reasoning: candidate.reasoning,
          status: 'active',
          createdAt: now.toISOString(),
          expiresAt: expiresAt.toISOString(),
          dataProvenance: {
            environment: 'live', isSynthetic: false, source: prov.source,
            observedAt: prov.observedAt, volumeAvailable: false,
          },
        });
      }
    }

    if (requestedSymbol && allSignals.length === 0 && unavailable.length > 0) {
      const code = unavailable[0].code;
      return NextResponse.json(
        { error: `Verified market data is unavailable for ${requestedSymbol}`, code, dataPolicy: 'verified-only' },
        { status: code === 'UNSUPPORTED_MARKET_DATA' ? 422 : 503, headers: { 'x-data-policy': 'verified-only' } },
      );
    }

    return NextResponse.json(allSignals, {
      headers: { 'x-data-policy': 'verified-only', 'x-unavailable-symbol-count': String(unavailable.length) },
    });
  } catch (error) {
    if (error instanceof AuthRequiredError) return authRequiredResponse();
    console.error('[signals/generate] Error:', error);
    return NextResponse.json({ error: 'Failed to generate verified signals' }, { status: 500 });
  }
}
