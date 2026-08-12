// ============================================================
// Public: List active brokers available for users to link
// ============================================================

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  if (!db) {
    return NextResponse.json(DEFAULT_BROKERS, { headers: { 'x-demo': 'true' } });
  }
  try {
    const providers = await db.brokerProvider.findMany({
      where: { isActive: true, deleted: false },
      orderBy: { sortOrder: 'asc' },
      select: {
        code: true,
        displayName: true,
        description: true,
        brokerType: true,
        iconColor: true,
        requiresApiKey: true,
        requiresSecret: true,
        requiresPassphrase: true,
        assetTypes: true,
        supportedFeatures: true,
      },
    });
    return NextResponse.json(providers);
  } catch (err) {
    console.error('[brokers] GET error:', err);
    // Fallback: return hardcoded defaults so the app works even without DB
    return NextResponse.json(DEFAULT_BROKERS, { headers: { 'x-demo': 'true' } });
  }
}

// Fallback defaults when DB is not available (e.g., demo mode)
const DEFAULT_BROKERS = [
  { code: 'demo', displayName: 'Demo (Simulated)', description: 'Paper trading with simulated prices', brokerType: 'demo', iconColor: '#F59E0B', requiresApiKey: false, requiresSecret: false, requiresPassphrase: false, assetTypes: '["stock","crypto","forex","commodity","index"]', supportedFeatures: '["spot"]' },
  { code: 'alpaca', displayName: 'Alpaca', description: 'US Stocks & ETFs', brokerType: 'stocks', iconColor: '#2962FF', requiresApiKey: true, requiresSecret: true, requiresPassphrase: false, assetTypes: '["stock"]', supportedFeatures: '["spot"]' },
  { code: 'binance', displayName: 'Binance', description: 'Crypto spot trading', brokerType: 'crypto', iconColor: '#F0B90B', requiresApiKey: true, requiresSecret: true, requiresPassphrase: false, assetTypes: '["crypto"]', supportedFeatures: '["spot","futures"]' },
  { code: 'okx', displayName: 'OKX', description: 'Crypto spot & derivatives', brokerType: 'crypto', iconColor: '#FFFFFF', requiresApiKey: true, requiresSecret: true, requiresPassphrase: true, assetTypes: '["crypto"]', supportedFeatures: '["spot","futures","options"]' },
  { code: 'bybit', displayName: 'Bybit', description: 'Crypto spot & linear contracts', brokerType: 'crypto', iconColor: '#F7A600', requiresApiKey: true, requiresSecret: true, requiresPassphrase: false, assetTypes: '["crypto"]', supportedFeatures: '["spot","futures"]' },
  { code: 'bitget', displayName: 'Bitget', description: 'Crypto spot trading', brokerType: 'crypto', iconColor: '#00F0FF', requiresApiKey: true, requiresSecret: true, requiresPassphrase: true, assetTypes: '["crypto"]', supportedFeatures: '["spot"]' },
  { code: 'mt5', displayName: 'MetaTrader 5', description: 'Forex, CFD, Stocks & Commodities via MetaAPI', brokerType: 'forex', iconColor: '#0072BC', requiresApiKey: true, requiresSecret: false, requiresPassphrase: false, assetTypes: '["forex","stock","commodity","cfd"]', supportedFeatures: '["spot","futures"]' },
];
