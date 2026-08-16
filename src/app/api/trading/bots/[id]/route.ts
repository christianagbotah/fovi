import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';
import { getUserIdSync, AuthRequiredError, authRequiredResponse } from '@/lib/get-user-id';
import { isExplicitlyDemo, CONTAINMENT_CODES, logSecurityEvent } from '@/lib/trading-policy';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let userId: string;
  try {
    userId = getUserIdSync(req);
  } catch {
    return authRequiredResponse();
  }

  const { id } = await params;

  if (!db || !hasModel('bot')) {
    return NextResponse.json(
      { error: 'Bot data is temporarily unavailable.', code: 'SERVICE_UNAVAILABLE', remediationPhase: 'containment' },
      { status: 503 },
    );
  }

  try {
    // CR4.1: Tenant-scoped query — userId in predicate
    const bot = await db.bot.findFirst({ where: { id, userId } });
    if (!bot) {
      return NextResponse.json({ error: 'Bot not found' }, { status: 404 });
    }
    return NextResponse.json(bot);
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      return authRequiredResponse();
    }
    logSecurityEvent({
      eventType: 'BOTS_ID_GET_ERROR',
      route: '/api/trading/bots/[id]',
      reason: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json({ error: 'Failed to fetch bot' }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let userId: string;
  try {
    userId = getUserIdSync(req);
  } catch {
    return authRequiredResponse();
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  if (!db || !hasModel('bot')) {
    return NextResponse.json(
      { error: 'Bot update is temporarily unavailable.', code: 'SERVICE_UNAVAILABLE', remediationPhase: 'containment' },
      { status: 503 },
    );
  }

  try {
    // CR4.1: Tenant-scoped query — userId in predicate
    const bot = await db.bot.findFirst({
      where: { id, userId },
      include: { account: true },
    });
    if (!bot) {
      return NextResponse.json({ error: 'Bot not found' }, { status: 404 });
    }

    // Strict allowlist of updatable fields
    const ALLOWED_FIELDS = [
      'name', 'strategy', 'symbols', 'timeframe', 'allocationAmount',
      'positionSizing', 'riskPerTrade', 'maxPositions', 'stopLossPercent',
      'takeProfitPercent', 'trailingStopPct', 'tradingSessions',
      'customSessionStart', 'customSessionEnd', 'config',
    ];
    const data: Record<string, unknown> = {};
    for (const field of ALLOWED_FIELDS) {
      if (body[field] !== undefined) {
        data[field] = body[field];
      }
    }
    if (data.config && typeof data.config === 'object') {
      data.config = JSON.stringify(data.config);
    }

    // Phase 1: if bot is enabled/running and account is NOT explicitly demo, force disabled/stopped
    if (bot.account && !isExplicitlyDemo(bot.account)) {
      if (bot.enabled || bot.status === 'running') {
        data.enabled = false;
        data.status = 'stopped';
      }
    }

    // CR4.1: Update with tenant-scoped predicate
    const { count } = await db.bot.updateMany({
      where: { id, userId },
      data,
    });
    if (count === 0) {
      return NextResponse.json({ error: 'Bot not found' }, { status: 404 });
    }
    const updated = await db.bot.findFirst({ where: { id } });
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      return authRequiredResponse();
    }
    logSecurityEvent({
      eventType: 'BOTS_ID_PUT_ERROR',
      route: '/api/trading/bots/[id]',
      reason: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json({ error: 'Failed to update bot' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let userId: string;
  try {
    userId = getUserIdSync(req);
  } catch {
    return authRequiredResponse();
  }

  const { id } = await params;

  if (!db || !hasModel('bot')) {
    return NextResponse.json(
      { error: 'Bot deletion is temporarily unavailable.', code: 'SERVICE_UNAVAILABLE', remediationPhase: 'containment' },
      { status: 503 },
    );
  }

  try {
    // CR4.1: Tenant-scoped delete — userId in predicate, check count
    const { count } = await db.bot.deleteMany({ where: { id, userId } });
    if (count === 0) {
      return NextResponse.json({ error: 'Bot not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      return authRequiredResponse();
    }
    logSecurityEvent({
      eventType: 'BOTS_ID_DELETE_ERROR',
      route: '/api/trading/bots/[id]',
      reason: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json({ error: 'Failed to delete bot' }, { status: 500 });
  }
}
