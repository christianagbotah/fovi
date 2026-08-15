// ============================================================
// GET /api/trading/positions — Open positions list
// Phase 1 CR2: Strict auth, demo provenance.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';
import { getUserIdSync, AuthRequiredError, authRequiredResponse } from '@/lib/get-user-id';
import { createBrokerFromAccount, BrokerFactoryError } from '@/lib/broker/factory';
import { getAssetType } from '@/lib/broker/demo';
import { loadDemoPositionSLTP } from '@/lib/demo-sltp-store';
import { logSecurityEvent, isExplicitlyDemo, DEMO_PROVENANCE_HEADER } from '@/lib/trading-policy';
import { v4 as uuidv4 } from 'uuid';

export async function GET(req: NextRequest) {
  let userId: string;
  try {
    userId = getUserIdSync(req);
  } catch {
    return authRequiredResponse();
  }

  if (!db || !hasModel('tradingAccount')) {
    const correlationId = uuidv4();
    logSecurityEvent({
      eventType: 'POSITIONS_DB_UNAVAILABLE', correlationId,
      route: '/api/trading/positions', userId,
      reason: 'Database unavailable for positions query',
    });
    return NextResponse.json(
      { error: 'Position data is temporarily unavailable.', code: 'SERVICE_UNAVAILABLE', correlationId, remediationPhase: 'containment' },
      { status: 503 },
    );
  }

  try {
    const { searchParams } = new URL(req.url);
    const accountId = searchParams.get('accountId');

    const account = await db.tradingAccount.findFirst({
      where: accountId ? { id: accountId, userId } : { userId, isDefault: true },
    });

    if (!account) {
      return NextResponse.json([], { headers: { 'x-demo': 'false', 'x-storage': 'db' } });
    }

    const isDemo = isExplicitlyDemo(account);
    const broker = await createBrokerFromAccount(account);
    const brokerPositions = await broker.getPositions();

    const slTpMap = isDemo ? loadDemoPositionSLTP() : new Map();

    for (const bp of brokerPositions) {
      const existing = await db.position.findFirst({
        where: { accountId: account.id, symbol: bp.symbol, status: 'open' },
      });

      const memorySltp = slTpMap.get(bp.symbol);
      const stopLoss = memorySltp?.stopLoss ?? existing?.stopLoss ?? null;
      const takeProfit = memorySltp?.takeProfit ?? existing?.takeProfit ?? null;

      if (existing) {
        await db.position.update({
          where: { id: existing.id },
          data: {
            currentPrice: bp.currentPrice,
            unrealizedPnl: bp.unrealizedPnl,
            ...(isDemo && stopLoss !== undefined ? { stopLoss } : {}),
            ...(isDemo && takeProfit !== undefined ? { takeProfit } : {}),
          },
        });
      } else {
        await db.position.create({
          data: {
            accountId: account.id, symbol: bp.symbol,
            assetType: getAssetType(bp.symbol), side: bp.side, qty: bp.qty,
            avgEntryPrice: bp.avgEntryPrice, currentPrice: bp.currentPrice,
            unrealizedPnl: bp.unrealizedPnl,
            ...(isDemo ? { stopLoss, takeProfit } : {}),
          },
        });
      }
    }

    const positions = await db.position.findMany({
      where: { accountId: account.id, status: 'open' },
      orderBy: { openedAt: 'desc' },
    });

    if (isDemo) {
      for (const pos of positions) {
        const memSltp = slTpMap.get(pos.symbol);
        if (memSltp) {
          if (memSltp.stopLoss !== null) pos.stopLoss = memSltp.stopLoss;
          if (memSltp.takeProfit !== null) pos.takeProfit = memSltp.takeProfit;
        }
      }
    }

    const responseHeaders: Record<string, string> = { 'x-storage': 'db' };
    if (isDemo) {
      Object.assign(responseHeaders, DEMO_PROVENANCE_HEADER);
    }

    return NextResponse.json(positions, { headers: responseHeaders });
  } catch (error) {
    const correlationId = uuidv4();
    logSecurityEvent({
      eventType: 'POSITIONS_ERROR', correlationId,
      route: '/api/trading/positions', userId,
      reason: error instanceof Error ? error.message : 'Unknown error',
    });

    if (error instanceof BrokerFactoryError) {
      return NextResponse.json(
        { error: error.message, code: error.code, correlationId, remediationPhase: 'containment' },
        { status: error.code === 'BROKER_CONNECTION_FAILED' ? 503 : 400 },
      );
    }

    return NextResponse.json(
      { error: 'Failed to fetch positions.', code: 'POSITIONS_ERROR', correlationId, remediationPhase: 'containment' },
      { status: 500 },
    );
  }
}
