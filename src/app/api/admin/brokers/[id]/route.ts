// ============================================================
// Admin: Update / Delete a single Broker Provider
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json();

    const data: Record<string, any> = {};
    if (body.code !== undefined) data.code = body.code.toLowerCase().trim();
    if (body.displayName !== undefined) data.displayName = body.displayName;
    if (body.description !== undefined) data.description = body.description;
    if (body.brokerType !== undefined) data.brokerType = body.brokerType;
    if (body.iconColor !== undefined) data.iconColor = body.iconColor;
    if (body.isActive !== undefined) data.isActive = body.isActive;
    if (body.requiresApiKey !== undefined) data.requiresApiKey = body.requiresApiKey;
    if (body.requiresSecret !== undefined) data.requiresSecret = body.requiresSecret;
    if (body.requiresPassphrase !== undefined) data.requiresPassphrase = body.requiresPassphrase;
    if (body.liveBaseUrl !== undefined) data.liveBaseUrl = body.liveBaseUrl;
    if (body.testnetBaseUrl !== undefined) data.testnetBaseUrl = body.testnetBaseUrl;
    if (body.authType !== undefined) data.authType = body.authType;
    if (body.apiKeyHeader !== undefined) data.apiKeyHeader = body.apiKeyHeader;
    if (body.symbolFormat !== undefined) data.symbolFormat = body.symbolFormat;
    if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;
    if (body.assetTypes !== undefined) data.assetTypes = JSON.stringify(body.assetTypes);
    if (body.supportedFeatures !== undefined) data.supportedFeatures = JSON.stringify(body.supportedFeatures);
    if (body.customEndpoints !== undefined) {
      data.customEndpoints = typeof body.customEndpoints === 'object'
        ? JSON.stringify(body.customEndpoints)
        : body.customEndpoints;
    }

    const provider = await db.brokerProvider.update({
      where: { id },
      data,
    });

    return NextResponse.json(provider);
  } catch (err: any) {
    if (err?.code === 'P2025') {
      return NextResponse.json({ error: 'Broker not found' }, { status: 404 });
    }
    if (err?.code === 'P2002') {
      return NextResponse.json({ error: `Code '${err.meta?.target}' already taken` }, { status: 409 });
    }
    console.error('[admin/brokers] PUT error:', err);
    return NextResponse.json({ error: 'Failed to update broker' }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await db.brokerProvider.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    if (err?.code === 'P2025') {
      return NextResponse.json({ error: 'Broker not found' }, { status: 404 });
    }
    console.error('[admin/brokers] DELETE error:', err);
    return NextResponse.json({ error: 'Failed to delete broker' }, { status: 500 });
  }
}
