import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';
import { getUserId } from '@/lib/get-user-id';

export async function POST(req: NextRequest) {
  if (!db || !hasModel('tradingAccount')) {
    return NextResponse.json({ success: true }, { headers: { 'x-demo': 'true' } });
  }
  try {
    const { accountId } = await req.json();
    const userId = await getUserId(req);

    // Unset all defaults
    await db.tradingAccount.updateMany({
      where: { userId },
      data: { isDefault: false },
    });

    // Set new default
    const account = await db.tradingAccount.update({
      where: { id: accountId, userId },
      data: { isDefault: true },
    });

    return NextResponse.json(account);
  } catch (error) {
    // ANY database error falls back to demo
    console.warn('[accounts/switch POST] DB error, using fallback:', error);
    return NextResponse.json({ success: true }, { headers: { 'x-demo': 'true' } });
  }
}