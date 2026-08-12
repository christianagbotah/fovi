// POST: Create trading account, GET: List accounts

import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel, ensureDemoUser, DEMO_USER_ID } from '@/lib/db';
import { getUserId } from '@/lib/get-user-id';
import { DemoBroker } from '@/lib/broker/demo';
import { createBrokerFromAccount } from '@/lib/broker/factory';
import { encrypt } from '@/lib/encryption';
import { v4 as uuidv4 } from 'uuid';
import { checkSubscriptionLimit, getLimitMessage } from '@/lib/subscription-guard';

// Demo fallback data — now includes allocation fields
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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const id = uuidv4();
    const broker = body.broker || 'demo';
    const accountType = body.accountType || 'demo';
    const isLinked = broker !== 'demo';

    // Demo path: no validation or encryption needed
    if (broker === 'demo') {
      if (!db || !hasModel('tradingAccount')) {
        return NextResponse.json(makeDemoAccount({ id, broker, accountType, balance: 100000, linkedBalance: 100000 }), { headers: { 'x-demo': 'true' } });
      }
      const userId = await getUserId(req);

      // --- Subscription limit check ---
      const accountCheck = await checkSubscriptionLimit(userId, 'maxAccounts');
      if (!accountCheck.allowed) {
        return NextResponse.json(
          { error: getLimitMessage('maxAccounts'), current: accountCheck.current, limit: accountCheck.limit },
          { status: 403 },
        );
      }

      const account = await db.tradingAccount.create({
        data: {
          id, userId, broker, accountType,
          isDefault: body.isDefault || false,
          balance: body.balance || 100000,
          linkedBalance: body.linkedBalance ?? body.balance ?? 100000,
          totalAllocated: 0, totalRealizedProfit: 0,
          currency: body.currency || 'USD',
        },
      });
      return NextResponse.json(account);
    }

    // Non-demo: encrypt credentials
    const encryptedApiKey = body.apiKey ? encrypt(body.apiKey) : null;
    const encryptedApiSecret = body.apiSecret ? encrypt(body.apiSecret) : null;
    const encryptedPassphrase = body.passphrase ? encrypt(body.passphrase) : null;

    if (!db || !hasModel('tradingAccount')) {
      return NextResponse.json(makeDemoAccount({ id, broker, accountType, balance: 0, linkedBalance: 0 }), { headers: { 'x-demo': 'true' } });
    }

    const userId = await getUserId(req);

    // --- Subscription limit check ---
    const accountCheck = await checkSubscriptionLimit(userId, 'maxAccounts');
    if (!accountCheck.allowed) {
      return NextResponse.json(
        { error: getLimitMessage('maxAccounts'), current: accountCheck.current, limit: accountCheck.limit },
        { status: 403 },
      );
    }

    // Create account with encrypted credentials
    const account = await db.tradingAccount.create({
      data: {
        id, userId, broker, accountType,
        accountId: body.accountId,
        apiKey: encryptedApiKey,
        apiSecret: encryptedApiSecret,
        passphrase: encryptedPassphrase,
        isDefault: body.isDefault || false,
        balance: 0,
        linkedBalance: 0,
        totalAllocated: 0, totalRealizedProfit: 0,
        currency: body.currency || 'USD',
      },
    });

    // Validate credentials by calling the broker
    try {
      const brokerInstance = createBrokerFromAccount({
        broker,
        accountType,
        accountId: body.accountId || null,
        apiKey: body.apiKey || null,
        apiSecret: body.apiSecret || null,
        passphrase: body.passphrase || null,
        id,
      });
      const info = await brokerInstance.getAccountInfo();

      // Update account with real balance from broker
      const updatedAccount = await db.tradingAccount.update({
        where: { id },
        data: {
          balance: info.balance,
          linkedBalance: info.balance,
          currency: info.currency,
        },
      });
      return NextResponse.json(updatedAccount);
    } catch (validationError: any) {
      // Validation failed — delete the account
      try { await db.tradingAccount.delete({ where: { id } }); } catch { /* best effort */ }
      return NextResponse.json(
        { error: `Credential validation failed: ${validationError?.message || 'Unknown error'}` },
        { status: 400 }
      );
    }
  } catch (error) {
    console.warn('[accounts POST] DB error, using fallback:', error);
    return NextResponse.json(makeDemoAccount({ id: uuidv4() }), { headers: { 'x-demo': 'true' } });
  }
}

export async function GET(req: NextRequest) {
  try {
    if (!db || !hasModel('tradingAccount')) {
      // Enrich demo accounts with live broker balance
      const broker = new DemoBroker({ provider: 'demo', isDemo: true });
      const info = await broker.getAccountInfo();
      return NextResponse.json([makeDemoAccount({ balance: info.balance, linkedBalance: info.balance })], { headers: { 'x-demo': 'true' } });
    }

    const userId = await getUserId(req);

    // Ensure demo user row exists for FK constraints
    await ensureDemoUser();

    // Ensure demo account exists
    try {
      const existing = await db.tradingAccount.findFirst({
        where: { userId, accountType: 'demo', broker: 'demo' },
      });
      if (!existing) {
        const count = await db.tradingAccount.count({ where: { userId } });
        await db.tradingAccount.create({
          data: { userId, broker: 'demo', accountType: 'demo', isDefault: count === 0, balance: 100000, linkedBalance: 100000, currency: 'USD' },
        });
      }
    } catch { /* seed may fail, ok */ }

    const accounts = await db.tradingAccount.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(accounts);
  } catch (error) {
    console.warn('[accounts GET] DB error, using fallback:', error);
    return NextResponse.json(DEMO_ACCOUNTS, { headers: { 'x-demo': 'true' } });
  }
}
