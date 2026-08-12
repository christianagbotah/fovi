// ============================================================
// Admin: Seed default brokers into the database
// Idempotent — skips brokers that already exist by code
// ============================================================

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

const DEFAULT_BROKERS = [
  { code: 'demo', displayName: 'Demo (Simulated)', description: 'Paper trading with $100,000 simulated balance', brokerType: 'demo', iconColor: '#F59E0B', requiresApiKey: false, requiresSecret: false, requiresPassphrase: false, assetTypes: '["stock","crypto","forex","commodity","index"]', supportedFeatures: '["spot"]', sortOrder: 0 },
  { code: 'alpaca', displayName: 'Alpaca', description: 'US Stocks & ETFs', brokerType: 'stocks', iconColor: '#2962FF', requiresApiKey: true, requiresSecret: true, requiresPassphrase: false, assetTypes: '["stock"]', supportedFeatures: '["spot"]', sortOrder: 1 },
  { code: 'binance', displayName: 'Binance', description: 'Crypto spot & futures trading', brokerType: 'crypto', iconColor: '#F0B90B', requiresApiKey: true, requiresSecret: true, requiresPassphrase: false, assetTypes: '["crypto"]', supportedFeatures: '["spot","futures"]', sortOrder: 2 },
  { code: 'okx', displayName: 'OKX', description: 'Crypto spot, futures & options', brokerType: 'crypto', iconColor: '#FFFFFF', requiresApiKey: true, requiresSecret: true, requiresPassphrase: true, assetTypes: '["crypto"]', supportedFeatures: '["spot","futures","options"]', sortOrder: 3 },
  { code: 'bybit', displayName: 'Bybit', description: 'Crypto spot & linear contracts', brokerType: 'crypto', iconColor: '#F7A600', requiresApiKey: true, requiresSecret: true, requiresPassphrase: false, assetTypes: '["crypto"]', supportedFeatures: '["spot","futures"]', sortOrder: 4 },
  { code: 'bitget', displayName: 'Bitget', description: 'Crypto spot trading', brokerType: 'crypto', iconColor: '#00F0FF', requiresApiKey: true, requiresSecret: true, requiresPassphrase: true, assetTypes: '["crypto"]', supportedFeatures: '["spot"]', sortOrder: 5 },
  { code: 'mt5', displayName: 'MetaTrader 5', description: 'Forex, CFD, Stocks & Commodities via MetaAPI.cloud', brokerType: 'forex', iconColor: '#0072BC', requiresApiKey: true, requiresSecret: false, requiresPassphrase: false, assetTypes: '["forex","stock","commodity","cfd"]', supportedFeatures: '["spot","futures"]', sortOrder: 6 },
];

export async function POST() {
  try {
    let created = 0;
    let skipped = 0;

    for (const broker of DEFAULT_BROKERS) {
      const existing = await db.brokerProvider.findUnique({ where: { code: broker.code } });
      if (existing) {
        skipped++;
        continue;
      }
      await db.brokerProvider.create({ data: broker });
      created++;
    }

    const total = await db.brokerProvider.count();
    return NextResponse.json({ created, skipped, total });
  } catch (err) {
    console.error('[admin/brokers/seed] error:', err);
    return NextResponse.json({ error: 'Seed failed — database may not be available' }, { status: 500 });
  }
}
