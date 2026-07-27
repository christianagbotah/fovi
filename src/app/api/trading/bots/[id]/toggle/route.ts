import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!db || !hasModel('bot')) {
    // Toggle demo state deterministically: default to enabling
    return NextResponse.json({ success: true, enabled: true, status: 'running' });
  }
  try {
    const bot = await db.bot.findUnique({ where: { id } });
    if (!bot) {
      return NextResponse.json({ success: true, enabled: true, status: 'running' });
    }
    const newEnabled = !bot.enabled;
    const newStatus = newEnabled ? 'running' : 'stopped';
    const updated = await db.bot.update({
      where: { id },
      data: { enabled: newEnabled, status: newStatus },
    });
    return NextResponse.json({
      success: true,
      enabled: updated.enabled,
      status: updated.status,
    });
  } catch (error) {
    // ANY database error falls back to demo
    console.warn('[bots/[id]/toggle POST] DB error, using fallback:', error);
    return NextResponse.json({ success: true, enabled: true, status: 'running' });
  }
}
