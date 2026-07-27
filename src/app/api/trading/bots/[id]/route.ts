import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel } from '@/lib/db';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!db || !hasModel('bot')) {
    return NextResponse.json({ success: true, id, message: 'demo mode' });
  }
  try {
    const bot = await db.bot.findUnique({ where: { id } });
    if (!bot) {
      return NextResponse.json({ success: true, id, message: 'not found (demo)' });
    }
    return NextResponse.json(bot);
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('validating datasource')) {
      return NextResponse.json({ success: true, id, message: 'demo mode' });
    }
    const msg = error instanceof Error ? error.message : 'Failed to fetch bot';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  if (!db || !hasModel('bot')) {
    return NextResponse.json({ success: true, id, updated: body });
  }
  try {
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
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('validating datasource')) {
      return NextResponse.json({ success: true, id, updated: body });
    }
    const msg = error instanceof Error ? error.message : 'Failed to update bot';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!db || !hasModel('bot')) {
    return NextResponse.json({ success: true });
  }
  try {
    await db.bot.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('validating datasource')) {
      return NextResponse.json({ success: true });
    }
    const msg = error instanceof Error ? error.message : 'Failed to delete bot';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
