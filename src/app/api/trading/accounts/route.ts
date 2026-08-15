// POST: Create trading account, GET: List accounts
// Phase 1: Credential intake control, safe DTOs, no credential exposure.

import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel, ensureDemoUser, DEMO_USER_ID } from '@/lib/db';
import { getUserId } from '@/lib/get-user-id';
import { DemoBroker } from '@/lib/broker/demo';
import { createBroker } from '@/lib/broker/factory';
import { encrypt } from '@/lib/encryption';
import { v4 as uuidv4 } from 'uuid';
import { checkSubscriptionLimit, getLimitMessage } from '@/lib/subscription-guard';
import {
  BROKER_CREDENTIAL_INTAKE_ENABLED,
  CONTAINMENT_CODES,
  safeAccountDTOs,
  DEMO_PROVENANCE_HEADER,
} from '@/lib/trading-policy';

// ============================================================
// Response headers to tell the frontend the storage mode
// ============================================================
const HEADERS_DB = { 'x-demo': 'false', 'x-storage': 'db' };
const HEADERS_DEMO = { 'x-demo': 'true', 'x-storage': 'none' };

// Demo fallback data
const makeDemoAccount = (overrides: Record<string, unknown> = {}) => ({
  id: 'demo_acc_1',
  userId: DEMO_USER_ID,
  broker: 'demo',
  accountType: 'demo',
  accountId: null,
  isDefault: true,
  balance: 100000,
  linkedBalance: 100000,
  totalAllocated: 0,
  totalRealizedProfit: 0,
  currency: 'USD',
  isActive: true,
  lastSyncedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

const DEMO_ACCOUNTS = [makeDemoAccount()];

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
    console.warn(
      `[CONTAINMENT] Broker credential intake blocked. broker=${broker} type=${accountType}`
    );
    return NextResponse.json(
      {
        error: 'Broker credential intake is temporarily disabled during platform remediation.',
        code: CONTAINMENT_CODES.CREDENTIAL_INTAKE_DISABLED,
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
        makeDemoAccount({ id, broker, accountType, balance: 100000, linkedBalance: 100000 }),
        { headers: HEADERS_DEMO },
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
      console.error('[accounts POST] Demo DB error:', error);
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
    // No DB — do NOT return credentials to client
    return NextResponse.json(
      {
        id, broker, accountType, accountId: brokerInfo.accountId || null,
        isDefault: true, balance: brokerInfo.balance, linkedBalance: brokerInfo.balance,
        totalAllocated: 0, totalRealizedProfit: 0, currency: brokerInfo.currency,
        isActive: true, lastSyncedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      },
      { headers: { 'x-demo': 'false', 'x-storage': 'local' } },
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

    const encryptedApiKey = body.apiKey ? encrypt(body.apiKey) : null;
    const encryptedApiSecret = body.apiSecret ? encrypt(body.apiSecret) : null;
    const encryptedPassphrase = body.passphrase ? encrypt(body.passphrase) : null;

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
    console.error(`[accounts POST] DB write failed for ${broker}:`, dbError);
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
      return NextResponse.json(DEMO_ACCOUNTS, { headers: HEADERS_DEMO });
    }

    const userId = await getUserId(req);
    await ensureDemoUser();

    // Ensure demo account exists
    try {
      const existing = await db!.tradingAccount.findFirst({
        where: { userId, accountType: 'demo', broker: 'demo' },
      });
      if (!existing) {
        const count = await db!.tradingAccount.count({ where: { userId } });
        await db!.tradingAccount.create({
          data: { userId, broker: 'demo', accountType: 'demo', isDefault: count === 0, balance: 100000, linkedBalance: 100000, currency: 'USD' },
        });
      }
    } catch { /* seed may fail, ok */ }

    const accounts = await db!.tradingAccount.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    const defaultAccount = accounts.find(a => a.isDefault);
    const headers: Record<string, string> = { ...HEADERS_DB };
    if (defaultAccount) {
      headers['x-active-account'] = defaultAccount.id;
    }

    // CONTAINMENT: Strip credential fields from ALL responses
    return NextResponse.json(safeAccountDTOs(accounts as unknown as Record<string, unknown>[]), { headers });
  } catch (error) {
    console.warn('[accounts GET] DB error, using fallback:', error);
    return NextResponse.json(DEMO_ACCOUNTS, { headers: HEADERS_DEMO });
  }
}
