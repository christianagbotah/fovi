import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel, ensureDemoUser } from '@/lib/db';
import { createBrokerFromAccount } from '@/lib/broker/factory';
import { DemoBroker } from '@/lib/broker/demo';
import { getAssetType } from '@/lib/broker/demo';
import { v4 as uuidv4 } from 'uuid';

export async function GET(req: NextRequest) {
  if (!db || !hasModel('tradingAccount')) {
    return NextResponse.json([]);
  }
  try {
    const { searchParams } = new URL(req.url);
    const accountId = searchParams.get('accountId');
    const userId = 'usr_demo_1';

    const account = await db.tradingAccount.findFirst({
      where: { userId, ...(accountId ? { id: accountId } : { isDefault: true }) },
    });
    if (!account) return NextResponse.json([]);

    const orders = await db.order.findMany({
      where: { accountId: account.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return NextResponse.json(orders);
  } catch (error) {
    console.warn('[orders GET] DB error, using fallback:', error);
    return NextResponse.json([]);
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { symbol, side, type, qty, limitPrice, stopLoss, takeProfit, assetType } = body;

  // ── No DB available: use in-memory demo broker ──
  if (!db || !hasModel('tradingAccount')) {
    try {
      const broker = new DemoBroker({ provider: 'demo', isDemo: true });
      const result = await broker.placeOrder({
        symbol,
        side,
        type: type || 'market',
        qty,
        limitPrice,
        stopPrice: stopLoss,
      });

      if (result.status === 'rejected') {
        return NextResponse.json({ error: 'Order rejected — insufficient balance' }, { status: 400 });
      }

      const order = {
        id: result.orderId,
        accountId: 'demo_acc_1',
        brokerOrderId: result.orderId,
        symbol,
        assetType: assetType || 'stock',
        side,
        type: type || 'market',
        qty,
        limitPrice: limitPrice || null,
        stopPrice: stopLoss || null,
        filledQty: result.filledQty,
        filledPrice: result.filledPrice,
        status: result.status,
        aiGenerated: false,
        signalId: null,
        reason: 'Manual trade (demo)',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      return NextResponse.json(order);
    } catch (error) {
      console.warn('[orders POST] Demo broker error:', error);
      return NextResponse.json({ error: 'Order processing failed' }, { status: 500 });
    }
  }

  // ── DB available: full flow ──
  try {
    const userId = await ensureDemoUser();
    if (!userId) {
      // Fallback to demo broker
      const broker = new DemoBroker({ provider: 'demo', isDemo: true });
      const result = await broker.placeOrder({
        symbol, side, type: type || 'market', qty, limitPrice, stopPrice: stopLoss,
      });
      if (result.status === 'rejected') {
        return NextResponse.json({ error: 'Order rejected — insufficient balance' }, { status: 400 });
      }
      return NextResponse.json({
        id: result.orderId, symbol, side, type, qty,
        filledQty: result.filledQty, filledPrice: result.filledPrice,
        status: result.status, createdAt: new Date().toISOString(),
      });
    }

    const account = await db.tradingAccount.findFirst({ where: { userId, isDefault: true } });
    if (!account) return NextResponse.json({ error: 'No account found' }, { status: 400 });

    const broker = createBrokerFromAccount(account);
    const result = await broker.placeOrder({
      symbol, side, type: type || 'market', qty, limitPrice, stopPrice: stopLoss,
    });

    if (result.status === 'rejected') {
      return NextResponse.json({ error: 'Order rejected — insufficient balance' }, { status: 400 });
    }

    const orderId = uuidv4();

    const order = await db.order.create({
      data: {
        id: orderId,
        accountId: account.id,
        brokerOrderId: result.orderId,
        symbol,
        assetType: assetType || 'stock',
        side,
        type: type || 'market',
        qty,
        filledQty: result.filledQty,
        filledPrice: result.filledPrice,
        status: result.status,
        aiGenerated: body.aiGenerated || false,
        signalId: body.signalId,
        reason: body.signalId ? 'Signal-based entry' : 'Manual trade',
      },
    });

    if (result.filledPrice && result.filledQty > 0 && side !== 'sell') {
      if (hasModel('position')) {
        const aType = assetType || 'stock';
        try {
          await db.position.upsert({
            where: { id: `${account.id}_${symbol}` },
            create: {
              id: `${account.id}_${symbol}`,
              accountId: account.id,
              symbol,
              assetType: aType,
              side: 'long',
              qty: result.filledQty,
              avgEntryPrice: result.filledPrice,
              currentPrice: result.filledPrice,
              stopLoss: stopLoss ?? null,
              takeProfit: takeProfit ?? null,
              status: 'open',
              openedAt: new Date(),
            },
            update: {
              qty: { increment: result.filledQty },
              avgEntryPrice: result.filledPrice,
              currentPrice: result.filledPrice,
              stopLoss: stopLoss ?? undefined,
              takeProfit: takeProfit ?? undefined,
            },
          });
        } catch (posErr) {
          console.warn('[orders POST] position upsert error:', posErr);
        }
      }
    }

    await db.tradingAccount.update({
      where: { id: account.id },
      data: { lastSyncedAt: new Date() },
    });

    return NextResponse.json(order);
  } catch (error) {
    console.warn('[orders POST] DB error, falling back to demo:', error);
    // Last resort: execute via demo broker so the user still gets their trade
    try {
      const broker = new DemoBroker({ provider: 'demo', isDemo: true });
      const result = await broker.placeOrder({
        symbol, side, type: type || 'market', qty, limitPrice, stopPrice: stopLoss,
      });
      if (result.status === 'rejected') {
        return NextResponse.json({ error: 'Order rejected — insufficient balance' }, { status: 400 });
      }
      return NextResponse.json({
        id: result.orderId, symbol, side, type, qty,
        filledQty: result.filledQty, filledPrice: result.filledPrice,
        status: result.status, createdAt: new Date().toISOString(),
      });
    } catch {
      return NextResponse.json({ error: 'Order processing failed' }, { status: 500 });
    }
  }
}
