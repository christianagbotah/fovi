import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';

const DEMO_USER_ID = 'usr_demo_1';

// Demo webhook configs (persisted in-memory for this session)
const demoWebhooks: Array<{
  id: string;
  name: string;
  secret: string;
  autoExecute: boolean;
  defaultStrategy: string;
  createdAt: string;
}> = [
  {
    id: 'wh_1a2b3c',
    name: 'TradingView Alerts',
    secret: 'sk_live_8f2c9a1b',
    autoExecute: true,
    defaultStrategy: 'breakout',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString(),
  },
  {
    id: 'wh_4d5e6f',
    name: 'Pine Script Bot',
    secret: 'sk_live_3d7e2c9f',
    autoExecute: false,
    defaultStrategy: 'manual',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
  },
];

// Demo webhook calls log
const demoCalls: Array<{
  id: string;
  webhookId: string;
  timestamp: string;
  symbol: string;
  action: string;
  status: string;
}> = [
  { id: 'c1', webhookId: 'wh_1a2b3c', timestamp: new Date(Date.now() - 1000 * 60 * 2).toISOString(), symbol: 'BTC', action: 'buy', status: 'success' },
  { id: 'c2', webhookId: 'wh_1a2b3c', timestamp: new Date(Date.now() - 1000 * 60 * 18).toISOString(), symbol: 'NVDA', action: 'sell', status: 'success' },
  { id: 'c3', webhookId: 'wh_4d5e6f', timestamp: new Date(Date.now() - 1000 * 60 * 47).toISOString(), symbol: 'ETH', action: 'short', status: 'pending' },
  { id: 'c4', webhookId: 'wh_1a2b3c', timestamp: new Date(Date.now() - 1000 * 60 * 95).toISOString(), symbol: 'TSLA', action: 'buy', status: 'failed' },
  { id: 'c5', webhookId: 'wh_4d5e6f', timestamp: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(), symbol: 'AAPL', action: 'cover', status: 'success' },
];

function randomId(len = 12): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

// GET: list all webhook configs + recent calls
export async function GET() {
  if (!db || !hasModel('webhookConfig')) {
    return NextResponse.json({ webhooks: demoWebhooks, calls: demoCalls });
  }

  try {
    const configs = await db.webhookConfig.findMany({
      where: { userId: DEMO_USER_ID },
      orderBy: { createdAt: 'desc' },
    });

    const webhooks = configs.map((c) => ({
      id: c.id,
      name: c.name,
      secret: c.secret ?? '',
      autoExecute: c.autoExecute,
      defaultStrategy: c.defaultStrategy,
      createdAt: c.createdAt.toISOString(),
    }));

    return NextResponse.json({ webhooks, calls: demoCalls });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('validating datasource')) {
      return NextResponse.json({ webhooks: demoWebhooks, calls: demoCalls });
    }
    return NextResponse.json({ error: 'Failed to fetch webhooks' }, { status: 500 });
  }
}

// POST: create a new webhook config
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, autoExecute, defaultStrategy } = body;
    const trimmed = (name || '').trim();
    if (!trimmed) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    const id = `wh_${randomId(8)}`;
    const secret = `sk_live_${randomId(10)}`;

    if (!db || !hasModel('webhookConfig')) {
      const item = {
        id,
        name: trimmed,
        secret,
        autoExecute: !!autoExecute,
        defaultStrategy: defaultStrategy || 'manual',
        createdAt: new Date().toISOString(),
      };
      demoWebhooks.unshift(item);
      return NextResponse.json(item, { status: 201 });
    }

    try {
      const created = await db.webhookConfig.create({
        data: {
          userId: DEMO_USER_ID,
          name: trimmed,
          url: `/api/trading/webhook?token=${id}`,
          secret,
          enabled: true,
          autoExecute: !!autoExecute,
          defaultStrategy: defaultStrategy || 'manual',
        },
      });
      return NextResponse.json(
        {
          id: created.id,
          name: created.name,
          secret: created.secret ?? '',
          autoExecute: created.autoExecute,
          defaultStrategy: created.defaultStrategy,
          createdAt: created.createdAt.toISOString(),
        },
        { status: 201 },
      );
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes('validating datasource')) {
        const item = { id, name: trimmed, secret, autoExecute: !!autoExecute, defaultStrategy: defaultStrategy || 'manual', createdAt: new Date().toISOString() };
        demoWebhooks.unshift(item);
        return NextResponse.json(item, { status: 201 });
      }
      return NextResponse.json({ error: 'Failed to create webhook' }, { status: 500 });
    }
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}

// DELETE: remove a webhook config (query param: id)
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'Webhook ID required' }, { status: 400 });
  }

  if (!db || !hasModel('webhookConfig')) {
    const idx = demoWebhooks.findIndex((w) => w.id === id);
    if (idx >= 0) demoWebhooks.splice(idx, 1);
    return NextResponse.json({ success: true });
  }

  try {
    await db.webhookConfig.deleteMany({ where: { id, userId: DEMO_USER_ID } });
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('validating datasource')) {
      const idx = demoWebhooks.findIndex((w) => w.id === id);
      if (idx >= 0) demoWebhooks.splice(idx, 1);
      return NextResponse.json({ success: true });
    }
    return NextResponse.json({ error: 'Failed to delete webhook' }, { status: 500 });
  }
}
