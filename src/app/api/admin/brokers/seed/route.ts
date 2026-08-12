// ============================================================
// Admin: Seed default brokers into the database
// Idempotent — skips brokers that already exist by code
// Also updates existing brokers with any new fields
// ============================================================

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

const DEFAULT_BROKERS = [
  {
    code: 'demo', displayName: 'Demo (Simulated)', description: 'Paper trading with $100,000 simulated balance',
    brokerType: 'demo', iconColor: '#F59E0B',
    requiresApiKey: false, requiresSecret: false, requiresPassphrase: false,
    liveBaseUrl: '', testnetBaseUrl: '',
    authType: 'none', apiKeyHeader: '', symbolFormat: 'pair',
    assetTypes: '["stock","crypto","forex","commodity","index"]',
    supportedFeatures: '["spot"]',
    customEndpoints: '{}',
    sortOrder: 0,
  },
  {
    code: 'alpaca', displayName: 'Alpaca', description: 'US Stocks & ETFs',
    brokerType: 'stocks', iconColor: '#2962FF',
    requiresApiKey: true, requiresSecret: true, requiresPassphrase: false,
    liveBaseUrl: 'https://api.alpaca.markets', testnetBaseUrl: 'https://paper-api.alpaca.markets',
    authType: 'api_key_header', apiKeyHeader: 'APCA-API-KEY-ID', symbolFormat: 'pair',
    assetTypes: '["stock"]',
    supportedFeatures: '["spot"]',
    customEndpoints: '{}',
    sortOrder: 1,
  },
  {
    code: 'binance', displayName: 'Binance', description: 'Crypto spot & futures trading',
    brokerType: 'crypto', iconColor: '#F0B90B',
    requiresApiKey: true, requiresSecret: true, requiresPassphrase: false,
    liveBaseUrl: 'https://api.binance.com', testnetBaseUrl: 'https://testnet.binance.vision',
    authType: 'hmac_sha256', apiKeyHeader: 'X-MBX-APIKEY', symbolFormat: 'pair',
    assetTypes: '["crypto"]',
    supportedFeatures: '["spot","futures"]',
    customEndpoints: '{}',
    sortOrder: 2,
  },
  {
    code: 'okx', displayName: 'OKX', description: 'Crypto spot, futures & options',
    brokerType: 'crypto', iconColor: '#FFFFFF',
    requiresApiKey: true, requiresSecret: true, requiresPassphrase: true,
    liveBaseUrl: 'https://www.okx.com', testnetBaseUrl: 'https://www.okx.com',
    authType: 'hmac_sha256_base64', apiKeyHeader: 'OK-ACCESS-KEY', symbolFormat: 'dash',
    assetTypes: '["crypto"]',
    supportedFeatures: '["spot","futures","options"]',
    customEndpoints: '{}',
    sortOrder: 3,
  },
  {
    code: 'bybit', displayName: 'Bybit', description: 'Crypto spot & linear contracts',
    brokerType: 'crypto', iconColor: '#F7A600',
    requiresApiKey: true, requiresSecret: true, requiresPassphrase: false,
    liveBaseUrl: 'https://api.bybit.com', testnetBaseUrl: 'https://api-testnet.bybit.com',
    authType: 'hmac_sha256', apiKeyHeader: 'X-BAPI-API-KEY', symbolFormat: 'pair',
    assetTypes: '["crypto"]',
    supportedFeatures: '["spot","futures"]',
    customEndpoints: '{}',
    sortOrder: 4,
  },
  {
    code: 'bitget', displayName: 'Bitget', description: 'Crypto spot trading',
    brokerType: 'crypto', iconColor: '#00F0FF',
    requiresApiKey: true, requiresSecret: true, requiresPassphrase: true,
    liveBaseUrl: 'https://api.bitget.com', testnetBaseUrl: 'https://api.bitget.com',
    authType: 'hmac_sha256_base64', apiKeyHeader: 'ACCESS-KEY', symbolFormat: 'pair',
    assetTypes: '["crypto"]',
    supportedFeatures: '["spot"]',
    customEndpoints: '{}',
    sortOrder: 5,
  },
  {
    code: 'mt5', displayName: 'MetaTrader 5', description: 'Forex, CFD, Stocks & Commodities via MetaAPI.cloud',
    brokerType: 'forex', iconColor: '#0072BC',
    requiresApiKey: true, requiresSecret: false, requiresPassphrase: false,
    liveBaseUrl: 'https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.io', testnetBaseUrl: '',
    authType: 'api_key_header', apiKeyHeader: 'auth-token', symbolFormat: 'pair',
    assetTypes: '["forex","stock","commodity","cfd"]',
    supportedFeatures: '["spot","futures"]',
    customEndpoints: '{}',
    sortOrder: 6,
  },
];

export async function POST() {
  try {
    let created = 0;
    let skipped = 0;
    let updated = 0;

    for (const broker of DEFAULT_BROKERS) {
      const existing = await db.brokerProvider.findUnique({ where: { code: broker.code } });
      if (existing) {
        // Update existing brokers with new fields
        await db.brokerProvider.update({
          where: { code: broker.code },
          data: {
            liveBaseUrl: broker.liveBaseUrl,
            testnetBaseUrl: broker.testnetBaseUrl,
            authType: broker.authType,
            apiKeyHeader: broker.apiKeyHeader,
            symbolFormat: broker.symbolFormat,
          },
        });
        skipped++;
        updated++;
        continue;
      }
      await db.brokerProvider.create({ data: broker });
      created++;
    }

    const total = await db.brokerProvider.count();
    return NextResponse.json({ created, skipped, updated, total });
  } catch (err) {
    console.error('[admin/brokers/seed] error:', err);
    return NextResponse.json({ error: 'Seed failed — database may not be available' }, { status: 500 });
  }
}
