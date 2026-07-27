import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';

export async function POST(req: NextRequest) {
  if (!db || !hasModel('tradingAccount')) {
    return NextResponse.json({ success: true });
  }
  try {
    const { accountId } = await req.json();
    const userId = 'usr_demo_1';

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
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('validating datasource')) {
      // Prisma validation error (e.g., wrong DB URL) — return same fallback as !db check
      return NextResponse.json({ success: true });
    }
    const msg = error instanceof Error ? error.message : 'Failed to switch account';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}