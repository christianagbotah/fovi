import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!db || !hasModel('tradingAccount')) {
    return NextResponse.json({ success: true });
  }
  try {
    const { id } = await params;
    const userId = 'usr_demo_1';
    await db.tradingAccount.deleteMany({ where: { id, userId } });
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('validating datasource')) {
      // Prisma validation error (e.g., wrong DB URL) — return same fallback as !db check
      return NextResponse.json({ success: true });
    }
    const msg = error instanceof Error ? error.message : 'Failed to delete account';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}