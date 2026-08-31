// ============================================================
// GET /api/trading/engine/bots
// Internal engine feed: account eligibility + Phase 2C bot policy.
// ============================================================

import { NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';
import { enforceInternalAuth, logSecurityEvent } from '@/lib/trading-policy';
import { evaluateEngineAccountEligibility } from '@/lib/engine-eligibility';
import { validateAutomatedBotConfiguration } from '@/lib/trading-intelligence/bot-policy';

export async function GET(req: Request) {
  const authError = enforceInternalAuth(req);
  if (authError) return authError;

  if (!db || !hasModel('bot')) {
    return NextResponse.json(
      { error: 'Bot data is temporarily unavailable.', code: 'SERVICE_UNAVAILABLE', remediationPhase: 'containment' },
      { status: 503 },
    );
  }

  try {
    const bots = await db.bot.findMany({
      where: { enabled: true, status: 'running' },
      include: {
        account: {
          select: {
            id: true,
            broker: true,
            accountType: true,
            isDemo: true,
            balance: true,
            isActive: true,
            apiKey: true,
            apiSecret: true,
            passphrase: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const active = bots.filter((b) => {
      if (!b.account || b.account.isActive !== true) return false;

      const accountEligibility = evaluateEngineAccountEligibility({
        broker: b.account.broker,
        accountType: b.account.accountType,
        isDemo: b.account.isDemo,
        isActive: b.account.isActive,
        apiKey: b.account.apiKey,
        apiSecret: b.account.apiSecret,
        passphrase: b.account.passphrase,
      });
      if (!accountEligibility.eligible) return false;

      const botPolicy = validateAutomatedBotConfiguration({
        strategy: b.strategy,
        timeframe: b.timeframe,
        allocationAmount: b.allocationAmount,
        riskPerTrade: b.riskPerTrade,
        maxPositions: b.maxPositions,
        accountBalance: b.account.balance,
      });
      return botPolicy.valid;
    });

    // Credential values were fetched only for server-side eligibility. Since
    // strict engine eligibility requires the credential fields to exist and be
    // exactly null, return an explicit null attestation after eligibility has
    // succeeded. No credential value is ever returned to the mini-service.
    const safe = active.map((b) => ({
      ...b,
      positionSizing: 'canonical_risk_v1',
      account: b.account ? {
        id: b.account.id,
        broker: b.account.broker,
        accountType: b.account.accountType,
        isDemo: b.account.isDemo,
        balance: b.account.balance,
        isActive: b.account.isActive,
        apiKey: null,
        apiSecret: null,
        passphrase: null,
      } : null,
    }));

    return NextResponse.json(safe);
  } catch (error) {
    logSecurityEvent({
      eventType: 'ENGINE_BOTS_ERROR', route: '/api/trading/engine/bots',
      reason: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json({ error: 'Failed to fetch bots.' }, { status: 500 });
  }
}
