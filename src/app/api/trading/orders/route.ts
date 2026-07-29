import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel, ensureDemoUser } from '@/lib/db';
import { createBrokerFromAccount } from '@/lib/broker/factory';
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
  if (!db || !hasModel('tradingAccount')) {
    return NextResponse.json({ id: 'demo_order', symbol: 'DEMO', status: 'filled', filledQty: 0, filledPrice: 0 }, { status: 200 });
  }
  try {
    const body = await req.json();
    const userId = await ensureDemoUser();
    if (!userId) {
      return NextResponse.json({ id: 'demo_order', symbol: 'DEMO', status: 'filled', filledQty: 0, filledPrice: 0 }, { status: 200 });
    }

    const account = await db.tradingAccount.findFirst({
      where: { userId, isDefault: true },
    });
    if (!account) return NextResponse.json({ error: 'No account found' }, { status: 400 });

    const broker = createBrokerFromAccount(account);
    const result = await broker.placeOrder({
      symbol: body.symbol,
      side: body.side,
      type: body.type || 'market',
      qty: body.qty,
      limitPrice: body.limitPrice,
      stopPrice: body.stopLoss,
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
        symbol: body.symbol,
        assetType: body.assetType || 'stock',
        side: body.side,
        type: body.type || 'market',
        qty: body.qty,
        filledQty: result.filledQty,
        filledPrice: result.filledPrice,
        status: result.status,
        aiGenerated: body.aiGenerated || false,
        signalId: body.signalId,
        reason: body.signalId ? 'Signal-based entry' : 'Manual trade',
      },
    });

    if (result.filledPrice && result.filledQty > 0 && body.side !== 'sell') {
      if (hasModel('position')) {
        const assetType = body.assetType || 'stock';
        try {
          await db.position.upsert({
            where: { id: `${account.id}_${body.symbol}` },
            create: {
              id: `${account.id}_${body.symbol}`,
              accountId: account.id,
              symbol: body.symbol,
              assetType,
              side: 'long',
              qty: result.filledQty,
              avgEntryPrice: result.filledPrice,
              currentPrice: result.filledPrice,
              stopLoss: body.stopLoss ?? null,
              takeProfit: body.takeProfit ?? null,
              status: 'open',
              openedAt: new Date(),
            },
            update: {
              qty: { increment: result.filledQty },
              avgEntryPrice: result.filledPrice,
              currentPrice: result.filledPrice,
              stopLoss: body.stopLoss ?? undefined,
              takeProfit: body.takeProfit ?? undefined,
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
    console.warn('[orders POST] DB error:', error);
    return NextResponse.json({ error: 'Order processing failed' }, { status: 500 });
  }
}
