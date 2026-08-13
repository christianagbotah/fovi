// POST: Create trading account, GET: List accounts
// Production-ready: validates broker credentials even without DB,
// returns proper account objects with clear headers indicating storage mode.

import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel, ensureDemoUser, DEMO_USER_ID } from '@/lib/db';
import { getUserId } from '@/lib/get-user-id';
import { DemoBroker } from '@/lib/broker/demo';
import { createBroker } from '@/lib/broker/factory';
import { encrypt } from '@/lib/encryption';
import { v4 as uuidv4 } from 'uuid';
import { checkSubscriptionLimit, getLimitMessage } from '@/lib/subscription-guard';

// ============================================================
// Response headers to tell the frontend the storage mode
// ============================================================
const HEADERS_DB = { 'x-demo': 'false', 'x-storage': 'db' };
const HEADERS_LOCAL = { 'x-demo': 'false', 'x-storage': 'local' };
const HEADERS_DEMO = { 'x-demo': 'true', 'x-storage': 'none' };

// Demo fallback data
const makeDemoAccount = (overrides: Record<string, any> = {}) => ({
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

/** Build a local-only account object (returned when DB is unavailable) */
function makeLocalAccount(params: {
  id: string;
  broker: string;
  accountType: string;
  balance: number;
  currency: string;
  accountId?: string | null;
}) {
  const now = new Date().toISOString();
  return {
    id: params.id,
    userId: DEMO_USER_ID,
    broker: params.broker,
    accountType: params.accountType,
    accountId: params.accountId || null,
    isDefault: false,
    balance: params.balance,
    linkedBalance: params.balance,
    totalAllocated: 0,
    totalRealizedProfit: 0,
    currency: params.currency,
    isActive: true,
    lastSyncedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

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
    } catch (error: any) {
      console.error('[accounts POST] Demo DB error:', error);
      return NextResponse.json(
        { error: `Database error: ${error?.message || 'Unknown'}` },
        { status: 500 },
      );
    }
  }

  // --------------------------------------------------------
  // 2. Real broker — ALWAYS validate credentials first
  //    (regardless of DB availability)
  // --------------------------------------------------------
  let brokerInfo: { balance: number; currency: string; accountId?: string } | null = null;
  let validationError: string | null = null;

  try {
    const brokerInstance = createBroker({
      provider: broker as any,
      accountId: id,
      apiKey: body.apiKey || undefined,
      apiSecret: body.apiSecret || undefined,
      passphrase: body.passphrase || undefined,
      isDemo: accountType === 'demo',
    });
    const info = await brokerInstance.getAccountInfo();
    brokerInfo = { balance: info.balance, currency: info.currency, accountId: info.accountId };
  } catch (err: any) {
    validationError = err?.message || 'Broker validation failed';
    console.warn(`[accounts POST] ${broker} validation failed:`, validationError);
  }

  // Validation failed — return a REAL error, never a fake account
  if (!brokerInfo) {
    return NextResponse.json(
      { error: `Credential validation failed: ${validationError}` },
      { status: 400 },
    );
  }

  // --------------------------------------------------------
  // 3. Credentials are valid. Try to save to DB.
  //    If DB is unavailable, return a local-only account
  //    with x-storage: local header so the frontend persists it.
  // --------------------------------------------------------
  if (!dbReady) {
    // DB not available — return local account for frontend to persist
    console.warn(`[accounts POST] DB not available, returning local account for ${broker}`);
    const localAccount = makeLocalAccount({
      id,
      broker,
      accountType,
      balance: brokerInfo.balance,
      currency: brokerInfo.currency,
      accountId: brokerInfo.accountId,
    });
    return NextResponse.json(localAccount, { headers: HEADERS_LOCAL });
  }

  // DB is available — save with encrypted credentials
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

    const account = await db!.tradingAccount.create({
      data: {
        id, userId, broker, accountType,
        accountId: brokerInfo.accountId || body.accountId || null,
        apiKey: encryptedApiKey,
        apiSecret: encryptedApiSecret,
        passphrase: encryptedPassphrase,
        isDefault: body.isDefault || false,
        balance: brokerInfo.balance,
        linkedBalance: brokerInfo.balance,
        totalAllocated: 0,
        totalRealizedProfit: 0,
        currency: brokerInfo.currency,
      },
    });

    return NextResponse.json(account, { headers: HEADERS_DB });
  } catch (dbError: any) {
    // DB write failed after successful validation — return local account
    console.error(`[accounts POST] DB write failed for ${broker}:`, dbError);
    const localAccount = makeLocalAccount({
      id,
      broker,
      accountType,
      balance: brokerInfo.balance,
      currency: brokerInfo.currency,
      accountId: brokerInfo.accountId,
    });
    return NextResponse.json(localAccount, { headers: HEADERS_LOCAL });
  }
}

// ============================================================
// GET — List all trading accounts
// ============================================================
export async function GET(req: NextRequest) {
  try {
    if (!db || !hasModel('tradingAccount')) {
      const broker = new DemoBroker({ provider: 'demo', isDemo: true });
      const info = await broker.getAccountInfo();
      return NextResponse.json(
        [makeDemoAccount({ balance: info.balance, linkedBalance: info.balance })],
        { headers: HEADERS_DEMO },
      );
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
    return NextResponse.json(accounts, { headers: HEADERS_DB });
  } catch (error) {
    console.warn('[accounts GET] DB error, using fallback:', error);
    return NextResponse.json(DEMO_ACCOUNTS, { headers: HEADERS_DEMO });
  }
}
