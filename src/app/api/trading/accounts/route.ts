// ============================================================
// POST/GET /api/trading/accounts
// Phase 1 CR1:
//   P0-12: Import safeAccountDTO, await encrypt() calls
//   P0-10: GET catch returns 500, POST DB failure returns 503
//   BROKER_CREDENTIAL_INTAKE_ENABLED check for non-demo POST
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';
import { getUserId } from '@/lib/get-user-id';
import { createBroker } from '@/lib/broker/factory';
import { encrypt } from '@/lib/encryption';
import { v4 as uuidv4 } from 'uuid';
import { checkSubscriptionLimit, getLimitMessage } from '@/lib/subscription-guard';
import {
  BROKER_CREDENTIAL_INTAKE_ENABLED,
  CONTAINMENT_CODES,
  safeAccountDTOs,
  logSecurityEvent,
} from '@/lib/trading-policy';

const HEADERS_DB = { 'x-demo': 'false', 'x-storage': 'db' };

// ============================================================
// POST — Create / connect a trading account
// ============================================================
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const id = uuidv4();
  const broker = body.broker || 'demo';
  const accountType = body.accountType || 'demo';
  const isRealBroker = broker !== 'demo';
  const dbReady = !!(db && hasModel('tradingAccount'));

  // ── CONTAINMENT: Block non-demo credential intake when disabled ──
  if (isRealBroker && !BROKER_CREDENTIAL_INTAKE_ENABLED) {
    const correlationId = uuidv4();
    logSecurityEvent({
      eventType: 'CREDENTIAL_INTAKE_BLOCKED',
      correlationId,
      route: '/api/trading/accounts',
      reason: `Broker credential intake blocked. broker=${broker} type=${accountType}`,
    });
    return NextResponse.json(
      {
        error: 'Broker credential intake is temporarily disabled during platform remediation.',
        code: CONTAINMENT_CODES.CREDENTIAL_INTAKE_DISABLED,
        correlationId,
        remediationPhase: 'containment',
      },
      { status: 403 },
    );
  }

  // --------------------------------------------------------
  // 1. Demo broker — simple path
  // --------------------------------------------------------
  if (!isRealBroker) {
    if (!dbReady) {
      return NextResponse.json(
        { error: 'Database unavailable. Cannot create demo account.', code: 'SERVICE_UNAVAILABLE', remediationPhase: 'containment' },
        { status: 503 },
      );
    }
    try {
      const userId = await getUserId(req);
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
          isDefault: body.isDefault || false,
          balance: body.balance || 100000,
          linkedBalance: body.linkedBalance ?? body.balance ?? 100000,
          totalAllocated: 0, totalRealizedProfit: 0,
          currency: body.currency || 'USD',
        },
      });
      return NextResponse.json(account, { headers: HEADERS_DB });
    } catch (error: unknown) {
      logSecurityEvent({
        eventType: 'ACCOUNTS_POST_DEMO_ERROR',
        route: '/api/trading/accounts',
        reason: error instanceof Error ? error.message : 'Unknown',
      });
      return NextResponse.json(
        { error: `Database error: ${error instanceof Error ? error.message : 'Unknown'}` },
        { status: 500 },
      );
    }
  }

  // --------------------------------------------------------
  // 2. Real broker — validate credentials
  // --------------------------------------------------------
  let brokerInfo: { balance: number; currency: string; accountId?: string } | null = null;
  let validationError: string | null = null;

  try {
    const brokerInstance = createBroker({
      provider: broker as 'alpaca' | 'binance' | 'okx' | 'bybit' | 'bitget',
      accountId: id,
      apiKey: body.apiKey || undefined,
      apiSecret: body.apiSecret || undefined,
      passphrase: body.passphrase || undefined,
      isDemo: accountType === 'demo',
    });
    const info = await brokerInstance.getAccountInfo();
    brokerInfo = { balance: info.balance, currency: info.currency, accountId: info.accountId };
  } catch (err: unknown) {
    validationError = err instanceof Error ? err.message : 'Broker validation failed';
    console.warn(`[accounts POST] ${broker} validation failed:`, validationError);
  }

  if (!brokerInfo) {
    return NextResponse.json(
      { error: `Credential validation failed: ${validationError}` },
      { status: 400 },
    );
  }

  // --------------------------------------------------------
  // 3. Save to DB (credentials already validated)
  // --------------------------------------------------------
  if (!dbReady) {
    // P0-10: DB unavailable → 503, NOT a local linked account
    const correlationId = uuidv4();
    logSecurityEvent({
      eventType: 'ACCOUNTS_POST_NO_DB',
      correlationId,
      route: '/api/trading/accounts',
      reason: 'Database unavailable — cannot persist validated broker credentials',
    });
    return NextResponse.json(
      {
        error: 'Database is temporarily unavailable. Your credentials were validated but could not be saved. Please try again later.',
        code: 'SERVICE_UNAVAILABLE',
        correlationId,
        remediationPhase: 'containment',
      },
      { status: 503 },
    );
  }

  try {
    const userId = await getUserId(req);
    const accountCheck = await checkSubscriptionLimit(userId, 'maxAccounts');
    if (!accountCheck.allowed) {
      return NextResponse.json(
        { error: getLimitMessage('maxAccounts'), current: accountCheck.current, limit: accountCheck.limit },
        { status: 403 },
      );
    }

    // P0-12: All encrypt() calls MUST be awaited
    const encryptedApiKey = body.apiKey ? await encrypt(body.apiKey) : null;
    const encryptedApiSecret = body.apiSecret ? await encrypt(body.apiSecret) : null;
    const encryptedPassphrase = body.passphrase ? await encrypt(body.passphrase) : null;

    await db!.tradingAccount.updateMany({ where: { userId }, data: { isDefault: false } });

    const account = await db!.tradingAccount.create({
      data: {
        id, userId, broker, accountType,
        accountId: brokerInfo.accountId || body.accountId || null,
        apiKey: encryptedApiKey, apiSecret: encryptedApiSecret, passphrase: encryptedPassphrase,
        isDefault: true,
        balance: brokerInfo.balance, linkedBalance: brokerInfo.balance,
        totalAllocated: 0, totalRealizedProfit: 0, currency: brokerInfo.currency,
      },
    });

    // CONTAINMENT: Return safe DTO — strip credential fields
    return NextResponse.json(safeAccountDTO(account as unknown as Record<string, unknown>), { headers: HEADERS_DB });
  } catch (dbError: unknown) {
    logSecurityEvent({
      eventType: 'ACCOUNTS_POST_DB_ERROR',
      route: '/api/trading/accounts',
      reason: dbError instanceof Error ? dbError.message : 'Unknown',
    });
    return NextResponse.json(
      { error: `Database error: ${dbError instanceof Error ? dbError.message : 'Unknown'}` },
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
    // P0-10: Catch returns 500, NOT demo accounts
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
