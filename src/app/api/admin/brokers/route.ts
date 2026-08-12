// ============================================================
// Admin: CRUD for Broker Providers
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  try {
    const providers = await db.brokerProvider.findMany({
      orderBy: { sortOrder: 'asc' },
    });
    return NextResponse.json(providers);
  } catch (err) {
    console.error('[admin/brokers] GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch brokers' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      code, displayName, description, brokerType, iconColor,
      requiresApiKey, requiresSecret, requiresPassphrase,
      liveBaseUrl, testnetBaseUrl,
      authType, apiKeyHeader, symbolFormat, customEndpoints,
      assetTypes, supportedFeatures, sortOrder,
    } = body;

    if (!code || !displayName) {
      return NextResponse.json({ error: 'code and displayName are required' }, { status: 400 });
    }

    const provider = await db.brokerProvider.create({
      data: {
        code: code.toLowerCase().trim(),
        displayName,
        description: description || '',
        brokerType: brokerType || 'crypto',
        iconColor: iconColor || '#6366F1',
        requiresApiKey: requiresApiKey !== false,
        requiresSecret: requiresSecret !== false,
        requiresPassphrase: requiresPassphrase === true,
        liveBaseUrl: liveBaseUrl || '',
        testnetBaseUrl: testnetBaseUrl || '',
        authType: authType || 'none',
        apiKeyHeader: apiKeyHeader || '',
        symbolFormat: symbolFormat || 'pair',
        customEndpoints: typeof customEndpoints === 'object'
          ? JSON.stringify(customEndpoints)
          : (customEndpoints || '{}'),
        assetTypes: JSON.stringify(assetTypes || []),
        supportedFeatures: JSON.stringify(supportedFeatures || []),
        sortOrder: sortOrder ?? 0,
      },
    });

    return NextResponse.json(provider, { status: 201 });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return NextResponse.json({ error: `Broker with code '${err.meta?.target}' already exists` }, { status: 409 });
    }
    console.error('[admin/brokers] POST error:', err);
    return NextResponse.json({ error: 'Failed to create broker' }, { status: 500 });
  }
}
