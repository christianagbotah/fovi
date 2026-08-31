import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';
import { getUserIdSync, AuthRequiredError, authRequiredResponse } from '@/lib/get-user-id';
import { isExplicitlyDemo, logSecurityEvent } from '@/lib/trading-policy';
import { validateAutomatedBotConfiguration } from '@/lib/trading-intelligence/bot-policy';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let userId: string;
  try { userId = getUserIdSync(req); } catch { return authRequiredResponse(); }
  const { id } = await params;

  if (!db || !hasModel('bot')) {
    return NextResponse.json(
      { error: 'Bot data is temporarily unavailable.', code: 'SERVICE_UNAVAILABLE', remediationPhase: 'containment' },
      { status: 503 },
    );
  }

  try {
    const bot = await db.bot.findFirst({ where: { id, userId } });
    if (!bot) return NextResponse.json({ error: 'Bot not found' }, { status: 404 });
    return NextResponse.json(bot);
  } catch (error) {
    if (error instanceof AuthRequiredError) return authRequiredResponse();
    logSecurityEvent({
      eventType: 'BOTS_ID_GET_ERROR', route: '/api/trading/bots/[id]',
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
  try { userId = getUserIdSync(req); } catch { return authRequiredResponse(); }

  const { id } = await params;
  const body = await req.json().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>;

  if (!db || !hasModel('bot')) {
    return NextResponse.json(
      { error: 'Bot update is temporarily unavailable.', code: 'SERVICE_UNAVAILABLE', remediationPhase: 'containment' },
      { status: 503 },
    );
  }

  try {
    const bot = await db.bot.findFirst({
      where: { id, userId },
      include: { account: true },
    });
    if (!bot) return NextResponse.json({ error: 'Bot not found' }, { status: 404 });

    const ALLOWED_FIELDS = [
      'name', 'strategy', 'symbols', 'timeframe', 'allocationAmount',
      'riskPerTrade', 'maxPositions', 'stopLossPercent', 'takeProfitPercent',
      'trailingStopPct', 'tradingSessions', 'customSessionStart', 'customSessionEnd', 'config',
    ] as const;
    const data: Record<string, unknown> = {};
    for (const field of ALLOWED_FIELDS) {
      if (body[field] !== undefined) data[field] = body[field];
    }
    if (data.config && typeof data.config === 'object') data.config = JSON.stringify(data.config);

    const touchesDecisionPolicy = ['strategy', 'timeframe', 'allocationAmount', 'riskPerTrade', 'maxPositions']
      .some((field) => body[field] !== undefined);

    if (touchesDecisionPolicy || bot.enabled || bot.status === 'running') {
      if (!bot.account || !isExplicitlyDemo(bot.account)) {
        return NextResponse.json(
          {
            error: 'Phase 1 containment: automated bot configuration requires an explicitly demo account.',
            code: 'PHASE1_LIVE_TRADING_DISABLED', remediationPhase: 'containment',
          },
          { status: 403 },
        );
      }

      const strategy = body.strategy === undefined ? bot.strategy : String(body.strategy);
      const timeframe = body.timeframe === undefined ? bot.timeframe : String(body.timeframe);
      const allocationAmount = body.allocationAmount === undefined ? bot.allocationAmount : Number(body.allocationAmount);
      const riskPerTrade = body.riskPerTrade === undefined ? bot.riskPerTrade : Number(body.riskPerTrade);
      const maxPositions = body.maxPositions === undefined ? bot.maxPositions : Number(body.maxPositions);

      const policy = validateAutomatedBotConfiguration({
        strategy,
        timeframe,
        allocationAmount,
        riskPerTrade,
        maxPositions,
        accountBalance: bot.account.balance,
      });
      if (!policy.valid) {
        return NextResponse.json(
          { error: policy.reason, code: policy.code, remediationPhase: 'phase-2c', dataPolicy: 'verified-only' },
          { status: 400 },
        );
      }

      data.strategy = strategy.trim().toLowerCase();
      data.timeframe = '4h';
      data.allocationAmount = allocationAmount;
      data.riskPerTrade = riskPerTrade;
      data.maxPositions = maxPositions;
      data.positionSizing = 'canonical_risk_v1';
    }

    // If an old non-demo bot somehow exists, preserve containment by stopping it.
    if (bot.account && !isExplicitlyDemo(bot.account) && (bot.enabled || bot.status === 'running')) {
      data.enabled = false;
      data.status = 'stopped';
    }

    const { count } = await db.bot.updateMany({ where: { id, userId }, data });
    if (count === 0) return NextResponse.json({ error: 'Bot not found' }, { status: 404 });

    const updated = await db.bot.findFirst({ where: { id, userId } });
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof AuthRequiredError) return authRequiredResponse();
    logSecurityEvent({
      eventType: 'BOTS_ID_PUT_ERROR', route: '/api/trading/bots/[id]', userId,
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
  try { userId = getUserIdSync(req); } catch { return authRequiredResponse(); }
  const { id } = await params;

  if (!db || !hasModel('bot')) {
    return NextResponse.json(
      { error: 'Bot deletion is temporarily unavailable.', code: 'SERVICE_UNAVAILABLE', remediationPhase: 'containment' },
      { status: 503 },
    );
  }

  try {
    const { count } = await db.bot.deleteMany({ where: { id, userId } });
    if (count === 0) return NextResponse.json({ error: 'Bot not found' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthRequiredError) return authRequiredResponse();
    logSecurityEvent({
      eventType: 'BOTS_ID_DELETE_ERROR', route: '/api/trading/bots/[id]', userId,
      reason: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json({ error: 'Failed to delete bot' }, { status: 500 });
  }
}
