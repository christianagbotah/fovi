import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db, hasModel } from '@/lib/db';
import { authFirst } from '@/lib/auth-first';
import { createBrokerFromAccount } from '@/lib/broker/factory';
import { DemoBroker } from '@/lib/broker/demo';
import { getAssetType } from '@/lib/broker/demo';
import { saveDemoPositionSLTP } from '@/lib/demo-sltp-store';
import { v4 as uuidv4 } from 'uuid';

const OrderSchema = z.object({
  symbol: z.string().min(1).max(30).regex(/^[A-Za-z0-9/_.-]+$/),
  side: z.enum(['buy', 'sell']),
  type: z.enum(['market', 'limit', 'stop', 'stop_limit']).optional().default('market'),
  qty: z.number().positive().max(1_000_000_000),
  limitPrice: z.number().positive().optional(),
  stopLoss: z.number().positive().optional(),
  takeProfit: z.number().positive().optional(),
  assetType: z.string().optional(),
  accountId: z.string().optional(),
  aiGenerated: z.boolean().optional(),
  signalId: z.string().optional(),
});

type OrderInput = z.infer<typeof OrderSchema>;

export async function GET(req: NextRequest) {
  const userId = authFirst(req);
  if (!db || !hasModel('tradingAccount')) {
    return NextResponse.json([], { headers: { 'x-demo': 'true' } });
  }
  try {
    const { searchParams } = new URL(req.url);
    const accountId = searchParams.get('accountId');

    const account = await db.tradingAccount.findFirst({
      where: { userId, ...(accountId ? { id: accountId } : { isDefault: true }) },
    });
    if (!account) return NextResponse.json([], { headers: { 'x-demo': 'true' } });

    const orders = await db.order.findMany({
      where: { accountId: account.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return NextResponse.json(orders);
  } catch (error) {
    console.warn('[orders GET] DB error, using fallback:', error);
    return NextResponse.json([], { headers: { 'x-demo': 'true' } });
  }
}

export async function POST(req: NextRequest) {
  const userId = authFirst(req);
  const raw = await req.json();
  const parsed = OrderSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { error: `Invalid input: ${first?.path.join('.') || 'field'} — ${first?.message}` },
      { status: 400 },
    );
  }
  const { symbol, side, type, qty, limitPrice, stopLoss, takeProfit, assetType, accountId, aiGenerated, signalId } = parsed.data;

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
        return NextResponse.json({ error: 'Order rejected — insufficient balance' }, { status: 400, headers: { 'x-demo': 'true' } });
      }

      // Persist SL/TP for demo positions
      if (result.status === 'filled' && result.filledQty > 0) {
        saveDemoPositionSLTP(symbol, stopLoss, takeProfit);
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
      return NextResponse.json({ error: 'Order processing failed' }, { status: 500, headers: { 'x-demo': 'true' } });
    }
  }

  // ── DB available: full flow ──
  try {
    const whereClause = accountId ? { id: accountId, userId } : { userId, isDefault: true };
    const account = await db.tradingAccount.findFirst({ where: whereClause });
    if (!account) return NextResponse.json({ error: 'No account found' }, { status: 400, headers: { 'x-demo': 'true' } });

    const broker = await createBrokerFromAccount(account);
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
        aiGenerated: aiGenerated || false,
        signalId,
        reason: signalId ? 'Signal-based entry' : 'Manual trade',
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

    // Submit SL/TP as actual broker orders
    if (result.filledPrice && result.filledQty > 0 && (stopLoss || takeProfit)) {
      try {
        if (stopLoss) {
          await broker.placeOrder({
            symbol,
            side: side === 'buy' ? 'sell' : 'buy',
            type: 'stop',
            qty: result.filledQty,
            stopPrice: stopLoss,
          });
        }
        if (takeProfit) {
          await broker.placeOrder({
            symbol,
            side: side === 'buy' ? 'sell' : 'buy',
            type: 'limit',
            qty: result.filledQty,
            limitPrice: takeProfit,
          });
        }
      } catch (sltpErr) {
        console.warn('[orders POST] SL/TP order submission failed (non-critical):', sltpErr);
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
        return NextResponse.json({ error: 'Order rejected — insufficient balance' }, { status: 400, headers: { 'x-demo': 'true' } });
      }
      return NextResponse.json({
        id: result.orderId, symbol, side, type, qty,
        filledQty: result.filledQty, filledPrice: result.filledPrice,
        status: result.status, createdAt: new Date().toISOString(),
      });
    } catch {
      return NextResponse.json({ error: 'Order processing failed' }, { status: 500, headers: { 'x-demo': 'true' } });
    }
  }
}
