// ============================================================
// GET/POST/DELETE /api/trading/webhooks
// Phase 1 CR2:
//   GET: requires auth (JWT from proxy), returns user-owned configs
//   POST: ALWAYS returns 503 containment. Never creates executable webhook.
//   DELETE: requires auth, tenant-scoped
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';
import { getUserId, AuthRequiredError, authRequiredResponse } from '@/lib/get-user-id';
import { CONTAINMENT_CODES, DEMO_PROVENANCE_HEADER, logSecurityEvent } from '@/lib/trading-policy';
import { v4 as uuidv4 } from 'uuid';

function maskSecret(secret: string): string {
  if (secret.length <= 8) return '****';
  return secret.slice(0, 4) + '****' + secret.slice(-4);
}

// GET: list user-owned webhook configs (secrets masked)
export async function GET(req: NextRequest) {
  let userId: string;
  try {
    userId = await getUserId(req);
  } catch {
    return authRequiredResponse();
  }

  if (!db || !hasModel('webhookConfig')) {
    // No DB — return empty synthetic read-only response with provenance
    return NextResponse.json(
      {
        webhooks: [],
        calls: [],
        environment: 'demo', isSynthetic: true, source: 'fovi-demo-generator',
      },
      { headers: { ...DEMO_PROVENANCE_HEADER, 'x-demo': 'true' } },
    );
  }

  try {
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
      route: '/api/trading/webhooks', userId,
      reason: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json({ error: 'Failed to fetch webhooks' }, { status: 500 });
  }
}

// POST: ALWAYS returns 503. Webhook creation disabled during containment.
// Never accepts autoExecute: true.
export async function POST() {
  const correlationId = uuidv4();
  logSecurityEvent({
    eventType: 'WEBHOOKS_POST_BLOCKED',
    correlationId,
    route: '/api/trading/webhooks',
    reason: 'Webhook creation is disabled during platform containment.',
  });
  return NextResponse.json(
    {
      error: 'Webhook creation is temporarily disabled during platform remediation.',
      code: CONTAINMENT_CODES.WEBHOOK_DISABLED,
      correlationId,
      remediationPhase: 'containment',
      deferred: 'Webhook security redesign.',
    },
    { status: 503 },
  );
}

// DELETE: remove a webhook config — requires auth, tenant-scoped
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'Webhook ID required' }, { status: 400 });
  }

  let userId: string;
  try {
    userId = await getUserId(req);
  } catch {
    return authRequiredResponse();
  }

  if (!db || !hasModel('webhookConfig')) {
    return NextResponse.json({ error: 'Webhook deletion is temporarily unavailable.', code: 'SERVICE_UNAVAILABLE', remediationPhase: 'containment' }, { status: 503 });
  }

  try {
    // CR4.1: Tenant-scoped delete — check count
    const { count } = await db.webhookConfig.deleteMany({ where: { id, userId } });
    if (count === 0) {
      return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    logSecurityEvent({
      eventType: 'WEBHOOKS_DELETE_ERROR',
      route: '/api/trading/webhooks', userId,
      reason: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json({ error: 'Failed to delete webhook' }, { status: 500 });
  }
}
