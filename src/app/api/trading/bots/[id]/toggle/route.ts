import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db, hasModel } from '@/lib/db';
import { getUserIdSync, AuthRequiredError, authRequiredResponse } from '@/lib/get-user-id';
import { isExplicitlyDemo, CONTAINMENT_CODES, logSecurityEvent } from '@/lib/trading-policy';
import { validateAutomatedBotConfiguration } from '@/lib/trading-intelligence/bot-policy';

const ControlSchema = z.object({
  enabled: z.boolean(),
}).strict();

function controlError(status: number, code: string, error: string) {
  return NextResponse.json(
    { error, code, remediationPhase: 'phase-2j-server-authoritative-automation-control' },
    { status },
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let userId: string;
  try { userId = getUserIdSync(req); } catch { return authRequiredResponse(); }
  const { id } = await params;

  // Availability and tenant ownership are security boundaries and are
  // evaluated before control-payload validation. This preserves fail-closed
  // 503 behavior and prevents malformed requests from becoming an ownership
  // oracle for another tenant's bot.
  if (!db || !hasModel('bot')) {
    return controlError(503, 'SERVICE_UNAVAILABLE', 'Bot automation control is temporarily unavailable.');
  }

  try {
    const bot = await db.bot.findFirst({
      where: { id, userId },
      include: { account: true },
    });
    if (!bot) return controlError(404, 'BOT_NOT_FOUND', 'Bot not found.');

    const parsed = ControlSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return controlError(
        400,
        'INVALID_AUTOMATION_CONTROL',
        'Request must explicitly set enabled=true or enabled=false.',
      );
    }
    const desiredEnabled = parsed.data.enabled;

    // START: only explicitly-demo accounts with canonical bot configuration.
    if (desiredEnabled) {
      if (bot.status === 'stopping') {
        return controlError(
          409,
          'AUTOMATION_STOP_IN_PROGRESS',
          'Stop is still settling AI-created paper positions. Wait until status is stopped before starting again.',
        );
      }

      if (bot.enabled === true && bot.status === 'running') {
        return NextResponse.json({
          success: true,
          idempotent: true,
          enabled: true,
          status: 'running',
          openPaperPositions: 0,
          closePending: false,
        });
      }

      if (!bot.account) {
        return controlError(
          403,
          CONTAINMENT_CODES.PHASE1_LIVE_TRADING_DISABLED,
          'Phase 1 containment: cannot start automation without an account.',
        );
      }
      if (!isExplicitlyDemo(bot.account)) {
        return controlError(
          403,
          CONTAINMENT_CODES.PHASE1_LIVE_TRADING_DISABLED,
          'Phase 1 containment: live trading is not permitted.',
        );
      }

      const policy = validateAutomatedBotConfiguration({
        strategy: bot.strategy,
        timeframe: bot.timeframe,
        allocationAmount: bot.allocationAmount,
        riskPerTrade: bot.riskPerTrade,
        maxPositions: bot.maxPositions,
        accountBalance: bot.account.balance,
      });
      if (!policy.valid) {
        return controlError(409, policy.code, policy.reason);
      }

      const { count } = await db.bot.updateMany({
        where: { id, userId, NOT: { status: 'stopping' } },
        data: {
          enabled: true,
          status: 'running',
          positionSizing: 'canonical_risk_v1',
          lastError: null,
        },
      });
      if (count !== 1) {
        return controlError(409, 'AUTOMATION_START_CONFLICT', 'Bot lifecycle changed before Start completed.');
      }

      logSecurityEvent({
        eventType: 'PAPER_AUTOMATION_STARTED',
        route: '/api/trading/bots/[id]/toggle',
        userId,
        reason: `User confirmed Start for demo paper bot ${id}.`,
      });

      return NextResponse.json({
        success: true,
        idempotent: false,
        enabled: true,
        status: 'running',
        openPaperPositions: 0,
        closePending: false,
      });
    }

    // STOP: disable NEW exposure immediately, then allow the internal paper
    // engine to settle deterministic AI paper positions before final status.
    // Position storage is a Stop-specific dependency; Start and tenant-scoped
    // bot lookup do not require it.
    if (!hasModel('position')) {
      return controlError(
        503,
        'SERVICE_UNAVAILABLE',
        'Paper position persistence is unavailable; Stop cannot safely settle exposure.',
      );
    }

    if (bot.enabled === false && bot.status === 'stopped') {
      return NextResponse.json({
        success: true,
        idempotent: true,
        enabled: false,
        status: 'stopped',
        openPaperPositions: 0,
        closePending: false,
      });
    }

    const openPositions = await db.position.findMany({
      where: { botId: id, accountId: bot.accountId, status: 'open' },
      select: { id: true },
      orderBy: { openedAt: 'asc' },
    });

    const unexpectedExposure = openPositions.filter((position) => !position.id.startsWith('ppos_'));
    if (unexpectedExposure.length > 0) {
      logSecurityEvent({
        eventType: 'AUTOMATION_STOP_NON_PAPER_EXPOSURE_BLOCKED',
        route: '/api/trading/bots/[id]/toggle',
        userId,
        reason: `Bot ${id} has ${unexpectedExposure.length} open non-paper position(s); automatic stop-close refused.`,
      });
      return controlError(
        409,
        'NON_PAPER_AI_EXPOSURE_REQUIRES_REVIEW',
        'Unexpected non-paper AI exposure exists. Automatic Stop cannot close it.',
      );
    }

    const nextStatus = openPositions.length > 0 ? 'stopping' : 'stopped';
    const { count } = await db.bot.updateMany({
      where: { id, userId },
      data: {
        enabled: false,
        status: nextStatus,
      },
    });
    if (count !== 1) return controlError(404, 'BOT_NOT_FOUND', 'Bot not found.');

    logSecurityEvent({
      eventType: 'PAPER_AUTOMATION_STOP_REQUESTED',
      route: '/api/trading/bots/[id]/toggle',
      userId,
      reason: openPositions.length > 0
        ? `User confirmed Stop for bot ${id}; ${openPositions.length} paper position(s) queued for verified settlement.`
        : `User confirmed Stop for bot ${id}; no open paper positions remained.`,
    });

    return NextResponse.json({
      success: true,
      idempotent: false,
      enabled: false,
      status: nextStatus,
      openPaperPositions: openPositions.length,
      closePending: openPositions.length > 0,
    });
  } catch (error) {
    if (error instanceof AuthRequiredError) return authRequiredResponse();
    logSecurityEvent({
      eventType: 'BOTS_TOGGLE_ERROR', route: '/api/trading/bots/[id]/toggle', userId,
      reason: error instanceof Error ? error.message : 'Unknown error',
    });
    return controlError(500, 'AUTOMATION_CONTROL_FAILED', 'Failed to change automation state.');
  }
}
