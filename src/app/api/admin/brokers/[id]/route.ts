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

    const provider = await db.brokerProvider.update({
      where: { id },
      data: {
        ...(body.code !== undefined && { code: body.code.toLowerCase().trim() }),
        ...(body.displayName !== undefined && { displayName: body.displayName }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.brokerType !== undefined && { brokerType: body.brokerType }),
        ...(body.iconColor !== undefined && { iconColor: body.iconColor }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
        ...(body.requiresApiKey !== undefined && { requiresApiKey: body.requiresApiKey }),
        ...(body.requiresSecret !== undefined && { requiresSecret: body.requiresSecret }),
        ...(body.requiresPassphrase !== undefined && { requiresPassphrase: body.requiresPassphrase }),
        ...(body.liveBaseUrl !== undefined && { liveBaseUrl: body.liveBaseUrl }),
        ...(body.testnetBaseUrl !== undefined && { testnetBaseUrl: body.testnetBaseUrl }),
        ...(body.assetTypes !== undefined && { assetTypes: JSON.stringify(body.assetTypes) }),
        ...(body.supportedFeatures !== undefined && { supportedFeatures: JSON.stringify(body.supportedFeatures) }),
        ...(body.sortOrder !== undefined && { sortOrder: body.sortOrder }),
      },
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
