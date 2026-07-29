// POST: Create trading account, GET: List accounts

import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel, ensureDemoUser, DEMO_USER_ID } from '@/lib/db';
import { DemoBroker } from '@/lib/broker/demo';
import { v4 as uuidv4 } from 'uuid';

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

    if (!db || !hasModel('tradingAccount')) {
      return NextResponse.json(makeDemoAccount({ id, broker, accountType, balance: isLinked ? 0 : 100000, linkedBalance: isLinked ? 0 : 100000 }));
    }

    const userId = await ensureDemoUser();
    if (!userId) {
      return NextResponse.json(makeDemoAccount({ id, broker, accountType, balance: isLinked ? 0 : 100000, linkedBalance: isLinked ? 0 : 100000 }));
    }

    const account = await db.tradingAccount.create({
      data: {
        id, userId, broker, accountType,
        accountId: body.accountId, apiKey: body.apiKey, apiSecret: body.apiSecret,
        passphrase: body.passphrase,
        isDefault: body.isDefault || false, balance: body.balance || 100000,
        linkedBalance: body.linkedBalance ?? body.balance ?? 100000,
        totalAllocated: 0, totalRealizedProfit: 0,
        currency: body.currency || 'USD',
      },
    });
    return NextResponse.json(account);
  } catch (error) {
    console.warn('[accounts POST] DB error, using fallback:', error);
    return NextResponse.json(makeDemoAccount({ id: uuidv4() }));
  }
}

export async function GET() {
  try {
    if (!db || !hasModel('tradingAccount')) {
      // Enrich demo accounts with live broker balance
      const broker = new DemoBroker({ provider: 'demo', isDemo: true });
      const info = await broker.getAccountInfo();
      return NextResponse.json([makeDemoAccount({ balance: info.balance, linkedBalance: info.balance })]);
    }

    const userId = await ensureDemoUser();
    if (!userId) {
      return NextResponse.json(DEMO_ACCOUNTS);
    }

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
    return NextResponse.json(DEMO_ACCOUNTS);
  }
}
