import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';
import { getUserIdSync, AuthRequiredError, authRequiredResponse } from '@/lib/get-user-id';
import { logSecurityEvent } from '@/lib/trading-policy';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!db || !hasModel('bot')) {
    return NextResponse.json(
      { error: 'Bot data is temporarily unavailable.', code: 'SERVICE_UNAVAILABLE', remediationPhase: 'containment' },
      { status: 503 },
    );
  }

  try {
    const userId = getUserIdSync(req);
    const bot = await db.bot.findUnique({ where: { id } });
    if (!bot) {
      return NextResponse.json({ error: 'Bot not found' }, { status: 404 });
    }
    if (bot.userId !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  if (!db || !hasModel('bot')) {
    return NextResponse.json(
      { error: 'Bot update is temporarily unavailable.', code: 'SERVICE_UNAVAILABLE', remediationPhase: 'containment' },
      { status: 503 },
    );
  }

  try {
    const userId = getUserIdSync(req);
    const bot = await db.bot.findUnique({ where: { id } });
    if (!bot) {
      return NextResponse.json({ error: 'Bot not found' }, { status: 404 });
    }
    if (bot.userId !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const { id: _id, ...rest } = body;
    const data: Record<string, unknown> = { ...rest };
    if (rest.config && typeof rest.config === 'object') {
      data.config = JSON.stringify(rest.config);
    }
    const updated = await db.bot.update({
      where: { id },
      data,
    });
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
  const { id } = await params;

  if (!db || !hasModel('bot')) {
    return NextResponse.json(
      { error: 'Bot deletion is temporarily unavailable.', code: 'SERVICE_UNAVAILABLE', remediationPhase: 'containment' },
      { status: 503 },
    );
  }

  try {
    const userId = getUserIdSync(req);
    const bot = await db.bot.findUnique({ where: { id } });
    if (!bot) {
      return NextResponse.json({ error: 'Bot not found' }, { status: 404 });
    }
    if (bot.userId !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    await db.bot.delete({ where: { id } });
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
