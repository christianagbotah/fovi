// ============================================================
// POST /api/trading/engine/close
// Phase 2E: internal, deterministic, idempotent PAPER position settlement.
// ------------------------------------------------------------
// This is a close-only safety/reconciliation path. It never constructs a
// broker. A verified live-market snapshot must cross the persisted SL/TP,
// then Position + close Order + account P&L/levy + bot statistics settle in
// one database transaction. The close Order ID is position-stable, making a
// second settlement impossible across retries/restarts.
// ============================================================

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, hasModel } from '@/lib/db';
import { evaluateEngineAccountEligibility } from '@/lib/engine-eligibility';
import { getGlobalAdminLevy } from '@/lib/system-config';
import { enforceInternalAuth, logSecurityEvent } from '@/lib/trading-policy';
import {
  POSITION_RECONCILIATION_CONTRACT_VERSION,
  buildPaperCloseOrderId,
  calculatePaperRawPnl,
  validatePaperCloseAgainstPosition,
  validatePaperCloseIntent,
  type PaperCloseIntent,
} from '@/lib/trading-intelligence/position-reconciliation';

const CloseIntentSchema = z.object({
  contractVersion: z.literal(POSITION_RECONCILIATION_CONTRACT_VERSION),
  closeIntentId: z.string().min(8).max(80),
  userId: z.string().min(1).max(191),
  botId: z.string().min(1).max(191),
  accountId: z.string().min(1).max(191),
  positionId: z.string().min(1).max(191),
  symbol: z.string().min(1).max(30).regex(/^[A-Za-z0-9/_.-]+$/),
  side: z.enum(['long', 'short']),
  quantity: z.number().positive().max(1_000_000_000),
  referencePrice: z.number().positive(),
  reason: z.enum(['stop_loss', 'take_profit']),
  marketData: z.object({
    environment: z.enum(['live', 'demo', 'unknown']),
    isSynthetic: z.boolean(),
    source: z.string().min(1).max(200),
    observedAt: z.string().min(1).max(100),
  }),
});

function closeError(status: number, code: string, error: string) {
  return NextResponse.json(
    { error, code, remediationPhase: 'phase-2e-position-close-restart-reconciliation' },
    { status },
  );
}

