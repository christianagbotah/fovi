import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';
import { createBrokerFromAccount } from '@/lib/broker/factory';
import { DemoBroker } from '@/lib/broker/demo';
import { getDemoPrice, getAssetType } from '@/lib/broker/demo';

export async function GET(req: NextRequest) {
  // ── No DB available: use in-memory demo broker ──
  if (!db || !hasModel('tradingAccount')) {
    try {
      const broker = new DemoBroker({ provider: 'demo', isDemo: true });
      const brokerPositions = await broker.getPositions();
      const positions = brokerPositions.map((bp, idx) => ({
        id: `demo_pos_${idx}_${bp.symbol}`,
        accountId: 'demo_acc_1',
        symbol: bp.symbol,
        name: null,
        assetType: getAssetType(bp.symbol),
        side: bp.side,
        qty: bp.qty,
        avgEntryPrice: bp.avgEntryPrice,
        currentPrice: bp.currentPrice,
        unrealizedPnl: bp.unrealizedPnl,
        realizedPnl: 0,
        stopLoss: null,
        takeProfit: null,
        status: 'open',
        openedAt: new Date().toISOString(),
        closedAt: null,
      }));
      return NextResponse.json(positions);
    } catch {
      return NextResponse.json([]);
    }
  }

  try {
    const { searchParams } = new URL(req.url);
    const accountId = searchParams.get('accountId');
    const userId = 'usr_demo_1';

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
          data: { currentPrice: bp.currentPrice, unrealizedPnl: bp.unrealizedPnl },
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
  } catch (error) {
    // DB query failed — fall back to demo broker positions
    console.warn('[positions GET] DB error, using demo fallback:', error);
    try {
      const broker = new DemoBroker({ provider: 'demo', isDemo: true });
      const brokerPositions = await broker.getPositions();
      const positions = brokerPositions.map((bp, idx) => ({
        id: `demo_pos_${idx}_${bp.symbol}`,
        accountId: 'demo_acc_1',
        symbol: bp.symbol,
        name: null,
        assetType: getAssetType(bp.symbol),
        side: bp.side,
        qty: bp.qty,
        avgEntryPrice: bp.avgEntryPrice,
        currentPrice: bp.currentPrice,
        unrealizedPnl: bp.unrealizedPnl,
        realizedPnl: 0,
        stopLoss: null,
        takeProfit: null,
        status: 'open',
        openedAt: new Date().toISOString(),
        closedAt: null,
      }));
      return NextResponse.json(positions);
    } catch {
      return NextResponse.json([]);
    }
  }
}
