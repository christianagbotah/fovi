// ============================================================
// POST/GET /api/trading/orders
// Phase 1 CR2: Strict auth, demo provenance, hard-block live orders.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db, hasModel } from '@/lib/db';
import { getUserId, getUserIdSync, AuthRequiredError, authRequiredResponse } from '@/lib/get-user-id';
import { createBrokerFromAccount, BrokerFactoryError } from '@/lib/broker/factory';
import { saveDemoPositionSLTP } from '@/lib/demo-sltp-store';
import { enforceLiveTradingPolicy, CONTAINMENT_CODES, DEMO_PROVENANCE_HEADER, isExplicitlyDemo, logSecurityEvent } from '@/lib/trading-policy';
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
  let userId: string;
  try {
    userId = getUserIdSync(req);
  } catch {
    return authRequiredResponse();
  }

  if (!db || !hasModel('tradingAccount')) {
    return NextResponse.json(
      { error: 'Order data is temporarily unavailable.', code: 'SERVICE_UNAVAILABLE', remediationPhase: 'containment' },
      { status: 503 },
    );
  }
  try {
    const { searchParams } = new URL(req.url);
    const accountId = searchParams.get('accountId');

    const account = await db.tradingAccount.findFirst({
      where: { userId, ...(accountId ? { id: accountId } : { isDefault: true }) },
    });
    if (!account) {
      return NextResponse.json([]);
    }

    const orders = await db.order.findMany({
      where: { accountId: account.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return NextResponse.json(orders);
  } catch (error) {
    logSecurityEvent({
      eventType: 'ORDERS_GET_ERROR', route: '/api/trading/orders', userId,
      reason: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json({ error: 'Failed to fetch orders' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let userId: string;
  try {
    userId = await getUserId(req);
  } catch {
    return authRequiredResponse();
  }

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

  if (!db || !hasModel('tradingAccount')) {
    logSecurityEvent({
      eventType: 'ORDERS_POST_NO_DB', route: '/api/trading/orders', userId,
      reason: 'Database unavailable for order placement',
    });
    return NextResponse.json(
      { error: 'Order placement is temporarily unavailable. No order was executed.', code: 'SERVICE_UNAVAILABLE', remediationPhase: 'containment' },
      { status: 503 },
    );
  }

  try {
    const whereClause = accountId ? { id: accountId, userId } : { userId, isDefault: true };
    const account = await db.tradingAccount.findFirst({ where: whereClause });
    if (!account) {
      return NextResponse.json({ error: 'No account found' }, { status: 404 });
    }

    // ── CONTAINMENT: Enforce live-trading policy ──
    const policy = enforceLiveTradingPolicy(account, `order placement (${side} ${qty} ${symbol})`);
    if (policy.blocked) return policy.response;

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
        id: orderId, accountId: account.id, brokerOrderId: result.orderId,
        symbol, assetType: assetType || 'stock', side, type: type || 'market', qty,
        filledQty: result.filledQty, filledPrice: result.filledPrice,
        status: result.status, aiGenerated: aiGenerated || false, signalId,
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
              id: `${account.id}_${symbol}`, accountId: account.id, symbol, assetType: aType,
              side: 'long', qty: result.filledQty, avgEntryPrice: result.filledPrice,
              currentPrice: result.filledPrice, stopLoss: stopLoss ?? null,
              takeProfit: takeProfit ?? null, status: 'open', openedAt: new Date(),
            },
            update: {
              qty: { increment: result.filledQty }, avgEntryPrice: result.filledPrice,
              currentPrice: result.filledPrice, stopLoss: stopLoss ?? undefined,
              takeProfit: takeProfit ?? undefined,
            },
          });
        } catch (posErr) {
          logSecurityEvent({
            eventType: 'ORDER_POSITION_UPSERT_ERROR', route: '/api/trading/orders', userId,
            reason: posErr instanceof Error ? posErr.message : 'Unknown',
          });
        }
      }
    }

    // Submit SL/TP as actual broker orders
    if (result.filledPrice && result.filledQty > 0 && (stopLoss || takeProfit)) {
      try {
        if (stopLoss) {
          await broker.placeOrder({ symbol, side: side === 'buy' ? 'sell' : 'buy', type: 'stop', qty: result.filledQty, stopPrice: stopLoss });
        }
        if (takeProfit) {
          await broker.placeOrder({ symbol, side: side === 'buy' ? 'sell' : 'buy', type: 'limit', qty: result.filledQty, limitPrice: takeProfit });
        }
      } catch (sltpErr) {
        logSecurityEvent({
          eventType: 'ORDER_SLTP_SUBMIT_ERROR', route: '/api/trading/orders', userId,
          reason: sltpErr instanceof Error ? sltpErr.message : 'Unknown',
        });
      }
    }

    await db.tradingAccount.update({ where: { id: account.id }, data: { lastSyncedAt: new Date() } });

    const responseHeaders: Record<string, string> = {};
    if (isExplicitlyDemo(account)) {
      Object.assign(responseHeaders, DEMO_PROVENANCE_HEADER);
    }

    return NextResponse.json(order, { headers: responseHeaders });
  } catch (error) {
    logSecurityEvent({
      eventType: 'ORDERS_POST_ERROR', route: '/api/trading/orders', userId,
      reason: error instanceof Error ? error.message : 'Unknown error',
    });

    if (error instanceof BrokerFactoryError) {
      return NextResponse.json(
        { error: error.message, code: error.code, remediationPhase: 'containment' },
        { status: error.code === CONTAINMENT_CODES.BROKER_CONNECTION_FAILED ? 503 : 400 },
      );
    }
    return NextResponse.json({ error: 'Order processing failed' }, { status: 500 });
  }
}
