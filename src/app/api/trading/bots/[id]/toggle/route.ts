import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';
import { getUserIdSync, AuthRequiredError, authRequiredResponse } from '@/lib/get-user-id';
import { logSecurityEvent } from '@/lib/trading-policy';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!db || !hasModel('bot')) {
    return NextResponse.json(
      { error: 'Bot toggle is temporarily unavailable.', code: 'SERVICE_UNAVAILABLE', remediationPhase: 'containment' },
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
    const newEnabled = !bot.enabled;
    const newStatus = newEnabled ? 'running' : 'stopped';
    const updated = await db.bot.update({
      where: { id },
      data: { enabled: newEnabled, status: newStatus },
    });
    return NextResponse.json({
      success: true,
      enabled: updated.enabled,
      status: updated.status,
    });
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      return authRequiredResponse();
    }
    logSecurityEvent({
      eventType: 'BOTS_TOGGLE_ERROR',
      route: '/api/trading/bots/[id]/toggle',
      reason: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json({ error: 'Failed to toggle bot' }, { status: 500 });
  }
}
