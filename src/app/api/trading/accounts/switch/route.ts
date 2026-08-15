// ============================================================
// POST /api/trading/accounts/switch — Switch default account
// Phase 1 CR4.1:
//   Auth before DB check.
//   Validate target account belongs to tenant BEFORE clearing defaults.
//   Use transaction for atomicity.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';
import { getUserId, AuthRequiredError, authRequiredResponse } from '@/lib/get-user-id';
import { safeAccountDTO, logSecurityEvent } from '@/lib/trading-policy';

export async function POST(req: NextRequest) {
  let userId: string;
  try {
    userId = await getUserId(req);
  } catch {
    return authRequiredResponse();
  }

  if (!db || !hasModel('tradingAccount')) {
    return NextResponse.json(
      { error: 'Database unavailable.' },
      { status: 503 },
    );
  }

  try {
    const { accountId } = await req.json();

    // CR4.1: Validate target account belongs to this tenant BEFORE clearing defaults
    const targetAccount = await db.tradingAccount.findFirst({
      where: { id: accountId, userId },
    });
    if (!targetAccount) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    // Atomic: unset all defaults, then set new default
    await db.$transaction([
      db.tradingAccount.updateMany({
        where: { userId },
        data: { isDefault: false },
      }),
      db.tradingAccount.update({
        where: { id: accountId },
        data: { isDefault: true },
      }),
    ]);

    return NextResponse.json(safeAccountDTO(targetAccount as unknown as Record<string, unknown>));
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
