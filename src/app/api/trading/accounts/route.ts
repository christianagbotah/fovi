// POST: Create trading account, GET: List accounts

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { v4 as uuidv4 } from 'uuid';

// Demo fallback data
const DEMO_ACCOUNTS = [{
  id: 'demo_acc_1',
  userId: 'usr_demo_1',
  broker: 'demo',
  accountType: 'demo',
  accountId: null,
  isDefault: true,
  balance: 100000,
  currency: 'USD',
  isActive: true,
  lastSyncedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}];

function isPrismaUnavailable(error: unknown): boolean {
  if (error instanceof Error) {
    return error.message.includes('validating datasource') ||
           error.message.includes('postgresql://') ||
           error.message.includes('ENOTFOUND') ||
           error.message.includes('ECONNREFUSED');
  }
  return false;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const userId = 'usr_demo_1';
    const id = uuidv4();

    if (!db) {
      return NextResponse.json({ ...DEMO_ACCOUNTS[0], id, broker: body.broker || 'demo', accountType: body.accountType || 'demo', balance: body.balance || 100000 });
    }

    const account = await db.tradingAccount.create({
      data: {
        id, userId,
        broker: body.broker || 'demo', accountType: body.accountType || 'demo',
        accountId: body.accountId, apiKey: body.apiKey, apiSecret: body.apiSecret,
        isDefault: body.isDefault || false, balance: body.balance || 100000,
        currency: body.currency || 'USD',
      },
    });
    return NextResponse.json(account);
  } catch (error: unknown) {
    if (isPrismaUnavailable(error)) {
      const body = { broker: 'demo', accountType: 'demo', balance: 100000 };
      return NextResponse.json({ ...DEMO_ACCOUNTS[0], id: uuidv4(), ...body });
    }
    const msg = error instanceof Error ? error.message : 'Failed to create account';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET() {
  try {
    const userId = 'usr_demo_1';

    if (!db) {
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
          data: { userId, broker: 'demo', accountType: 'demo', isDefault: count === 0, balance: 100000, currency: 'USD' },
        });
      }
    } catch { /* seed may fail, that's ok */ }

    const accounts = await db.tradingAccount.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(accounts);
  } catch (error: unknown) {
    if (isPrismaUnavailable(error)) {
      return NextResponse.json(DEMO_ACCOUNTS);
    }
    const msg = error instanceof Error ? error.message : 'Failed to fetch accounts';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
