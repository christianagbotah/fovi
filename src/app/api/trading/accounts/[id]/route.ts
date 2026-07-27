import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel, ensureDemoUser } from '@/lib/db';

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!db || !hasModel('tradingAccount')) {
    return NextResponse.json({ success: true });
  }
  try {
    const { id } = await params;
    const userId = await ensureDemoUser();
    if (!userId) {
      return NextResponse.json({ success: true });
    }
    await db.tradingAccount.deleteMany({ where: { id, userId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    // ANY database error falls back to demo
    console.warn('[accounts/[id] DELETE] DB error, using fallback:', error);
    return NextResponse.json({ success: true });
  }
}
