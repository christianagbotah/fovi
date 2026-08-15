// ============================================================
// POST /api/trading/accounts/switch — Switch default account
// Phase 1 CR1: P0-10 DB error returns 500. P0-11 safeAccountDTO.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';
import { getUserId } from '@/lib/get-user-id';
import { safeAccountDTO, logSecurityEvent } from '@/lib/trading-policy';

export async function POST(req: NextRequest) {
  if (!db || !hasModel('tradingAccount')) {
    return NextResponse.json(
      { error: 'Database unavailable.' },
      { status: 503 },
    );
  }
  try {
    const { accountId } = await req.json();
    const userId = await getUserId(req);

    // Unset all defaults
    await db.tradingAccount.updateMany({
      where: { userId },
      data: { isDefault: false },
    });

    // Set new default
    const account = await db.tradingAccount.update({
      where: { id: accountId, userId },
      data: { isDefault: true },
    });

    // P0-11: Return safeAccountDTO
    return NextResponse.json(safeAccountDTO(account as unknown as Record<string, unknown>));
  } catch (error) {
    // P0-10: DB error returns 500, NOT success with x-demo
    logSecurityEvent({
      eventType: 'ACCOUNT_SWITCH_ERROR',
      route: '/api/trading/accounts/switch',
      reason: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'Failed to switch account.' },
      { status: 500 },
    );
  }
}
