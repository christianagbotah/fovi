import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';
import { getUserId, AuthRequiredError, authRequiredResponse } from '@/lib/get-user-id';
import { getGlobalAdminLevy } from '@/lib/system-config';
import { checkSubscriptionLimit, getLimitMessage } from '@/lib/subscription-guard';
import { isExplicitlyDemo, CONTAINMENT_CODES, logSecurityEvent } from '@/lib/trading-policy';

const DEFAULT_CONFIG = {
  id: null, enabled: false, allocationAmount: 0, riskTolerance: 'medium',
  maxPositions: 5, maxPositionSize: 0, stopLossPercent: 2.0, takeProfitPercent: 4.0,
  strategy: 'balanced', status: 'stopped', totalTrades: 0, winTrades: 0,
  totalPnl: 0, winRate: 0, lastTradeAt: null, lastError: null, accountBalance: 0,
  adminLevyPercent: 10, adminLevyCollected: 0,
};

// GET /api/trading/auto-trade — DB is the source of truth
export async function GET(req: NextRequest) {
  try {
    // CR4.3B: Auth BEFORE getGlobalAdminLevy / DB checks
    const userId = await getUserId(req);

    const globalLevy = await getGlobalAdminLevy();

    if (!db || !hasModel('tradingAccount')) {
      return NextResponse.json(
        { error: 'Auto-trade configuration is temporarily unavailable.', code: 'SERVICE_UNAVAILABLE', remediationPhase: 'containment' },
        { status: 503 },
      );
    }
    const defaultAccount = await db.tradingAccount.findFirst({
      where: { userId, isDefault: true },
    });
    if (!defaultAccount) return NextResponse.json(
      { error: 'No default account found', code: 'SERVICE_UNAVAILABLE', remediationPhase: 'containment' },
      { status: 404 },
    );

    let config = await db.botConfig.findFirst({
      where: { userId, accountId: defaultAccount.id },
    });
    if (!config) {
      config = await db.botConfig.create({
        data: { userId: defaultAccount.userId, accountId: defaultAccount.id },
      });
    }

    // Cleanup duplicates (non-critical) — tenant-scoped
    try {
      const allConfigs = await db.botConfig.findMany({
        where: { userId, accountId: defaultAccount.id },
        orderBy: { createdAt: 'desc' },
      });
      if (allConfigs.length > 1) {
        for (let i = 1; i < allConfigs.length; i++) {
          try { await db.botConfig.deleteMany({ where: { id: allConfigs[i].id, userId } }); } catch { /* */ }
        }
      }
    } catch { /* non-critical cleanup */ }

    const winRate = config.totalTrades > 0
      ? Math.round((config.winTrades / config.totalTrades) * 100)
      : 0;
    return NextResponse.json({
      ...config,
      winRate,
      accountBalance: defaultAccount.balance,
      adminLevyPercent: globalLevy,
    });
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      return authRequiredResponse();
    }
    logSecurityEvent({
      eventType: 'AUTO_TRADE_GET_ERROR',
      route: '/api/trading/auto-trade',
      reason: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json({ error: 'Failed to fetch auto-trade config' }, { status: 500 });
  }
}

// PUT /api/trading/auto-trade — Persist ALL fields to DB
export async function PUT(request: Request) {
  // CR4.3B: Auth BEFORE body parse / DB / config
  let userId: string;
  try {
    userId = await getUserId(request);
  } catch {
    return authRequiredResponse();
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const globalLevy = await getGlobalAdminLevy();

  if (!db || !hasModel('tradingAccount')) {
    return NextResponse.json(
      { error: 'Auto-trade configuration is temporarily unavailable.', code: 'SERVICE_UNAVAILABLE', remediationPhase: 'containment' },
      { status: 503 },
    );
  }

  try {
    const defaultAccount = await db.tradingAccount.findFirst({
      where: { userId, isDefault: true },
    });
    if (!defaultAccount) {
      return NextResponse.json({ error: 'No default account found' }, { status: 404 });
    }

    // Phase 1: block enabling if account is NOT explicitly demo
    if (body.enabled === true && !isExplicitlyDemo(defaultAccount)) {
      return NextResponse.json(
        {
          error: 'Phase 1 containment: live trading is not permitted.',
          code: CONTAINMENT_CODES.PHASE1_LIVE_TRADING_DISABLED,
          remediationPhase: 'containment',
        },
        { status: 403 },
      );
    }

    const enabled = body.enabled as boolean | undefined;
    const newStatus = enabled === true ? 'running' : 'stopped';

    // Subscription limit check (only when enabling)
    if (enabled === true || newStatus === 'running') {
      const botCheck = await checkSubscriptionLimit(userId, 'maxBots');
      if (!botCheck.allowed) {
        return NextResponse.json(
          { error: getLimitMessage('maxBots'), current: botCheck.current, limit: botCheck.limit },
          { status: 403 },
        );
      }
    }

    const updateData: Record<string, unknown> = { status: newStatus };
    if (enabled !== undefined) updateData.enabled = enabled;
    if (body.allocationAmount !== undefined) updateData.allocationAmount = body.allocationAmount;
    if (body.riskTolerance !== undefined) updateData.riskTolerance = body.riskTolerance;
    if (body.maxPositions !== undefined) updateData.maxPositions = body.maxPositions;
    if (body.maxPositionSize !== undefined) updateData.maxPositionSize = body.maxPositionSize;
    if (body.stopLossPercent !== undefined) updateData.stopLossPercent = body.stopLossPercent;
    if (body.takeProfitPercent !== undefined) updateData.takeProfitPercent = body.takeProfitPercent;
    if (body.strategy !== undefined) updateData.strategy = body.strategy;
    // Performance fields are NEVER accepted from the client
    // (totalTrades, winTrades, totalPnl stripped)

    const existingConfig = await db.botConfig.findFirst({
      where: { userId, accountId: defaultAccount.id },
    });

    let config;
    if (existingConfig) {
      // CR4.3B: Tenant-scoped updateMany
      const { count } = await db.botConfig.updateMany({
        where: { id: existingConfig.id, userId },
        data: updateData,
      });
      if (count === 0) {
        return NextResponse.json({ error: 'Config not found' }, { status: 404 });
      }
      config = await db.botConfig.findFirst({
        where: { id: existingConfig.id, userId },
      });
    } else {
      config = await db.botConfig.create({
        data: {
          userId: defaultAccount.userId,
          accountId: defaultAccount.id,
          enabled: enabled ?? false,
          allocationAmount: (body.allocationAmount as number) ?? 0,
          riskTolerance: (body.riskTolerance as string) ?? 'medium',
          maxPositions: (body.maxPositions as number) ?? 5,
          maxPositionSize: (body.maxPositionSize as number) ?? 0,
          stopLossPercent: (body.stopLossPercent as number) ?? 2.0,
          takeProfitPercent: (body.takeProfitPercent as number) ?? 4.0,
          strategy: (body.strategy as string) ?? 'balanced',
          status: newStatus,
          // Performance fields are NEVER accepted from the client
          totalTrades: 0,
          winTrades: 0,
          totalPnl: 0,
        },
      });
    }

    const winRate = config.totalTrades > 0
      ? Math.round((config.winTrades / config.totalTrades) * 100)
      : 0;
    return NextResponse.json({
      ...config,
      winRate,
      accountBalance: defaultAccount.balance,
      adminLevyPercent: globalLevy,
    });
  } catch (error) {
    logSecurityEvent({
      eventType: 'AUTO_TRADE_PUT_ERROR',
      route: '/api/trading/auto-trade',
      userId,
      reason: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json({ error: 'Failed to save config' }, { status: 500 });
  }
}
