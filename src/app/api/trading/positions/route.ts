import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { createBrokerFromAccount } from '@/lib/broker/factory';
import { getDemoPrice, getAssetType } from '@/lib/broker/demo';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const accountId = searchParams.get('accountId');
    const userId = 'usr_demo_1';

    // Get positions from broker
    const account = await db.tradingAccount.findFirst({
      where: accountId ? { id: accountId, userId } : { userId, isDefault: true },
    });
    if (!account) return NextResponse.json([]);

    const broker = createBrokerFromAccount(account);
    const brokerPositions = await broker.getPositions();

    // Upsert positions to DB
    for (const bp of brokerPositions) {
      const existing = await db.position.findFirst({
        where: { accountId: account.id, symbol: bp.symbol, status: 'open' },
      });
      if (existing) {
        await db.position.update({
          where: { id: existing.id },
          data: {
            currentPrice: bp.currentPrice,
            unrealizedPnl: bp.unrealizedPnl,
          },
        });
      } else {
        await db.position.create({
          data: {
            accountId: account.id,
            symbol: bp.symbol,
            assetType: getAssetType(bp.symbol),
            side: bp.side,
            qty: bp.qty,
            avgEntryPrice: bp.avgEntryPrice,
            currentPrice: bp.currentPrice,
            unrealizedPnl: bp.unrealizedPnl,
          },
        });
      }
    }

    const positions = await db.position.findMany({
      where: { accountId: account.id, status: 'open' },
      orderBy: { openedAt: 'desc' },
    });
    return NextResponse.json(positions);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to fetch positions';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