function parseCloseAudit(reason: string | null): Record<string, unknown> | null {
  if (!reason) return null;
  try {
    const parsed = JSON.parse(reason);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const authError = enforceInternalAuth(req);
  if (authError) return authError;

  const raw = await req.json().catch(() => null);
  const parsed = CloseIntentSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return closeError(
      400,
      'INVALID_CLOSE_INTENT',
      `Invalid close intent: ${first?.path.join('.') || 'field'} — ${first?.message}`,
    );
  }

  const intent = parsed.data as PaperCloseIntent;
  const integrity = validatePaperCloseIntent(intent);
  if (!integrity.valid) {
    logSecurityEvent({
      eventType: 'PAPER_CLOSE_INTENT_REJECTED',
      route: '/api/trading/engine/close',
      userId: intent.userId,
      reason: `${integrity.code}: ${integrity.reason}`,
    });
    return closeError(400, integrity.code, integrity.reason);
  }

  if (!db || !hasModel('position') || !hasModel('order') || !hasModel('bot') || !hasModel('tradingAccount')) {
    return closeError(503, 'SERVICE_UNAVAILABLE', 'Paper close persistence is unavailable. Position remains open.');
  }

  const closeOrderId = buildPaperCloseOrderId(intent.positionId);

  try {
    const position = await db.position.findFirst({
      where: {
        id: intent.positionId,
        botId: intent.botId,
        accountId: intent.accountId,
      },
      include: { account: true, bot: true },
    });

    if (!position || !position.account || !position.bot) {
      return closeError(404, 'PAPER_POSITION_NOT_FOUND', 'Persisted paper position was not found.');
    }

    if (
      !position.id.startsWith('ppos_') ||
      position.bot.userId !== intent.userId ||
      position.bot.accountId !== intent.accountId ||
      position.account.userId !== intent.userId
    ) {
      return closeError(403, 'PAPER_POSITION_INELIGIBLE', 'Paper position identity is not eligible for automated settlement.');
    }

    const eligibility = evaluateEngineAccountEligibility({
      broker: position.account.broker,
      accountType: position.account.accountType,
      isDemo: position.account.isDemo,
      isActive: position.account.isActive,
      apiKey: position.account.apiKey,
      apiSecret: position.account.apiSecret,
      passphrase: position.account.passphrase,
    });
    if (!eligibility.eligible) {
      return closeError(403, 'PAPER_POSITION_INELIGIBLE', 'Account failed demo-only settlement eligibility.');
    }

    // Idempotent retry/restart path. The position-stable close Order is the
    // durable evidence that settlement already completed.
    const existingCloseOrder = await db.order.findUnique({ where: { id: closeOrderId } });
    if (existingCloseOrder) {
      if (position.status !== 'closed') {
        return closeError(
          409,
          'PAPER_CLOSE_RECONCILIATION_INCONSISTENT',
          'Close order exists but persisted position is not closed.',
        );
      }
      const audit = parseCloseAudit(existingCloseOrder.reason);
      return NextResponse.json({
        executionEnvironment: 'paper',
        idempotent: true,
        order: existingCloseOrder,
        position,
        rawPnl: audit?.rawPnl,
        adminLevy: audit?.adminLevy,
        adminLevyPercent: audit?.adminLevyPercent,
        realizedPnl: position.realizedPnl,
      });
    }

    if (position.status !== 'open') {
      return closeError(
        409,
        'CLOSED_POSITION_MISSING_CLOSE_ORDER',
        'Position is already closed without the expected deterministic close order.',
      );
    }

    const positionValidation = validatePaperCloseAgainstPosition(intent, position);
    if (!positionValidation.valid) {
      return closeError(409, positionValidation.code, positionValidation.reason);
    }

    const rawPnl = calculatePaperRawPnl(
      intent.side,
      position.avgEntryPrice,
      intent.referencePrice,
      position.qty,
    );
    const adminLevyPercent = await getGlobalAdminLevy();
    if (!Number.isFinite(adminLevyPercent) || adminLevyPercent < 0 || adminLevyPercent > 100) {
      return closeError(500, 'INVALID_ADMIN_LEVY_CONFIGURATION', 'Admin levy percentage is outside the allowed 0–100 range.');
    }

    const adminLevy = rawPnl > 0 ? rawPnl * (adminLevyPercent / 100) : 0;
    const realizedPnl = rawPnl - adminLevy;
    const closedAt = new Date();
    const closeSide = intent.side === 'long' ? 'sell' : 'buy';
    const auditEnvelope = JSON.stringify({
      closeContractVersion: intent.contractVersion,
      closeIntentId: intent.closeIntentId,
      executionEnvironment: 'paper',
      positionId: intent.positionId,
      closeReason: intent.reason,
      triggerPrice: positionValidation.triggerPrice,
      entryPrice: position.avgEntryPrice,
      exitPrice: intent.referencePrice,
      rawPnl,
      adminLevy,
      adminLevyPercent,
      realizedPnl,
      marketData: intent.marketData,
    });

    const persisted = await db.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          id: closeOrderId,
          accountId: intent.accountId,
          botId: intent.botId,
          brokerOrderId: `PAPER_CLOSE_${closeOrderId.slice(7, 31)}`,
          symbol: position.symbol,
          assetType: position.assetType,
          side: closeSide,
          type: 'market',
          qty: position.qty,
          filledQty: position.qty,
          filledPrice: intent.referencePrice,
          status: 'filled',
          aiGenerated: true,
          reason: auditEnvelope,
        },
      });

      const { count: positionCount } = await tx.position.updateMany({
        where: {
          id: intent.positionId,
          botId: intent.botId,
          accountId: intent.accountId,
          status: 'open',
        },
        data: {
          status: 'closed',
          closedAt,
          currentPrice: intent.referencePrice,
          unrealizedPnl: 0,
          realizedPnl,
        },
      });
      if (positionCount !== 1) {
        throw Object.assign(new Error('Paper position changed before close settlement.'), { code: 'PAPER_CLOSE_CONFLICT' });
      }

      const accountData: Record<string, unknown> = {
        lastSyncedAt: closedAt,
        totalRealizedProfit: { increment: realizedPnl },
      };
      if (adminLevy > 0) accountData.totalAdminLevyCollected = { increment: adminLevy };
      const { count: accountCount } = await tx.tradingAccount.updateMany({
        where: { id: intent.accountId, userId: intent.userId },
        data: accountData,
      });
      if (accountCount !== 1) {
        throw Object.assign(new Error('Trading account changed before close settlement.'), { code: 'PAPER_CLOSE_CONFLICT' });
      }

      const botData: Record<string, unknown> = {
        totalTrades: { increment: 1 },
        totalPnl: { increment: realizedPnl },
        lastTradeAt: closedAt,
      };
      if (realizedPnl > 0) botData.winTrades = { increment: 1 };
      else botData.lossTrades = { increment: 1 };
      const { count: botCount } = await tx.bot.updateMany({
        where: { id: intent.botId, userId: intent.userId, accountId: intent.accountId },
        data: botData,
      });
      if (botCount !== 1) {
        throw Object.assign(new Error('Bot changed before close settlement.'), { code: 'PAPER_CLOSE_CONFLICT' });
      }

      const closedPosition = await tx.position.findUnique({ where: { id: intent.positionId } });
      if (!closedPosition) {
        throw Object.assign(new Error('Closed paper position could not be reloaded.'), { code: 'PAPER_CLOSE_CONFLICT' });
      }

      return { order, position: closedPosition };
    });

    logSecurityEvent({
      eventType: 'PAPER_POSITION_CLOSED',
      route: '/api/trading/engine/close',
      userId: intent.userId,
      reason: `${intent.reason} ${intent.positionId} ${intent.symbol} @ ${intent.referencePrice}; realizedPnl=${realizedPnl}`,
    });

    return NextResponse.json({
      executionEnvironment: 'paper',
      idempotent: false,
      order: persisted.order,
      position: persisted.position,
      rawPnl,
      adminLevy,
      adminLevyPercent,
      realizedPnl,
    });
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code === 'P2002' || code === 'PAPER_CLOSE_CONFLICT') {
      const [existingCloseOrder, closedPosition] = await Promise.all([
        db.order.findUnique({ where: { id: closeOrderId } }).catch(() => null),
        db.position.findFirst({
          where: {
            id: intent.positionId,
            botId: intent.botId,
            accountId: intent.accountId,
            status: 'closed',
          },
        }).catch(() => null),
      ]);
      if (existingCloseOrder && closedPosition) {
        const audit = parseCloseAudit(existingCloseOrder.reason);
        return NextResponse.json({
          executionEnvironment: 'paper',
          idempotent: true,
          order: existingCloseOrder,
          position: closedPosition,
          rawPnl: audit?.rawPnl,
          adminLevy: audit?.adminLevy,
          adminLevyPercent: audit?.adminLevyPercent,
          realizedPnl: closedPosition.realizedPnl,
        });
      }
      return closeError(409, 'PAPER_CLOSE_CONFLICT', 'Concurrent paper close could not be reconciled to durable state.');
    }

    logSecurityEvent({
      eventType: 'PAPER_POSITION_CLOSE_ERROR',
      route: '/api/trading/engine/close',
      userId: intent.userId,
      reason: error instanceof Error ? error.message : 'Unknown paper close error',
    });
    return closeError(500, 'PAPER_POSITION_CLOSE_FAILED', 'Paper position close failed atomically. Position remains open.');
  }
}
