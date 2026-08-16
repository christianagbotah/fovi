import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel, ensureDemoUser } from '@/lib/db';
import { getUserId } from '@/lib/get-user-id';
import { getGlobalAdminLevy } from '@/lib/system-config';
import { checkSubscriptionLimit, getLimitMessage } from '@/lib/subscription-guard';

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
    const globalLevy = await getGlobalAdminLevy();

    if (!db || !hasModel('tradingAccount')) {
      return NextResponse.json({ ...DEFAULT_CONFIG, adminLevyPercent: globalLevy }, { headers: { 'x-demo': 'true' } });
    }
    await ensureDemoUser();
    const userId = await getUserId(req);
    const defaultAccount = await db.tradingAccount.findFirst({
      where: { userId, isDefault: true },
    });
    if (!defaultAccount) return NextResponse.json({ ...DEFAULT_CONFIG, adminLevyPercent: globalLevy }, { headers: { 'x-demo': 'true' } });

    let config = await db.botConfig.findFirst({
      where: { accountId: defaultAccount.id },
    });
    if (!config) {
      config = await db.botConfig.create({
        data: { userId: defaultAccount.userId, accountId: defaultAccount.id },
      });
    }

    // --- Cleanup: if old bug created duplicate BotConfigs, delete extras ---
    try {
      const allConfigs = await db.botConfig.findMany({
        where: { accountId: defaultAccount.id },
        orderBy: { createdAt: 'desc' },
      });
      if (allConfigs.length > 1) {
        console.warn(`[auto-trade] Found ${allConfigs.length} BotConfigs for account ${defaultAccount.id}, cleaning up`);
        for (let i = 1; i < allConfigs.length; i++) {
          try { await db.botConfig.delete({ where: { id: allConfigs[i].id } }); } catch { /* */ }
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
    console.warn('[auto-trade GET] DB error, using fallback:', error);
    return NextResponse.json(DEFAULT_CONFIG, { headers: { 'x-demo': 'true' } });
  }
}

// PUT /api/trading/auto-trade — Persist ALL fields to DB
export async function PUT(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch (error) {
    console.error('PUT /api/trading/auto-trade JSON parse error:', error);
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const {
    enabled, allocationAmount, riskTolerance, maxPositions,
    maxPositionSize, stopLossPercent, takeProfitPercent,
    strategy, status, totalTrades, winTrades, totalPnl,
    adminLevyCollected,
  } = body;

  // Always use the global admin levy — users cannot set their own
  const globalLevy = await getGlobalAdminLevy();

  // Derive status from enabled if not explicitly provided
  let newStatus = status;
  if (newStatus === undefined || newStatus === null) {
    if (enabled === true) newStatus = 'running';
    else if (enabled === false) newStatus = 'stopped';
    else newStatus = 'stopped';
  }

  // Demo-mode fallback (no DB available)
  if (!db || !hasModel('tradingAccount')) {
    return NextResponse.json({
      ...DEFAULT_CONFIG,
      ...body,
      adminLevyPercent: globalLevy,
      status: newStatus,
      enabled: enabled ?? false,
    }, { headers: { 'x-demo': 'true' } });
  }

  try {
    await ensureDemoUser();
    const userId = await getUserId(request);
    const defaultAccount = await db.tradingAccount.findFirst({
      where: { userId, isDefault: true },
    });
    if (!defaultAccount) {
      return NextResponse.json({ error: 'No default account found' }, { status: 404 });
    }

    // --- Subscription limit check (only when enabling auto-trade) ---
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
    if (allocationAmount !== undefined) updateData.allocationAmount = allocationAmount;
    if (riskTolerance !== undefined) updateData.riskTolerance = riskTolerance;
    if (maxPositions !== undefined) updateData.maxPositions = maxPositions;
    if (maxPositionSize !== undefined) updateData.maxPositionSize = maxPositionSize;
    if (stopLossPercent !== undefined) updateData.stopLossPercent = stopLossPercent;
    if (takeProfitPercent !== undefined) updateData.takeProfitPercent = takeProfitPercent;
    if (strategy !== undefined) updateData.strategy = strategy;
    if (totalTrades !== undefined) updateData.totalTrades = totalTrades;
    if (winTrades !== undefined) updateData.winTrades = winTrades;
    if (totalPnl !== undefined) updateData.totalPnl = totalPnl;
    if (adminLevyCollected !== undefined) updateData.adminLevyCollected = adminLevyCollected;

    // --- CRITICAL FIX: Always find by accountId, NOT by client-provided body.id ---
    // Previously, upsert used body.id which could be stale/null/wrong, causing
    // writes to go to the wrong record or creating duplicates. GET uses accountId
    // so PUT must use the same lookup to stay consistent.
    const existingConfig = await db.botConfig.findFirst({
      where: { accountId: defaultAccount.id },
    });

    let config;
    if (existingConfig) {
      // Update the existing record for this account
      config = await db.botConfig.update({
        where: { id: existingConfig.id },
        data: updateData,
      });
    } else {
      // First time — create with the provided values
      config = await db.botConfig.create({
        data: {
          userId: defaultAccount.userId,
          accountId: defaultAccount.id,
          enabled: enabled ?? false,
          allocationAmount: allocationAmount ?? 0,
          riskTolerance: riskTolerance ?? 'medium',
          maxPositions: maxPositions ?? 5,
          maxPositionSize: maxPositionSize ?? 0,
          stopLossPercent: stopLossPercent ?? 2.0,
          takeProfitPercent: takeProfitPercent ?? 4.0,
          strategy: strategy ?? 'balanced',
          status: newStatus,
          totalTrades: totalTrades ?? 0,
          winTrades: winTrades ?? 0,
          totalPnl: totalPnl ?? 0,
          adminLevyCollected: adminLevyCollected ?? 0,
        },
      });
    }

    // Sync UserSettings (non-critical)
    try {
      await db.userSettings.upsert({
        where: { userId: defaultAccount.userId },
        create: { userId: defaultAccount.userId, autoTradeEnabled: enabled ?? false, riskTolerance: riskTolerance ?? 'medium' },
        update: {
          ...(enabled !== undefined && { autoTradeEnabled: enabled }),
          ...(riskTolerance !== undefined && { riskTolerance }),
        },
      });
    } catch { /* non-critical */ }

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
    console.warn('[auto-trade PUT] DB error:', error);
    return NextResponse.json({ error: 'Failed to save config' }, { status: 500 });
  }
}
