// ============================================================
// GET/POST/DELETE /api/trading/webhooks
// Phase 1 CR1: GET requires auth (no longer in public paths in proxy.ts).
// POST keeps 503 disabled response. No demo fallback.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';
import { getUserId } from '@/lib/get-user-id';
import { CONTAINMENT_CODES, DEMO_PROVENANCE_HEADER, logSecurityEvent } from '@/lib/trading-policy';

const demoWebhooks: Array<{
  id: string;
  name: string;
  secret: string;
  autoExecute: boolean;
  defaultStrategy: string;
  createdAt: string;
}> = [
  {
    id: 'wh_demo_1',
    name: 'TradingView Alerts (demo)',
    secret: 'demo_secret_placeholder_1',
    autoExecute: false,
    defaultStrategy: 'breakout',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString(),
  },
];

const demoCalls: Array<{
  id: string;
  webhookId: string;
  timestamp: string;
  symbol: string;
  action: string;
  status: string;
}> = [
  { id: 'c1', webhookId: 'wh_demo_1', timestamp: new Date(Date.now() - 1000 * 60 * 2).toISOString(), symbol: 'BTC', action: 'buy', status: 'success' },
];

function randomId(len = 12): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function maskSecret(secret: string): string {
  if (secret.length <= 8) return '****';
  return secret.slice(0, 4) + '****' + secret.slice(-4);
}

// GET: list all webhook configs (secrets masked) — requires auth
export async function GET(req: NextRequest) {
  // ── CR1: Require auth since webhooks is no longer in public paths ──
  if (!db || !hasModel('webhookConfig')) {
    return NextResponse.json(
      {
        webhooks: demoWebhooks.map(w => ({ ...w, secret: maskSecret(w.secret) })),
        calls: demoCalls,
        environment: 'demo', isSynthetic: true, source: 'fovi-demo-generator',
      },
      { headers: { ...DEMO_PROVENANCE_HEADER, 'x-demo': 'true' } },
    );
  }

  try {
    const userId = await getUserId(req);

    const configs = await db.webhookConfig.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    const webhooks = configs.map((c) => ({
      id: c.id,
      name: c.name,
      secret: maskSecret(c.secret ?? ''),
      autoExecute: c.autoExecute,
      defaultStrategy: c.defaultStrategy,
      createdAt: c.createdAt.toISOString(),
    }));

    return NextResponse.json({ webhooks, calls: [] });
  } catch (error) {
    logSecurityEvent({
      eventType: 'WEBHOOKS_GET_ERROR',
      route: '/api/trading/webhooks',
      reason: error instanceof Error ? error.message : 'Unknown error',
    });
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
    const secret = `whsec_${randomId(16)}`;

    if (!db || !hasModel('webhookConfig')) {
      return NextResponse.json(
        {
          id, name: trimmed, secret,
          autoExecute: !!autoExecute, defaultStrategy: defaultStrategy || 'manual',
          createdAt: new Date().toISOString(),
          environment: 'demo', isSynthetic: true,
        },
        { status: 201, headers: { ...DEMO_PROVENANCE_HEADER, 'x-demo': 'true' } },
      );
    }

    try {
      const userId = await getUserId(req);

      const created = await db.webhookConfig.create({
        data: {
          userId,
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
          id: created.id, name: created.name, secret,
          autoExecute: created.autoExecute, defaultStrategy: created.defaultStrategy,
          createdAt: created.createdAt.toISOString(),
        },
        { status: 201 },
      );
    } catch (error) {
      logSecurityEvent({
        eventType: 'WEBHOOKS_POST_ERROR',
        route: '/api/trading/webhooks',
        reason: error instanceof Error ? error.message : 'Unknown error',
      });
      return NextResponse.json({ error: 'Failed to create webhook' }, { status: 500 });
    }
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}

// DELETE: remove a webhook config
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'Webhook ID required' }, { status: 400 });
  }

  if (!db || !hasModel('webhookConfig')) {
    const idx = demoWebhooks.findIndex((w) => w.id === id);
    if (idx >= 0) demoWebhooks.splice(idx, 1);
    return NextResponse.json({ success: true }, { headers: { 'x-demo': 'true' } });
  }

  try {
    const userId = await getUserId(req);

    await db.webhookConfig.deleteMany({ where: { id, userId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    logSecurityEvent({
      eventType: 'WEBHOOKS_DELETE_ERROR',
      route: '/api/trading/webhooks',
      reason: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json({ error: 'Failed to delete webhook' }, { status: 500 });
  }
}
