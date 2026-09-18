// ============================================================
// POST /api/trading/engine/stop-complete
// Internal-only finalizer for the paper automation stop lifecycle.
// ------------------------------------------------------------
// The user-facing stop request sets a bot to enabled=false/status=stopping.
// The engine then settles every deterministic AI paper position. Only after
// durable storage proves zero open paper exposure may this route transition
// the bot to status=stopped.
//
// This route never constructs a broker and cannot close a position itself.
// ============================================================

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, hasModel } from '@/lib/db';
import { enforceInternalAuth, logSecurityEvent } from '@/lib/trading-policy';

const BodySchema = z.object({
  botId: z.string().min(1).max(191),
  accountId: z.string().min(1).max(191),
});

function errorResponse(status: number, code: string, error: string) {
  return NextResponse.json(
    { error, code, remediationPhase: 'phase-2j-server-authoritative-automation-control' },
    { status },
  );
}

export async function POST(req: Request) {
  const authError = enforceInternalAuth(req);
  if (authError) return authError;

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(400, 'INVALID_STOP_FINALIZATION', 'botId and accountId are required.');
  }

  if (!db || !hasModel('bot') || !hasModel('position')) {
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Automation lifecycle persistence is unavailable.');
  }

  const { botId, accountId } = parsed.data;

  try {
    const bot = await db.bot.findFirst({
      where: { id: botId, accountId },
    });
    if (!bot) {
      return errorResponse(404, 'BOT_NOT_FOUND', 'Bot was not found.');
    }

    if (bot.status === 'stopped' && bot.enabled === false) {
      return NextResponse.json({
        success: true,
        idempotent: true,
        botId,
        status: 'stopped',
        enabled: false,
      });
    }

    if (bot.status !== 'stopping' || bot.enabled !== false) {
      return errorResponse(
        409,
        'BOT_NOT_STOPPING',
        'Bot is not in the stopping lifecycle state.',
      );
    }

    const openPositions = await db.position.findMany({
      where: { botId, accountId, status: 'open' },
      select: { id: true },
    });

    if (openPositions.length > 0) {
      return errorResponse(
        409,
        'PAPER_EXPOSURE_REMAINS',
        `${openPositions.length} open position(s) remain; Stop cannot finalize yet.`,
      );
    }

    const { count } = await db.bot.updateMany({
      where: { id: botId, accountId, enabled: false, status: 'stopping' },
      data: { status: 'stopped', lastError: null },
    });
    if (count !== 1) {
      return errorResponse(
        409,
        'STOP_FINALIZATION_CONFLICT',
        'Bot lifecycle changed before Stop could finalize.',
      );
    }

    logSecurityEvent({
      eventType: 'PAPER_AUTOMATION_STOPPED',
      route: '/api/trading/engine/stop-complete',
      userId: bot.userId,
      reason: `Bot ${botId} fully stopped after all AI paper exposure settled.`,
    });

    return NextResponse.json({
      success: true,
      idempotent: false,
      botId,
      status: 'stopped',
      enabled: false,
    });
  } catch (error) {
    logSecurityEvent({
      eventType: 'PAPER_AUTOMATION_STOP_FINALIZE_ERROR',
      route: '/api/trading/engine/stop-complete',
      reason: error instanceof Error ? error.message : 'Unknown stop finalization error',
    });
    return errorResponse(500, 'STOP_FINALIZATION_FAILED', 'Failed to finalize automation Stop.');
  }
}
