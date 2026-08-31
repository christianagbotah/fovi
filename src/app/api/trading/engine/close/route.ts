// ============================================================
// POST /api/trading/engine/close
// Phase 2G: internal, deterministic, idempotent PAPER settlement.
// ------------------------------------------------------------
// This is a close-only safety/reconciliation path. It never constructs a
// broker. A verified live-market snapshot must cross the persisted SL/TP,
// then Position + close Order + settlement ledger + account balance/P&L/levy
// + bot statistics settle in one SERIALIZABLE database transaction.
// ============================================================

import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db, hasModel } from '@/lib/db';
import { evaluateEngineAccountEligibility } from '@/lib/engine-eligibility';
import { getGlobalAdminLevy } from '@/lib/system-config';
import { enforceInternalAuth, logSecurityEvent } from '@/lib/trading-policy';
import {
  LEGACY_POSITION_RECONCILIATION_CONTRACT_VERSION,
  PAPER_SETTLEMENT_ACCOUNTING_VERSION,
  POSITION_RECONCILIATION_CONTRACT_VERSION,
  buildPaperCloseOrderId,
  buildPaperSettlementId,
  calculatePaperRawPnl,
  nearlyEqual as settlementNearlyEqual,
  validatePaperCloseAgainstPosition,
  validatePaperCloseIntent,
  validatePaperSettlement,
  type PaperCloseIntent,
  type PaperSettlementValues,
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
    { error, code, remediationPhase: 'phase-2g-pnl-levy-reconciliation' },
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

function auditNumber(audit: Record<string, unknown> | null, key: string): number | null {
  const value = audit?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function auditString(audit: Record<string, unknown> | null, key: string): string | null {
  const value = audit?.[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function settlementValuesFromAudit(
  audit: Record<string, unknown>,
  intent: PaperCloseIntent,
  closeOrderId: string,
): PaperSettlementValues | null {
  const rawPnl = auditNumber(audit, 'rawPnl');
  const adminLevyPercent = auditNumber(audit, 'adminLevyPercent');
  const adminLevy = auditNumber(audit, 'adminLevy');
  const realizedPnl = auditNumber(audit, 'realizedPnl');
  const entryPrice = auditNumber(audit, 'entryPrice');
  const exitPrice = auditNumber(audit, 'exitPrice');
  const balanceBefore = auditNumber(audit, 'balanceBefore');
  const balanceAfter = auditNumber(audit, 'balanceAfter');
  const marketData = audit.marketData;
  const market = marketData && typeof marketData === 'object'
    ? marketData as Record<string, unknown>
    : null;
  const source = market && typeof market.source === 'string' ? market.source : null;
  const observedAt = market && typeof market.observedAt === 'string' ? market.observedAt : null;

  if (
    rawPnl === null || adminLevyPercent === null || adminLevy === null || realizedPnl === null ||
    entryPrice === null || exitPrice === null || balanceBefore === null || balanceAfter === null ||
    !source || !observedAt
  ) return null;

  return {
    positionId: intent.positionId,
    closeOrderId,
    userId: intent.userId,
    accountId: intent.accountId,
    botId: intent.botId,
    symbol: intent.symbol,
    side: intent.side,
    quantity: intent.quantity,
    entryPrice,
    exitPrice,
    rawPnl,
    adminLevyPercent,
    adminLevy,
    realizedPnl,
    balanceBefore,
    balanceAfter,
    closeReason: intent.reason,
    marketDataSource: source,
    marketObservedAt: observedAt,
  };
}

async function reconcileExistingClose(
  intent: PaperCloseIntent,
  position: { status: string; realizedPnl: number },
  existingCloseOrder: { reason: string | null } & Record<string, unknown>,
  closeOrderId: string,
  settlementId: string,
) {
  if (position.status !== 'closed') {
    return closeError(
      409,
      'PAPER_CLOSE_RECONCILIATION_INCONSISTENT',
      'Close order exists but persisted position is not closed.',
    );
  }

  const audit = parseCloseAudit(existingCloseOrder.reason);
  const contractVersion = auditString(audit, 'closeContractVersion');

  // Compatibility: Phase 2E/F closes predate the settlement ledger. We do not
  // fabricate a historical balanceBefore/balanceAfter row after the fact.
  if (contractVersion === LEGACY_POSITION_RECONCILIATION_CONTRACT_VERSION) {
    return NextResponse.json({
      executionEnvironment: 'paper',
      idempotent: true,
      legacyAccounting: true,
      order: existingCloseOrder,
      position,
      settlement: null,
      rawPnl: auditNumber(audit, 'rawPnl'),
      adminLevy: auditNumber(audit, 'adminLevy'),
      adminLevyPercent: auditNumber(audit, 'adminLevyPercent'),
      realizedPnl: position.realizedPnl,
    });
  }

  if (contractVersion !== POSITION_RECONCILIATION_CONTRACT_VERSION) {
    return closeError(
      409,
      'PAPER_CLOSE_RECONCILIATION_INCONSISTENT',
      'Close order has an unknown accounting contract version.',
    );
  }

  const expected = audit ? settlementValuesFromAudit(audit, intent, closeOrderId) : null;
  const settlement = await db!.paperTradeSettlement.findUnique({ where: { id: settlementId } });
  if (!expected) {
    return closeError(
      409,
      'PAPER_SETTLEMENT_RECONCILIATION_INCONSISTENT',
      'Current close order audit is missing deterministic settlement accounting fields.',
    );
  }
  const validation = validatePaperSettlement(expected, settlement);
  if (!validation.valid || !settlementNearlyEqual(position.realizedPnl, expected.realizedPnl)) {
    return closeError(
      409,
      'PAPER_SETTLEMENT_RECONCILIATION_INCONSISTENT',
      validation.valid ? 'Closed position realized P&L disagrees with settlement truth.' : validation.reason,
    );
  }

  return NextResponse.json({
    executionEnvironment: 'paper',
    idempotent: true,
    legacyAccounting: false,
    order: existingCloseOrder,
    position,
    settlement,
    rawPnl: expected.rawPnl,
    adminLevy: expected.adminLevy,
    adminLevyPercent: expected.adminLevyPercent,
    realizedPnl: expected.realizedPnl,
    balanceBefore: expected.balanceBefore,
    balanceAfter: expected.balanceAfter,
  });
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

  if (
    !db || !hasModel('position') || !hasModel('order') || !hasModel('bot') ||
    !hasModel('tradingAccount') || !hasModel('paperTradeSettlement')
  ) {
    return closeError(503, 'SERVICE_UNAVAILABLE', 'Paper settlement persistence is unavailable. Position remains open.');
  }

  const closeOrderId = buildPaperCloseOrderId(intent.positionId);
  const settlementId = buildPaperSettlementId(intent.positionId);

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

    const existingCloseOrder = await db.order.findUnique({ where: { id: closeOrderId } });
    if (existingCloseOrder) {
      return reconcileExistingClose(
        intent,
        position,
        existingCloseOrder as typeof existingCloseOrder & Record<string, unknown>,
        closeOrderId,
        settlementId,
      );
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
    const marketObservedAt = new Date(intent.marketData.observedAt);
    const closeSide = intent.side === 'long' ? 'sell' : 'buy';

    const persisted = await db.$transaction(async (tx) => {
      const accountAtSettlement = await tx.tradingAccount.findFirst({
        where: { id: intent.accountId, userId: intent.userId },
      });
      if (!accountAtSettlement || !Number.isFinite(accountAtSettlement.balance)) {
        throw Object.assign(new Error('Trading account balance is unavailable for settlement.'), { code: 'PAPER_CLOSE_CONFLICT' });
      }

      const balanceBefore = accountAtSettlement.balance;
      const balanceAfter = balanceBefore + realizedPnl;
      if (!Number.isFinite(balanceAfter)) {
        throw Object.assign(new Error('Paper settlement would produce a non-finite account balance.'), { code: 'PAPER_CLOSE_CONFLICT' });
      }

      const auditEnvelope = JSON.stringify({
        closeContractVersion: intent.contractVersion,
        accountingVersion: PAPER_SETTLEMENT_ACCOUNTING_VERSION,
        closeIntentId: intent.closeIntentId,
        settlementId,
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
        balanceBefore,
        balanceAfter,
        marketData: intent.marketData,
      });

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

      const settlement = await tx.paperTradeSettlement.create({
        data: {
          id: settlementId,
          closeOrderId,
          positionId: intent.positionId,
          userId: intent.userId,
          accountId: intent.accountId,
          botId: intent.botId,
          symbol: position.symbol,
          side: intent.side,
          quantity: position.qty,
          entryPrice: position.avgEntryPrice,
          exitPrice: intent.referencePrice,
          rawPnl,
          adminLevyPercent,
          adminLevy,
          realizedPnl,
          balanceBefore,
          balanceAfter,
          closeReason: intent.reason,
          marketDataSource: intent.marketData.source,
          marketObservedAt,
        },
      });

      const accountData: Record<string, unknown> = {
        balance: { increment: realizedPnl },
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

      const [closedPosition, settledAccount] = await Promise.all([
        tx.position.findUnique({ where: { id: intent.positionId } }),
        tx.tradingAccount.findFirst({ where: { id: intent.accountId, userId: intent.userId } }),
      ]);
      if (!closedPosition || !settledAccount) {
        throw Object.assign(new Error('Paper settlement state could not be reloaded.'), { code: 'PAPER_CLOSE_CONFLICT' });
      }
      if (!settlementNearlyEqual(settledAccount.balance, balanceAfter)) {
        throw Object.assign(new Error('Persisted account balance does not match settlement ledger.'), { code: 'PAPER_CLOSE_CONFLICT' });
      }

      return { order, position: closedPosition, settlement, balanceBefore, balanceAfter };
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });

    logSecurityEvent({
      eventType: 'PAPER_POSITION_CLOSED',
      route: '/api/trading/engine/close',
      userId: intent.userId,
      reason: `${intent.reason} ${intent.positionId} ${intent.symbol} @ ${intent.referencePrice}; realizedPnl=${realizedPnl}; balanceAfter=${persisted.balanceAfter}`,
    });

    return NextResponse.json({
      executionEnvironment: 'paper',
      idempotent: false,
      legacyAccounting: false,
      order: persisted.order,
      position: persisted.position,
      settlement: persisted.settlement,
      rawPnl,
      adminLevy,
      adminLevyPercent,
      realizedPnl,
      balanceBefore: persisted.balanceBefore,
      balanceAfter: persisted.balanceAfter,
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
          include: { account: true, bot: true },
        }).catch(() => null),
      ]);
      if (existingCloseOrder && closedPosition) {
        return reconcileExistingClose(
          intent,
          closedPosition,
          existingCloseOrder as typeof existingCloseOrder & Record<string, unknown>,
          closeOrderId,
          settlementId,
        );
      }
      return closeError(409, 'PAPER_CLOSE_CONFLICT', 'Concurrent paper close could not be reconciled to durable state.');
    }

    // PostgreSQL SERIALIZABLE conflicts are intentionally not converted into
    // fabricated success. The deterministic close can be retried next cycle.
    if (code === 'P2034') {
      return closeError(
        409,
        'PAPER_SETTLEMENT_SERIALIZATION_CONFLICT',
        'Concurrent account settlement conflicted. Retry the same deterministic close intent.',
      );
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
