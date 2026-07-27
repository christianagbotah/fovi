import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';
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

    const where = accountId ? { accountId, userId: undefined as unknown } : { accountId: undefined as unknown };
    // Simple approach: get default account orders
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
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('validating datasource')) {
      // Prisma validation error (e.g., wrong DB URL) — return same fallback as !db check
      return NextResponse.json([]);
    }
    const msg = error instanceof Error ? error.message : 'Failed to fetch orders';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!db || !hasModel('tradingAccount')) {
    return NextResponse.json({ id: 'demo_order', symbol: 'DEMO', status: 'filled', filledQty: 0, filledPrice: 0 }, { status: 200 });
  }
  try {
    const body = await req.json();
    const userId = 'usr_demo_1';

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
      stopPrice: body.stopPrice,
    });

    // Save order to DB
    const order = await db.order.create({
      data: {
        id: uuidv4(),
        accountId: account.id,
        brokerOrderId: result.orderId,
        symbol: body.symbol,
        assetType: 'stock',
        side: body.side,
        type: body.type || 'market',
        qty: body.qty,
        filledQty: result.filledQty,
        filledPrice: result.filledPrice,
        status: result.status,
        aiGenerated: body.aiGenerated || false,
        signalId: body.signalId,
      },
    });

    // Update account balance
    await db.tradingAccount.update({
      where: { id: account.id },
      data: { lastSyncedAt: new Date() },
    });

    return NextResponse.json(order);
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('validating datasource')) {
      // Prisma validation error (e.g., wrong DB URL) — return same fallback as !db check
      return NextResponse.json({ id: 'demo_order', symbol: 'DEMO', status: 'filled', filledQty: 0, filledPrice: 0 }, { status: 200 });
    }
    const msg = error instanceof Error ? error.message : 'Failed to place order';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}