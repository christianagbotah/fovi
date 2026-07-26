// POST: Create trading account, GET: List accounts

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { v4 as uuidv4 } from 'uuid';

// Seed a default demo account if none exists
async function ensureDemoAccount(userId: string) {
  const existing = await db.tradingAccount.findFirst({
    where: { userId, accountType: 'demo', broker: 'demo' },
  });
  if (!existing) {
    const count = await db.tradingAccount.count({ where: { userId } });
    return db.tradingAccount.create({
      data: {
        id: uuidv4(),
        userId,
        broker: 'demo',
        accountType: 'demo',
        isDefault: count === 0,
        balance: 100000,
        currency: 'USD',
      },
    });
  }
  return existing;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const userId = 'usr_demo_1'; // In production: get from session
    const id = uuidv4();
    const account = await db.tradingAccount.create({
      data: {
        id,
        userId,
        broker: body.broker || 'demo',
        accountType: body.accountType || 'demo',
        accountId: body.accountId,
        apiKey: body.apiKey,
        apiSecret: body.apiSecret,
        isDefault: body.isDefault || false,
        balance: body.balance || 100000,
        currency: body.currency || 'USD',
      },
    });
    return NextResponse.json(account);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to create account';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET() {
  try {
    const userId = 'usr_demo_1';
    await ensureDemoAccount(userId);
    const accounts = await db.tradingAccount.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(accounts);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to fetch accounts';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}