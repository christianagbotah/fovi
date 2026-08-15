// ============================================================
// POST/GET /api/trading/accounts
// Phase 1 CR3:
//   Strict auth: AuthRequiredError → 401
//   Demo creation also returns safeAccountDTO
//   Demo accounts get provenance headers
//   Phase 1: Non-demo credential intake UNCONDITIONALLY blocked.
//     BROKER_CREDENTIAL_INTAKE_ENABLED is deprecated and ignored.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';
import { getUserId, AuthRequiredError, authRequiredResponse } from '@/lib/get-user-id';
import { enforcePhase1CredentialIntake, safeAccountDTO, safeAccountDTOs, DEMO_PROVENANCE_HEADER, logSecurityEvent, CONTAINMENT_CODES } from '@/lib/trading-policy';
import { v4 as uuidv4 } from 'uuid';
import { checkSubscriptionLimit, getLimitMessage } from '@/lib/subscription-guard';

const HEADERS_DB = { 'x-demo': 'false', 'x-storage': 'db' };

// ============================================================
// POST — Create / connect a trading account
// ============================================================
export async function POST(req: NextRequest) {
  let userId: string;
  try {
    userId = await getUserId(req);
  } catch {
    return authRequiredResponse();
  }

  const body = await req.json().catch(() => ({}));
  const id = uuidv4();
  const broker = body.broker || 'demo';
  const accountType = body.accountType || 'demo';
  const isDemo = broker === 'demo' && accountType === 'demo' ? true : false;
  const dbReady = !!(db && hasModel('tradingAccount'));

  // Reject conflicting classification: broker='demo' but accountType='live' or vice versa
  if (broker === 'demo' && accountType !== 'demo') {
    return NextResponse.json(
      { error: 'Conflicting classification: broker is "demo" but accountType is not "demo".', code: CONTAINMENT_CODES.DEMO_ONLY, remediationPhase: 'containment' },
      { status: 400 },
    );
  }
  if (broker !== 'demo' && accountType === 'demo') {
    return NextResponse.json(
      { error: 'Conflicting classification: accountType is "demo" but broker is not "demo".', code: CONTAINMENT_CODES.DEMO_ONLY, remediationPhase: 'containment' },
      { status: 400 },
    );
  }

  // Reject broker='demo' with credentials supplied
  if (broker === 'demo' && (body.apiKey || body.apiSecret || body.passphrase)) {
    return NextResponse.json(
      { error: 'Demo accounts must not have credentials (apiKey, apiSecret, or passphrase). Remove them and retry.', code: CONTAINMENT_CODES.DEMO_ONLY, remediationPhase: 'containment' },
      { status: 400 },
    );
  }

  // ── Phase 1 CONTAINMENT: Unconditionally block non-demo credential intake ──
  const intakeCheck = enforcePhase1CredentialIntake(broker, accountType, isDemo);
  if (intakeCheck.blocked) return intakeCheck.response;

  // --------------------------------------------------------
  // Demo broker — simple path (no credentials needed)
  // --------------------------------------------------------
  if (!dbReady) {
    return NextResponse.json(
      { error: 'Database unavailable. Cannot create demo account.', code: 'SERVICE_UNAVAILABLE', remediationPhase: 'containment' },
      { status: 503 },
    );
  }
  try {
    const accountCheck = await checkSubscriptionLimit(userId, 'maxAccounts');
    if (!accountCheck.allowed) {
      return NextResponse.json(
        { error: getLimitMessage('maxAccounts'), current: accountCheck.current, limit: accountCheck.limit },
        { status: 403 },
      );
    }
    const account = await db!.tradingAccount.create({
      data: {
        id, userId, broker, accountType,
        isDemo,
        isDefault: body.isDefault || false,
        balance: body.balance || 100000,
        linkedBalance: body.linkedBalance ?? body.balance ?? 100000,
        totalAllocated: 0, totalRealizedProfit: 0,
        currency: body.currency || 'USD',
      },
    });
    return NextResponse.json(
      safeAccountDTO(account as unknown as Record<string, unknown>),
      { headers: DEMO_PROVENANCE_HEADER },
    );
  } catch (error: unknown) {
    logSecurityEvent({
      eventType: 'ACCOUNTS_POST_DEMO_ERROR',
      route: '/api/trading/accounts',
      userId,
      reason: error instanceof Error ? error.message : 'Unknown',
    });
    return NextResponse.json(
      { error: `Database error: ${error instanceof Error ? error.message : 'Unknown'}` },
      { status: 500 },
    );
  }
}

// ============================================================
// GET — List all trading accounts (safe DTOs only)
// ============================================================
export async function GET(req: NextRequest) {
  try {
    if (!db || !hasModel('tradingAccount')) {
      return NextResponse.json(
        { error: 'Account data is temporarily unavailable.', code: 'SERVICE_UNAVAILABLE', remediationPhase: 'containment' },
        { status: 503 },
      );
    }

    const userId = await getUserId(req);

    const accounts = await db!.tradingAccount.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    const defaultAccount = accounts.find(a => a.isDefault);
    const headers: Record<string, string> = { ...HEADERS_DB };
    if (defaultAccount) {
      headers['x-active-account'] = defaultAccount.id;
    }

    return NextResponse.json(safeAccountDTOs(accounts as unknown as Record<string, unknown>[]), { headers });
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      return authRequiredResponse();
    }
    logSecurityEvent({
      eventType: 'ACCOUNTS_GET_ERROR',
      route: '/api/trading/accounts',
      reason: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'Failed to fetch accounts.' },
      { status: 500 },
    );
  }
}
