import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel, ensureDemoUser } from '@/lib/db';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { balance } = body;

    if (typeof balance !== 'number' || balance < 0) {
      return NextResponse.json({ error: 'Invalid balance' }, { status: 400 });
    }

    if (!db || !hasModel('tradingAccount')) {
      // Demo mode: return success, client handles store update
      return NextResponse.json({ success: true, balance });
    }

    const userId = await ensureDemoUser();
    if (!userId) {
      return NextResponse.json({ success: true, balance });
    }

    const updated = await db.tradingAccount.updateMany({
      where: { id, userId },
      data: { balance, updatedAt: new Date().toISOString() },
    });

    return NextResponse.json({ success: true, balance, updatedCount: updated.count });
  } catch (error) {
    console.warn('[accounts/[id] PATCH] DB error, using fallback:', error);
    return NextResponse.json({ success: true, balance: (await req.json().catch(() => ({})))?.balance ?? 0 });
  }
}

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
