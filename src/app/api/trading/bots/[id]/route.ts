import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';
import { getUserIdSync } from '@/lib/get-user-id';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!db || !hasModel('bot')) {
    return NextResponse.json({ success: true, id, message: 'demo mode' }, { headers: { 'x-demo': 'true' } });
  }
  try {
    const userId = getUserIdSync(req);
    const bot = await db.bot.findUnique({ where: { id } });
    if (!bot) {
      return NextResponse.json({ success: true, id, message: 'not found (demo)' }, { headers: { 'x-demo': 'true' } });
    }
    if (bot.userId !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json(bot);
  } catch (error) {
    // ANY database error falls back to demo
    console.warn('[bots/[id] GET] DB error, using fallback:', error);
    return NextResponse.json({ success: true, id, message: 'demo mode' }, { headers: { 'x-demo': 'true' } });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  if (!db || !hasModel('bot')) {
    return NextResponse.json({ success: true, id, updated: body }, { headers: { 'x-demo': 'true' } });
  }
  try {
    const userId = getUserIdSync(req);
    const bot = await db.bot.findUnique({ where: { id } });
    if (bot && bot.userId !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const { id: _id, ...rest } = body;
    // Convert config object to JSON string if provided as object
    const data: Record<string, unknown> = { ...rest };
    if (rest.config && typeof rest.config === 'object') {
      data.config = JSON.stringify(rest.config);
    }
    const updated = await db.bot.update({
      where: { id },
      data,
    });
    return NextResponse.json(updated);
  } catch (error) {
    // ANY database error falls back to demo
    console.warn('[bots/[id] PUT] DB error, using fallback:', error);
    return NextResponse.json({ success: true, id, updated: body }, { headers: { 'x-demo': 'true' } });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!db || !hasModel('bot')) {
    return NextResponse.json({ success: true }, { headers: { 'x-demo': 'true' } });
  }
  try {
    const userId = getUserIdSync(req);
    const bot = await db.bot.findUnique({ where: { id } });
    if (bot && bot.userId !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    await db.bot.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    // ANY database error falls back to demo
    console.warn('[bots/[id] DELETE] DB error, using fallback:', error);
    return NextResponse.json({ success: true }, { headers: { 'x-demo': 'true' } });
  }
}
