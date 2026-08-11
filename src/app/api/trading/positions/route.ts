import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';
import { getUserIdSync } from '@/lib/get-user-id';
import { createBrokerFromAccount } from '@/lib/broker/factory';
import { DemoBroker } from '@/lib/broker/demo';
import { getDemoPrice, getAssetType } from '@/lib/broker/demo';
import { loadDemoPositionSLTP } from '@/lib/demo-sltp-store';

export async function GET(req: NextRequest) {
  // ── No DB available: use in-memory demo broker ──
  if (!db || !hasModel('tradingAccount')) {
    try {
      const broker = new DemoBroker({ provider: 'demo', isDemo: true });
      const brokerPositions = await broker.getPositions();
      // Merge with any SL/TP stored from manual orders
      const slTpMap = loadDemoPositionSLTP();
      const positions = brokerPositions.map((bp, idx) => {
        const sltp = slTpMap.get(bp.symbol) || {};
        return {
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
          stopLoss: sltp.stopLoss ?? null,
          takeProfit: sltp.takeProfit ?? null,
          status: 'open',
          openedAt: sltp.openedAt || new Date().toISOString(),
          closedAt: null,
        };
      });
      return NextResponse.json(positions);
    } catch {
      return NextResponse.json([]);
    }
  }

  try {
    const { searchParams } = new URL(req.url);
    const accountId = searchParams.get('accountId');
    const userId = getUserIdSync(req);

    const account = await db.tradingAccount.findFirst({
      where: accountId ? { id: accountId, userId } : { userId, isDefault: true },
    });
    if (!account) return NextResponse.json([]);

    const isDemo = account.broker === 'demo' || account.accountType === 'demo';
    const broker = createBrokerFromAccount(account);
    const brokerPositions = await broker.getPositions();

    // Load in-memory SL/TP overrides for demo accounts
    const slTpMap = isDemo ? loadDemoPositionSLTP() : new Map();

    // Upsert positions to DB, including SL/TP for demo accounts
    for (const bp of brokerPositions) {
      const existing = await db.position.findFirst({
        where: { accountId: account.id, symbol: bp.symbol, status: 'open' },
      });

      // For demo accounts, merge DB-persisted SL/TP with in-memory overrides
      const memorySltp = slTpMap.get(bp.symbol);
      const stopLoss = memorySltp?.stopLoss ?? existing?.stopLoss ?? null;
      const takeProfit = memorySltp?.takeProfit ?? existing?.takeProfit ?? null;

      if (existing) {
        await db.position.update({
          where: { id: existing.id },
          data: {
            currentPrice: bp.currentPrice,
            unrealizedPnl: bp.unrealizedPnl,
            // Persist SL/TP from memory to DB for demo accounts
            ...(isDemo && stopLoss !== undefined ? { stopLoss } : {}),
            ...(isDemo && takeProfit !== undefined ? { takeProfit } : {}),
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
            // Persist SL/TP from memory to DB for demo accounts
            ...(isDemo ? { stopLoss, takeProfit } : {}),
          },
        });
      }
    }

    const positions = await db.position.findMany({
      where: { accountId: account.id, status: 'open' },
      orderBy: { openedAt: 'desc' },
    });

    // For demo accounts, merge: DB-persisted SL/TP is the base, in-memory overrides take precedence
    if (isDemo) {
      for (const pos of positions) {
        const memSltp = slTpMap.get(pos.symbol);
        if (memSltp) {
          if (memSltp.stopLoss !== null) pos.stopLoss = memSltp.stopLoss;
          if (memSltp.takeProfit !== null) pos.takeProfit = memSltp.takeProfit;
        }
      }
    }

    return NextResponse.json(positions);
  } catch (error) {
    // DB query failed — fall back to demo broker positions
    console.warn('[positions GET] DB error, using demo fallback:', error);
    try {
      const broker = new DemoBroker({ provider: 'demo', isDemo: true });
      const brokerPositions = await broker.getPositions();
      const slTpMap = loadDemoPositionSLTP();
      const positions = brokerPositions.map((bp, idx) => {
        const sltp = slTpMap.get(bp.symbol) || {};
        return {
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
          stopLoss: sltp.stopLoss ?? null,
          takeProfit: sltp.takeProfit ?? null,
          status: 'open',
          openedAt: sltp.openedAt || new Date().toISOString(),
          closedAt: null,
        };
      });
      return NextResponse.json(positions);
    } catch {
      return NextResponse.json([]);
    }
  }
}
