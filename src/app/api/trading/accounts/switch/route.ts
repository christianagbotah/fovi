// ============================================================
// POST /api/trading/accounts/switch — Switch default account
// Phase 1 CR2: Strict auth (AuthRequiredError → 401), safe DTO.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';
import { getUserId, AuthRequiredError, authRequiredResponse } from '@/lib/get-user-id';
import { safeAccountDTO, logSecurityEvent } from '@/lib/trading-policy';

export async function POST(req: NextRequest) {
  if (!db || !hasModel('tradingAccount')) {
    return NextResponse.json(
      { error: 'Database unavailable.' },
      { status: 503 },
    );
  }
  try {
    const userId = await getUserId(req);
    const { accountId } = await req.json();

    // Unset all defaults
    await db.tradingAccount.updateMany({
      where: { userId },
      data: { isDefault: false },
    });

    // Set new default — scoped to this user
    const account = await db.tradingAccount.update({
      where: { id: accountId, userId },
      data: { isDefault: true },
    });

    return NextResponse.json(safeAccountDTO(account as unknown as Record<string, unknown>));
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      return authRequiredResponse();
    }
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
